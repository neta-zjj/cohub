import assert from "node:assert/strict";
import { test } from "node:test";
import {
	type BoardDocument,
	type BoardItem,
	BoardItemSchema,
	shapeCapabilities,
} from "@neta-art/cohub/board";
import {
	boardItemToNode,
	boardNodeToItem,
	createEmptyBoardDocument,
	diffBoardDocuments,
} from "../lib/board/board-document.ts";
import {
	createFileBoardItem,
	createFileNodeForPath,
} from "../lib/board/board-items.ts";
// Importing the shape registry registers the built-in definitions.
import "../lib/board/core/shapes.ts";

const wrapNode = (node: ReturnType<typeof boardItemToNode>) => ({
	boardId: "d",
	version: 0,
	createdAt: null,
	updatedAt: null,
	...node,
});

test("every file type is accepted, not just media", () => {
	const cases: Array<[string, BoardItem["type"]]> = [
		["a/photo.png", "image"],
		["a/clip.mp4", "video"],
		["a/readme.md", "file"],
		["a/data.json", "file"],
		["a/archive.tar.gz", "file"],
		["a/binary.wasm", "file"],
		["a/Makefile", "file"],
		["a/.npmrc", "file"],
	];
	for (const [path, expected] of cases) {
		const item = createFileNodeForPath(path, 0, 0);
		assert.equal(item.type, expected, `${path} → ${expected}`);
	}
});

test("file card is centred on the drop point", () => {
	const item = createFileBoardItem("docs/a.md", 100, 50);
	assert.equal(item.frame.x + item.frame.width / 2, 100);
	assert.equal(item.frame.y + item.frame.height / 2, 50);
});

test("a card with a cover is created taller, so it never resizes later", () => {
	const plain = createFileBoardItem("docs/a.md", 0, 0, { excerpt: "hi" });
	const withCover = createFileBoardItem("docs/b.md", 0, 0, {
		coverPath: "docs/hero.png",
	});
	assert.ok(withCover.frame.height > plain.frame.height);
});

test("file node round-trips through the server node mapping", () => {
	const item = createFileBoardItem("docs/post.md", 0, 0, {
		title: "Post",
		excerpt: "Body text",
		coverPath: "docs/hero.png",
		mimeType: "text/markdown",
		size: 1234,
		mtimeMs: 42,
	});
	const node = boardItemToNode(item, 0);

	assert.equal(node.type, "file");
	assert.equal(node.refKind, "space_file");
	assert.equal(node.refPath, "docs/post.md");
	// Display facts live in `view`, alongside image/video snapshots.
	assert.equal((node.view as Record<string, unknown>).excerpt, "Body text");

	const back = boardNodeToItem(wrapNode(node));
	assert.equal(back.type, "file");
	if (back.type !== "file") return;
	assert.equal(back.ref.path, "docs/post.md");
	assert.equal(back.snapshot?.title, "Post");
	assert.equal(back.snapshot?.coverPath, "docs/hero.png");
	assert.equal(back.snapshot?.mtimeMs, 42);
});

test("a remote cover never becomes the node's ref", () => {
	const item = createFileBoardItem("docs/post.md", 0, 0, {
		coverUrl: "https://cdn.example/hero.png",
	});
	const node = boardItemToNode(item, 0);
	// The ref must stay the workspace file: the server rejects network URLs in
	// refUrl, and the file is what the card points at.
	assert.equal(node.refUrl, null);
	assert.equal(node.refPath, "docs/post.md");
	assert.equal(
		(node.view as Record<string, unknown>).coverUrl,
		"https://cdn.example/hero.png",
	);
});

test("a malformed snapshot degrades to a blank card instead of failing", () => {
	const node = boardItemToNode(createFileBoardItem("a/b.md", 0, 0), 0);
	const back = boardNodeToItem(
		wrapNode({ ...node, view: { excerpt: 42, size: "big" } as never }),
	);
	// Still a usable file card; only the unparsable facts are dropped.
	assert.equal(back.type, "file");
	if (back.type !== "file") return;
	assert.equal(back.snapshot, undefined);
	assert.equal(back.ref.path, "a/b.md");
});

test("file items satisfy the item schema", () => {
	const item = createFileBoardItem("a/b.md", 0, 0, { excerpt: "x" });
	assert.equal(BoardItemSchema.safeParse(item).success, true);
});

test("file cards open rather than edit, and do not rotate", () => {
	const capabilities = shapeCapabilities(createFileBoardItem("a/b.md", 0, 0));
	// Activating a file card opens the workspace preview, so there is no inline
	// canvas editor to enter.
	assert.equal(capabilities.canEdit, false);
	assert.equal(capabilities.canRotate, false);
	assert.equal(capabilities.canResize, true);
	// Card content is chrome and text at a fixed layout, not one scaled image.
	assert.equal(capabilities.aspectLocked, false);
});

// ─── Commit diff scaling ────────────────────────────────────────────

function documentWith(items: BoardItem[]): BoardDocument {
	return { ...createEmptyBoardDocument(), items };
}

function manyItems(count: number): BoardItem[] {
	return Array.from({ length: count }, (_, index) =>
		createFileBoardItem(`docs/f${index}.md`, index * 10, 0),
	);
}

test("moving one node emits exactly one patch", () => {
	const before = documentWith(manyItems(500));
	const moved = before.items.map((item, index) =>
		index === 7 ? { ...item, frame: { ...item.frame, x: 999 } } : item,
	);
	const ops = diffBoardDocuments(before, documentWith(moved));
	assert.equal(ops.length, 1);
	assert.equal(ops[0]?.type, "node.patch");
	assert.equal(ops[0]?.payload.nodeId, before.items[7]?.id);
});

test("an untouched document produces no operations", () => {
	const doc = documentWith(manyItems(300));
	assert.deepEqual(diffBoardDocuments(doc, doc), []);
});

test("adds, deletes and reorders are all still detected", () => {
	const base = manyItems(5);

	const added = diffBoardDocuments(
		documentWith(base),
		documentWith([...base, createFileBoardItem("docs/new.md", 0, 0)]),
	);
	assert.equal(added.filter((op) => op.type === "node.create").length, 1);

	const deleted = diffBoardDocuments(
		documentWith(base),
		documentWith(base.slice(1)),
	);
	assert.equal(deleted.filter((op) => op.type === "node.delete").length, 1);

	// A reorder rewrites order keys, so every affected node is patched.
	const reordered = diffBoardDocuments(
		documentWith(base),
		documentWith([...base.slice(1), base[0] as BoardItem]),
	);
	assert.ok(
		reordered.filter((op) => op.type === "node.patch").length > 0,
		"reorder is represented as patches",
	);
});

test("snapshot enrichment is a patch, not a recreate", () => {
	const before = documentWith(manyItems(10));
	const enriched = before.items.map((item, index) =>
		index === 3 && item.type === "file"
			? { ...item, snapshot: { ...item.snapshot, excerpt: "new text" } }
			: item,
	);
	const ops = diffBoardDocuments(before, documentWith(enriched));
	assert.equal(ops.length, 1);
	assert.equal(ops[0]?.type, "node.patch");
	assert.ok(
		"view" in (ops[0]?.payload.patch ?? {}),
		"the excerpt lands in the node's view",
	);
});
