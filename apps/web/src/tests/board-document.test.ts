import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardDocument, BoardItem } from "@neta-art/cohub/board";
import {
	applyBoardOps,
	diffBoardDocuments,
	invertBoardOps,
	rebaseOnRemote,
	reconcileExternal,
} from "../lib/board/board-document.ts";

function doc(items: BoardItem[]): BoardDocument {
	return {
		kind: "cohub.board",
		version: 1,
		appearance: {
			theme: "clean",
			background: { kind: "grid" },
			grid: { visible: true, size: 32, opacity: 0.22 },
			mood: "clean",
		},
		viewport: { x: 0, y: 0, zoom: 1 },
		items,
	};
}

function textItem(id: string, text: string, x = 0): BoardItem {
	return {
		id,
		type: "text",
		text,
		color: "neutral",
		fontSize: 18,
		frame: { x, y: 0, width: 100, height: 100, rotation: 0 },
	};
}

const texts = (d: BoardDocument) =>
	new Map(
		d.items.map((item) => [item.id, item.type === "text" ? item.text : ""]),
	);

test("diff marks interactive deletes with a structured reason", () => {
	const [op] = diffBoardDocuments(doc([textItem("a", "delete")]), doc([]));
	assert.equal(op?.type, "node.delete");
	if (op?.type === "node.delete")
		assert.equal(op.payload.reason, "user-delete");
});

test("document patches preserve items and sync appearance", () => {
	const document = doc([textItem("a", "keep")]);
	const appearance = {
		theme: "clean",
		background: { kind: "solid" as const, color: "#123456" },
		grid: { visible: false, size: 24, opacity: 0.12 },
		mood: "natural" as const,
	};
	const result = applyBoardOps(document, [
		{
			type: "board.patch",
			payload: { patch: { metadata: { appearance } } },
		},
	]);
	assert.deepEqual(result.items, document.items);
	assert.deepEqual(result.appearance, appearance);
});

test("document patch inverse restores the previous meta", () => {
	const [inverse] = invertBoardOps([
		{
			type: "board.patch",
			payload: { patch: { metadata: { modelKind: "next" } } },
			inverse: { patch: { metadata: { modelKind: "previous" } } },
		},
	]);
	assert.deepEqual(inverse, {
		type: "board.patch",
		payload: { patch: { metadata: { modelKind: "previous" } } },
		inverse: { patch: { metadata: { modelKind: "next" } } },
	});
});

test("rebase with no local changes adopts the remote document", () => {
	const baseline = doc([textItem("a", "1")]);
	const remote = doc([textItem("a", "1"), textItem("b", "2")]);
	const { merged, hadLocalChanges } = rebaseOnRemote(
		baseline,
		baseline,
		remote,
	);
	assert.equal(hadLocalChanges, false);
	assert.deepEqual([...texts(merged).keys()], ["a", "b"]);
});

test("rebase preserves a local create alongside a remote create", () => {
	const baseline = doc([textItem("a", "1")]);
	const local = doc([textItem("a", "1"), textItem("local", "L")]);
	const remote = doc([textItem("a", "1"), textItem("remote", "R")]);
	const { merged, hadLocalChanges } = rebaseOnRemote(baseline, local, remote);
	assert.equal(hadLocalChanges, true);
	const map = texts(merged);
	assert.equal(map.get("remote"), "R");
	assert.equal(map.get("local"), "L");
});

test("rebase keeps a local patch on a node the remote also patched (local wins)", () => {
	const baseline = doc([textItem("a", "base")]);
	const local = doc([textItem("a", "local-edit")]);
	const remote = doc([textItem("a", "remote-edit")]);
	const { merged } = rebaseOnRemote(baseline, local, remote);
	// Local changes are applied last, so the local edit wins the same-field race.
	assert.equal(texts(merged).get("a"), "local-edit");
});

test("rebase honours a local delete over a remote patch", () => {
	const baseline = doc([textItem("a", "base"), textItem("b", "keep")]);
	const local = doc([textItem("b", "keep")]); // deleted "a"
	const remote = doc([textItem("a", "remote-edit"), textItem("b", "keep")]);
	const { merged } = rebaseOnRemote(baseline, local, remote);
	assert.equal(texts(merged).has("a"), false);
	assert.equal(texts(merged).get("b"), "keep");
});

test("rebase drops a local patch on a node the remote deleted", () => {
	const baseline = doc([textItem("a", "base"), textItem("b", "keep")]);
	const local = doc([textItem("a", "local-edit"), textItem("b", "keep")]);
	const remote = doc([textItem("b", "keep")]); // deleted "a"
	const { merged } = rebaseOnRemote(baseline, local, remote);
	// Remote delete wins: the local patch has no node to apply to.
	assert.equal(texts(merged).has("a"), false);
	assert.equal(texts(merged).get("b"), "keep");
});

test("rebase preserves unrelated local position changes", () => {
	const baseline = doc([textItem("a", "1", 0)]);
	const local = doc([textItem("a", "1", 250)]); // moved
	const remote = doc([textItem("a", "1", 0), textItem("b", "2")]);
	const { merged } = rebaseOnRemote(baseline, local, remote);
	const a = merged.items.find((item) => item.id === "a");
	assert.equal(a?.frame.x, 250);
	assert.equal(texts(merged).has("b"), true);
});

test("reconcileExternal rebases on a same-document refresh", () => {
	const baseline = doc([textItem("a", "1")]);
	const local = doc([textItem("a", "1"), textItem("local", "L")]);
	const remote = doc([textItem("a", "1"), textItem("remote", "R")]);
	const { merged, hadLocalChanges } = reconcileExternal(
		baseline,
		local,
		remote,
		true,
	);
	assert.equal(hadLocalChanges, true);
	assert.equal(texts(merged).get("local"), "L");
	assert.equal(texts(merged).get("remote"), "R");
});

test("reconcileExternal on a document switch drops the old document's local changes", () => {
	// Document A: baseline has node "a"; the user created an uncommitted "draft".
	const baselineA = doc([textItem("a", "1")]);
	const localA = doc([textItem("a", "1"), textItem("draft", "unsaved")]);
	// Document B: a completely different document.
	const documentB = doc([textItem("b", "2")]);
	const { merged, hadLocalChanges } = reconcileExternal(
		baselineA,
		localA,
		documentB,
		false, // switching documents, not a same-document refresh
	);
	// A's uncommitted "draft" must NOT leak into B.
	assert.equal(hadLocalChanges, false);
	assert.equal(texts(merged).has("draft"), false);
	assert.equal(texts(merged).has("a"), false);
	assert.deepEqual([...texts(merged).keys()], ["b"]);
});
