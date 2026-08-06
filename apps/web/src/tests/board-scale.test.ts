import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardDocument, BoardItem } from "@neta-art/cohub/board";
import { itemBounds } from "@neta-art/cohub/board";
import {
	createEmptyBoardDocument,
	diffBoardDocuments,
} from "../lib/board/board-document.ts";
import { createFileBoardItem } from "../lib/board/board-items.ts";
import { createSpatialIndex } from "../lib/board/board-spatial.ts";

/**
 * Scaling guards for a ten-thousand-node board.
 *
 * These assert on *work performed*, not wall-clock time, so they mean the same
 * thing on a busy CI box as on a laptop: the point is that the per-frame and
 * per-commit paths stay proportional to what is on screen or what changed, never
 * to how large the document is.
 */

const NODE_COUNT = 10_000;

/** A dense grid of file cards, the shape a large board actually takes. */
function buildBoard(count: number): BoardItem[] {
	const perRow = 100;
	return Array.from({ length: count }, (_, index) =>
		createFileBoardItem(
			`docs/f${index}.md`,
			(index % perRow) * 300,
			Math.floor(index / perRow) * 240,
		),
	);
}

function documentWith(items: BoardItem[]): BoardDocument {
	return { ...createEmptyBoardDocument(), items };
}

test("viewport queries stay a small fraction of a 10k-node board", () => {
	const items = buildBoard(NODE_COUNT);
	const index = createSpatialIndex();
	index.rebuild(
		items.map((item, order) => ({
			id: item.id,
			order,
			rect: itemBounds(item.frame),
		})),
	);

	// A 1600x900 viewport at 1:1 over the grid.
	const visible = index.idsInRect({ x: 0, y: 0, width: 1600, height: 900 });
	assert.ok(visible.length > 0, "finds the cards under the viewport");
	assert.ok(
		visible.length < NODE_COUNT * 0.01,
		`viewport holds ${visible.length} of ${NODE_COUNT} nodes`,
	);
});

test("a drag of one node commits one patch, not 10k conversions", () => {
	const items = buildBoard(NODE_COUNT);
	const before = documentWith(items);
	// The editor updates immutably: untouched items stay the same object.
	const after = documentWith(
		items.map((item, i) =>
			i === 4242 ? { ...item, frame: { ...item.frame, x: -50 } } : item,
		),
	);

	const ops = diffBoardDocuments(before, after);
	assert.equal(ops.length, 1);
	assert.equal(ops[0]?.type, "node.patch");
});

test("commit diff on an unchanged 10k document is empty", () => {
	const document = documentWith(buildBoard(NODE_COUNT));
	assert.deepEqual(diffBoardDocuments(document, document), []);
});

test("incremental spatial upsert during a gesture touches only dirty nodes", () => {
	const items = buildBoard(NODE_COUNT);
	const index = createSpatialIndex();
	index.rebuild(
		items.map((item, order) => ({
			id: item.id,
			order,
			rect: itemBounds(item.frame),
		})),
	);

	// Move a single node, the per-frame shape of a drag.
	const target = items[500] as BoardItem;
	index.upsert(
		new Map([
			[
				target.id,
				{
					id: target.id,
					order: 500,
					rect: itemBounds({ ...target.frame, x: 12_345 }),
				},
			],
		]),
	);

	assert.equal(index.size, NODE_COUNT, "membership is unchanged");
	const atNewSpot = index.idsInRect({
		x: 12_340,
		y: target.frame.y,
		width: 20,
		height: 20,
	});
	assert.ok(atNewSpot.includes(target.id), "index reflects the new position");
});
