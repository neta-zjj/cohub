import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardDocument, BoardItem } from "@neta-art/cohub/board";
import {
	boardItemToNode,
	boardNodeToItem,
	createEmptyBoardDocument,
	diffBoardDocuments,
	toWireOperations,
} from "../lib/board/board-document.ts";
import { createFileBoardItem } from "../lib/board/board-items.ts";

/**
 * How many node operations an edit costs, end to end.
 *
 * This is a correctness concern, not just a performance one: a transaction is one
 * undo step and the server caps operations per transaction, so an edit that emits
 * an operation per node is an edit that cannot be saved on a large board.
 */

/** Items carrying the wire record a synced board would have. */
function synced(items: BoardItem[]): BoardItem[] {
	return items.map((item, index, all) =>
		boardNodeToItem({
			boardId: "board",
			version: 1,
			createdAt: null,
			updatedAt: null,
			...boardItemToNode(item, index, all.length),
		}),
	);
}

/** Items whose keys are the padded array index, as earlier versions wrote them. */
function legacySynced(items: BoardItem[]): BoardItem[] {
	return items.map((item, index, all) =>
		boardNodeToItem({
			boardId: "board",
			version: 1,
			createdAt: null,
			updatedAt: null,
			...boardItemToNode(item, index, all.length),
			orderKey: String(index).padStart(8, "0"),
		}),
	);
}

function documentOf(items: BoardItem[]): BoardDocument {
	return { ...createEmptyBoardDocument(), items };
}

function items(count: number): BoardItem[] {
	return Array.from({ length: count }, (_, index) =>
		createFileBoardItem(`docs/file-${index}.md`, index * 300, 0),
	);
}

function countByType(ops: ReturnType<typeof diffBoardDocuments>) {
	const counts: Record<string, number> = {};
	for (const op of ops) counts[op.type] = (counts[op.type] ?? 0) + 1;
	return counts;
}

/**
 * Apply ops to a mock server and return the ids in the order the server would
 * return them — sorted by order key, which is what the real query does.
 */
function serverOrderAfter(
	base: BoardItem[],
	ops: ReturnType<typeof diffBoardDocuments>,
) {
	const rows = new Map<string, string>();
	base.forEach((item, index, all) => {
		rows.set(item.id, boardItemToNode(item, index, all.length).orderKey ?? "");
	});
	for (const op of ops) {
		if (op.type === "node.create") {
			const node = op.payload.node;
			rows.set(node.nodeId, node.orderKey ?? "");
		} else if (op.type === "node.patch") {
			const patch = op.payload.patch as { orderKey?: string };
			if (patch.orderKey !== undefined)
				rows.set(op.payload.nodeId, patch.orderKey);
		} else if (op.type === "node.delete") {
			rows.delete(op.payload.nodeId);
		}
	}
	return [...rows.entries()]
		.sort(([, a], [, b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([id]) => id);
}

for (const [label, materialize] of [
	["sparse keys", synced],
	["legacy index keys", legacySynced],
] as const) {
	test(`${label}: one-node edits cost one operation`, () => {
		const base = materialize(items(500));
		const before = documentOf(base);
		const newItem = createFileBoardItem("docs/new.md", 0, 0);

		const cases: Array<[string, BoardItem[], Record<string, number>]> = [
			["delete first", base.slice(1), { "node.delete": 1 }],
			[
				"delete middle",
				[...base.slice(0, 250), ...base.slice(251)],
				{ "node.delete": 1 },
			],
			["delete last", base.slice(0, -1), { "node.delete": 1 }],
			["append", [...base, newItem], { "node.create": 1 }],
			[
				"insert middle",
				[...base.slice(0, 250), newItem, ...base.slice(250)],
				{ "node.create": 1 },
			],
			["insert front", [newItem, ...base], { "node.create": 1 }],
			[
				"bring to front",
				[...base.slice(0, 10), ...base.slice(11), base[10] as BoardItem],
				{ "node.patch": 1 },
			],
			[
				"send to back",
				[base[400] as BoardItem, ...base.slice(0, 400), ...base.slice(401)],
				{ "node.patch": 1 },
			],
		];

		for (const [name, after, expected] of cases) {
			const ops = diffBoardDocuments(before, documentOf(after));
			assert.deepEqual(countByType(ops), expected, name);
			// The server's own ordering must reproduce the document.
			assert.deepEqual(
				serverOrderAfter(base, ops),
				after.map((item) => item.id),
				`${name}: server order`,
			);
		}
	});
}

test("moving a node without reordering emits no order key churn", () => {
	const base = synced(items(300));
	const dragged = base.map((item, index) =>
		index === 42 ? { ...item, frame: { ...item.frame, x: -999 } } : item,
	);
	const ops = diffBoardDocuments(documentOf(base), documentOf(dragged));
	assert.equal(ops.length, 1);
	assert.equal(ops[0]?.type, "node.patch");
	const patch = ops[0]?.payload as { patch: Record<string, unknown> };
	// Only the geometry moved, so the key must not be in the patch at all.
	assert.ok(!("orderKey" in patch.patch), "order key must not be rewritten");
});

test("a bulk delete is one operation per deleted node and nothing more", () => {
	const base = synced(items(1000));
	const kept = base.filter((_, index) => index % 2 === 0);
	const ops = diffBoardDocuments(documentOf(base), documentOf(kept));
	assert.deepEqual(countByType(ops), { "node.delete": 500 });
	assert.deepEqual(
		serverOrderAfter(base, ops),
		kept.map((item) => item.id),
	);
});

test("an unchanged document produces no operations", () => {
	const document = documentOf(synced(items(200)));
	assert.deepEqual(diffBoardDocuments(document, document), []);
});

test("the wire payload drops the client-only inverse", () => {
	const base = synced(items(50));
	const ops = diffBoardDocuments(documentOf(base), documentOf(base.slice(1)));
	assert.ok(ops[0]?.inverse, "the local op keeps its inverse for undo");
	const wire = toWireOperations(ops);
	assert.equal(wire[0]?.inverse, undefined);
	// The inverse of a delete is the entire node record, so this is most of the
	// payload; it also counts against the server's per-transaction byte cap.
	assert.ok(
		JSON.stringify(wire).length * 2 < JSON.stringify(ops).length,
		"stripping the inverse should more than halve a delete payload",
	);
	// Stripping must not disturb the operation itself.
	assert.deepEqual(wire[0]?.payload, ops[0]?.payload);
	assert.equal(wire.length, ops.length);
});
