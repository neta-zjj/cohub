import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardOperation } from "@neta-art/cohub";
import {
	anchorToWorld,
	arrowBounds,
	BoardDocumentSchema,
	BoardItemSchema,
	bindEndpointAt,
	buildStrokeOutline,
	computeDrawBounds,
	distanceToArrow,
	distanceToStroke,
	isUnknownItem,
	parseBoardItemLoose,
	resolveArrow,
	shapeBounds,
	shapeCapabilities,
	shapeHitTest,
	simplifyDrawIndices,
	translateArrow,
	unknownRealType,
	worldToAnchor,
} from "@neta-art/cohub/board";
import {
	boardBootstrapToDocument,
	boardItemToNode,
	boardNodeToItem,
	createEmptyBoardDocument,
	parseBoardDocument,
	serializeBoardDocument,
} from "../lib/board/board-document.ts";
import {
	createArrowBoardItem,
	createDrawBoardItem,
	createGeoBoardItem,
	createTextBoardItem,
	createVideoBoardItem,
	duplicateBoardItem,
	mediaFrameSize,
} from "../lib/board/board-items.ts";
import { computeSnap } from "../lib/board/core/snapping.ts";
import "../lib/board/core/shapes.ts";
import type {
	BoardArrowItem,
	BoardDrawItem,
	BoardFrame,
	BoardGeoItem,
} from "@neta-art/cohub/board";
import { worldPoint } from "@neta-art/cohub/board";
import {
	operationsRequireBoardRuntimeRefresh,
	resolveBoardRuntime,
} from "../lib/board/runtime/board-runtime.ts";

const frame: BoardFrame = { x: 0, y: 0, width: 100, height: 100, rotation: 0 };

test("runtime operations require an atomic bootstrap refresh", () => {
	const boardOperation = {
		type: "board.patch",
		payload: { patch: { title: "Board" } },
	} as BoardOperation;
	const metadataOperation = {
		type: "board.patch",
		payload: { patch: { metadata: { playback: {} } } },
	} as BoardOperation;
	const effectOperation = {
		type: "effect.delete",
		payload: { effectId: "effect-1" },
	} as BoardOperation;
	const sequenceOperation = {
		type: "sequence.delete",
		payload: { sequenceId: "sequence-1" },
	} as BoardOperation;
	assert.equal(operationsRequireBoardRuntimeRefresh([boardOperation]), false);
	assert.equal(operationsRequireBoardRuntimeRefresh([metadataOperation]), true);
	assert.equal(operationsRequireBoardRuntimeRefresh([effectOperation]), true);
	assert.equal(operationsRequireBoardRuntimeRefresh([sequenceOperation]), true);
});

// ─── Schema: forward-compatible parsing ─────────────────────────────

test("parseBoardItemLoose validates a known geo item", () => {
	const item = parseBoardItemLoose({
		id: "g1",
		type: "geo",
		geo: "rectangle",
		text: "hi",
		color: "blue",
		frame,
	});
	assert.equal(item.type, "geo");
	assert.equal(isUnknownItem(item), false);
});

test("parseBoardItemLoose preserves an unknown shape type losslessly", () => {
	const raw = {
		id: "x1",
		type: "hologram",
		frame,
		intensity: 0.9,
		nested: { a: 1 },
	};
	const item = parseBoardItemLoose(raw);
	assert.equal(isUnknownItem(item), true);
	if (isUnknownItem(item)) {
		assert.equal(unknownRealType(item), "hologram");
		assert.equal(item.raw.intensity, 0.9);
		assert.deepEqual(item.raw.nested, { a: 1 });
	}
});

test("a malformed known item degrades to unknown instead of throwing", () => {
	// image without a valid ref should not throw the whole document.
	const item = parseBoardItemLoose({ id: "r1", type: "image", frame });
	assert.equal(isUnknownItem(item), true);
});

test("BoardDocumentSchema keeps unknown items through a parse round-trip", () => {
	const doc = BoardDocumentSchema.parse({
		kind: "cohub.board",
		version: 1,
		viewport: { x: 0, y: 0, zoom: 1 },
		items: [
			{ id: "t1", type: "text", text: "ok", frame },
			{ id: "x1", type: "future-shape", frame, custom: 42 },
		],
	});
	assert.equal(doc.items.length, 2);
	const unknown = doc.items[1];
	assert.equal(isUnknownItem(unknown), true);
	if (isUnknownItem(unknown))
		assert.equal(unknownRealType(unknown), "future-shape");
});

// ─── Node round-trip for new + unknown shapes ───────────────────────

test("geo item round-trips through node mapping", () => {
	const item = parseBoardItemLoose({
		id: "g1",
		type: "geo",
		geo: "rectangle",
		text: "hello",
		color: "green",
		frame,
	});
	const node = boardItemToNode(item, 0);
	assert.equal(node.type, "geo");
	const back = boardNodeToItem({
		boardId: "d",
		version: 0,
		createdAt: null,
		updatedAt: null,
		...node,
	});
	assert.equal(back.type, "geo");
	if (back.type === "geo") {
		assert.equal(back.text, "hello");
		assert.equal(back.color, "green");
	}
});

test("serializing an unknown item merges the current frame/id over raw", () => {
	const unknown = parseBoardItemLoose({
		id: "x1",
		type: "hologram",
		frame,
		intensity: 0.5,
	});
	const doc = createEmptyBoardDocument();
	// Simulate a move + duplicate-style id change applied to the item (not raw).
	const moved = {
		...unknown,
		id: "x1-copy",
		frame: { x: 500, y: 500, width: 100, height: 100, rotation: 0 },
	} as typeof unknown;
	const withItem = { ...doc, items: [moved] };
	const reparsed = parseBoardDocument(serializeBoardDocument(withItem));
	assert.ok(reparsed.ok);
	if (!reparsed.ok) return;
	const item = reparsed.document.items[0];
	assert.equal(isUnknownItem(item), true);
	if (isUnknownItem(item)) {
		// New id/position survive; the real type and custom field are preserved.
		assert.equal(item.id, "x1-copy");
		assert.equal(item.frame.x, 500);
		assert.equal(unknownRealType(item), "hologram");
		assert.equal(item.raw.intensity, 0.5);
	}
});

test("unknown item round-trips through node mapping without losing fields", () => {
	const item = parseBoardItemLoose({
		id: "x1",
		type: "hologram",
		frame,
		intensity: 0.7,
	});
	const node = boardItemToNode(item, 0);
	assert.equal(node.type, "hologram");
	assert.equal((node.data as Record<string, unknown>).intensity, 0.7);
	const back = boardNodeToItem({
		boardId: "d",
		version: 0,
		createdAt: null,
		updatedAt: null,
		...node,
	});
	assert.equal(isUnknownItem(back), true);
	if (isUnknownItem(back)) {
		assert.equal(unknownRealType(back), "hologram");
		assert.equal(back.raw.intensity, 0.7);
	}
});

test("unknown locked survives node mapping round-trip", () => {
	const item = parseBoardItemLoose({
		id: "x1",
		type: "hologram",
		frame,
		intensity: 0.7,
		locked: true,
	});
	assert.equal(item.locked, true);
	const node = boardItemToNode(item, 0);
	assert.equal((node.data as Record<string, unknown>).locked, true);
	const back = boardNodeToItem({
		boardId: "d",
		version: 0,
		createdAt: null,
		updatedAt: null,
		...node,
	});
	assert.equal(isUnknownItem(back), true);
	assert.equal(back.locked, true);
});

test("known item edits preserve wire fields owned by another runtime", () => {
	const item = boardNodeToItem({
		boardId: "d",
		nodeId: "g1",
		type: "geo",
		parentId: "page:one",
		orderKey: "a1",
		x: 1,
		y: 2,
		width: 100,
		height: 80,
		rotation: 0,
		refKind: "runtime_asset",
		refPath: "asset:one",
		refUrl: "https://example.com/asset",
		view: { runtimeView: true },
		style: { runtimeStyle: true },
		data: {
			geo: "rectangle",
			text: "Before",
			color: "green",
			metadata: { source: "other-runtime" },
			runtimeProps: { opacity: 0.5 },
		},
		version: 1,
		createdAt: null,
		updatedAt: null,
	});
	assert.deepEqual(item.metadata, { source: "other-runtime" });
	const edited = item.type === "geo" ? { ...item, text: "After" } : item;
	const node = boardItemToNode(edited, 0);
	assert.equal(node.parentId, "page:one");
	assert.equal(node.orderKey, "a1");
	assert.equal(node.refKind, "runtime_asset");
	assert.equal(node.refPath, "asset:one");
	assert.equal(node.refUrl, "https://example.com/asset");
	assert.deepEqual(node.view, { runtimeView: true });
	assert.deepEqual(node.style, { runtimeStyle: true });
	assert.deepEqual(node.data.runtimeProps, { opacity: 0.5 });
	assert.deepEqual(node.data.metadata, { source: "other-runtime" });
	assert.equal(node.data.text, "After");
});

test("bootstrap preserves the wire envelope through schema parsing", () => {
	const document = boardBootstrapToDocument({
		board: {
			id: "d",
			spaceId: "s",
			title: "Board",
			version: 1,
			metadata: {},
			createdAt: null,
			updatedAt: null,
		},
		nodes: [
			{
				boardId: "d",
				nodeId: "g1",
				type: "geo",
				parentId: "page:one",
				orderKey: "a1",
				x: 1,
				y: 2,
				width: 100,
				height: 80,
				rotation: 0,
				refKind: "runtime_asset",
				refPath: "asset:one",
				refUrl: "https://example.com/asset",
				view: { runtimeView: true },
				style: { runtimeStyle: true },
				data: {
					geo: "rectangle",
					text: "Before",
					color: "green",
					runtimeProps: { opacity: 0.5 },
				},
				version: 1,
				createdAt: null,
				updatedAt: null,
			},
		],
	});
	const item = document.items[0];
	assert.ok(item);
	const edited = item.type === "geo" ? { ...item, text: "After" } : item;
	const node = boardItemToNode(edited, 0);
	assert.equal(node.parentId, "page:one");
	assert.equal(node.orderKey, "a1");
	assert.equal(node.refKind, "runtime_asset");
	assert.equal(node.refPath, "asset:one");
	assert.equal(node.refUrl, "https://example.com/asset");
	assert.deepEqual(node.view, { runtimeView: true });
	assert.deepEqual(node.data.runtimeProps, { opacity: 0.5 });
	assert.equal(node.data.text, "After");
});

test("unknown item round-trip preserves the complete wire envelope", () => {
	const item = boardNodeToItem({
		boardId: "d",
		nodeId: "x1",
		type: "runtime:shape",
		parentId: "page:one",
		orderKey: "z9",
		x: 1,
		y: 2,
		width: 100,
		height: 80,
		rotation: 15,
		refKind: "runtime_asset",
		refPath: "asset:one",
		refUrl: "https://example.com/asset",
		view: { runtimeView: true },
		style: { runtimeStyle: true },
		data: { runtimeProps: { opacity: 0.5 } },
		version: 1,
		createdAt: null,
		updatedAt: null,
	});
	const node = boardItemToNode(item, 0);
	assert.equal(node.parentId, "page:one");
	assert.equal(node.orderKey, "z9");
	assert.equal(node.refKind, "runtime_asset");
	assert.equal(node.refPath, "asset:one");
	assert.equal(node.refUrl, "https://example.com/asset");
	assert.deepEqual(node.view, { runtimeView: true });
	assert.deepEqual(node.style, { runtimeStyle: true });
	assert.deepEqual(node.data.runtimeProps, { opacity: 0.5 });
});

// ─── Draw geometry ──────────────────────────────────────────────────

test("computeDrawBounds pads by stroke width", () => {
	const bounds = computeDrawBounds(
		[
			{ x: 0, y: 0, p: 0.5 },
			{ x: 10, y: 0, p: 0.5 },
		],
		4,
	);
	assert.ok(bounds.x < 0);
	assert.ok(bounds.width > 10);
});

test("simplifyDrawIndices keeps endpoints and removes collinear points", () => {
	const points = [
		{ x: 0, y: 0, p: 0.5 },
		{ x: 5, y: 0, p: 0.5 },
		{ x: 10, y: 0, p: 0.5 },
		{ x: 10, y: 10, p: 0.5 },
	];
	const indices = simplifyDrawIndices(points, 0.1);
	assert.equal(indices[0], 0);
	assert.equal(indices[indices.length - 1], 3);
	assert.ok(indices.length < points.length);
});

test("buildStrokeOutline produces a closed ribbon", () => {
	const outline = buildStrokeOutline(
		[
			{ x: 0, y: 0, p: 0.5 },
			{ x: 10, y: 0, p: 0.5 },
		],
		4,
	);
	assert.ok(outline.length >= 4);
});

test("distanceToStroke is small near the line and large far away", () => {
	const points = [
		{ x: 0, y: 0, p: 0.5 },
		{ x: 10, y: 0, p: 0.5 },
	];
	assert.ok(distanceToStroke(points, worldPoint(5, 0.5)) < 1);
	assert.ok(distanceToStroke(points, worldPoint(5, 50)) > 40);
});

// ─── Arrow bindings ─────────────────────────────────────────────────

test("anchorToWorld and worldToAnchor are inverse on an unrotated frame", () => {
	const f: BoardFrame = {
		x: 100,
		y: 100,
		width: 200,
		height: 100,
		rotation: 0,
	};
	const world = anchorToWorld(f, 0.25, 0.5);
	assert.equal(world.x, 150);
	assert.equal(world.y, 150);
	const anchor = worldToAnchor(f, world);
	assert.ok(Math.abs(anchor.nx - 0.25) < 1e-9);
	assert.ok(Math.abs(anchor.ny - 0.5) < 1e-9);
});

test("anchorToWorld respects frame rotation", () => {
	const f: BoardFrame = { x: 0, y: 0, width: 100, height: 100, rotation: 90 };
	// Anchor at right-center (1, 0.5) rotates to bottom-center.
	const world = anchorToWorld(f, 1, 0.5);
	assert.ok(Math.abs(world.x - 50) < 1e-6);
	assert.ok(Math.abs(world.y - 100) < 1e-6);
});

test("resolveArrow computes a straight control point when bend is 0", () => {
	const arrow: BoardArrowItem = {
		id: "a1",
		type: "arrow",
		frame,
		start: { kind: "point", x: 0, y: 0 },
		end: { kind: "point", x: 100, y: 0 },
		bend: 0,
		color: "brand",
		size: 3,
		arrowStart: false,
		arrowEnd: true,
		label: "",
	};
	const resolved = resolveArrow(arrow, () => undefined);
	assert.ok(resolved);
	assert.equal(resolved?.control.x, 50);
	assert.equal(resolved?.control.y, 0);
});

test("a bound arrow tracks its target when the target moves", () => {
	const targetFrame: BoardFrame = {
		x: 0,
		y: 0,
		width: 100,
		height: 100,
		rotation: 0,
	};
	const arrow: BoardArrowItem = {
		id: "a1",
		type: "arrow",
		frame,
		start: { kind: "binding", target: "box", nx: 1, ny: 0.5, precise: true },
		end: { kind: "point", x: 300, y: 50 },
		bend: 0,
		color: "brand",
		size: 3,
		arrowStart: false,
		arrowEnd: true,
		label: "",
	};
	const before = resolveArrow(arrow, (id) =>
		id === "box" ? targetFrame : undefined,
	);
	assert.equal(before?.start.x, 100);
	// Move the target +200 in x; the bound endpoint follows.
	const moved = { ...targetFrame, x: 200 };
	const after = resolveArrow(arrow, (id) => (id === "box" ? moved : undefined));
	assert.equal(after?.start.x, 300);
});

test("arrowBounds returns a finite box (regression: maxY init)", () => {
	const arrow: BoardArrowItem = {
		id: "a1",
		type: "arrow",
		frame,
		start: { kind: "point", x: 0, y: 0 },
		end: { kind: "point", x: 100, y: 40 },
		bend: 0,
		color: "brand",
		size: 3,
		arrowStart: false,
		arrowEnd: true,
		label: "",
	};
	const bounds = arrowBounds(arrow, () => undefined);
	assert.ok(bounds);
	assert.ok(Number.isFinite(bounds?.width));
	assert.ok(Number.isFinite(bounds?.height));
	assert.ok(bounds?.height >= 40);
});

test("distanceToArrow is small near the line", () => {
	const arrow: BoardArrowItem = {
		id: "a1",
		type: "arrow",
		frame,
		start: { kind: "point", x: 0, y: 0 },
		end: { kind: "point", x: 100, y: 0 },
		bend: 0,
		color: "brand",
		size: 3,
		arrowStart: false,
		arrowEnd: true,
		label: "",
	};
	assert.ok(distanceToArrow(arrow, () => undefined, worldPoint(50, 2)) < 5);
	assert.ok(distanceToArrow(arrow, () => undefined, worldPoint(50, 80)) > 50);
});

test("bindEndpointAt binds when a target is present, else stays free", () => {
	const bound = bindEndpointAt(worldPoint(50, 50), {
		id: "box",
		frame: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
	});
	assert.equal(bound.kind, "binding");
	const free = bindEndpointAt(worldPoint(50, 50), null);
	assert.equal(free.kind, "point");
});

// ─── Snapping ───────────────────────────────────────────────────────

test("computeSnap snaps a near-aligned edge and emits a guide", () => {
	const moving = { x: 102, y: 0, width: 50, height: 50 };
	const target = { x: 0, y: 0, width: 100, height: 50 };
	const result = computeSnap(moving, [target], { threshold: 8 });
	// moving.x (102) snaps to target right edge (100): dx = -2.
	assert.equal(result.dx, -2);
	assert.equal(
		result.guides.some((g) => g.axis === "x" && g.at === 100),
		true,
	);
});

test("computeSnap returns zero delta beyond the threshold", () => {
	const moving = { x: 200, y: 0, width: 50, height: 50 };
	const target = { x: 0, y: 0, width: 100, height: 50 };
	const result = computeSnap(moving, [target], { threshold: 8 });
	assert.equal(result.dx, 0);
	assert.equal(result.dy, 0);
});

test("computeSnap snaps to grid when enabled", () => {
	const moving = { x: 33, y: 0, width: 10, height: 10 };
	const result = computeSnap(moving, [], { threshold: 8, gridSize: 32 });
	// 33 rounds to 32.
	assert.equal(result.dx, -1);
});

// ─── Shape definitions ──────────────────────────────────────────────

test("geo ellipse hit test rejects corners", () => {
	const geo: BoardGeoItem = {
		id: "g1",
		type: "geo",
		geo: "ellipse",
		text: "",
		color: "brand",
		fillOpacity: 0.12,
		frame: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
	};
	// Center hits, corner (outside the ellipse) misses.
	assert.equal(shapeHitTest(geo, worldPoint(50, 50)), true);
	assert.equal(shapeHitTest(geo, worldPoint(2, 2)), false);
});

test("draw hit test is true near the stroke and false far away", () => {
	const draw: BoardDrawItem = {
		id: "d1",
		type: "draw",
		points: [
			{ x: 0, y: 0, p: 0.5 },
			{ x: 100, y: 0, p: 0.5 },
		],
		color: "brand",
		size: 4,
		frame: { x: 0, y: 0, width: 100, height: 4, rotation: 0 },
	};
	assert.equal(shapeHitTest(draw, worldPoint(50, 2)), true);
	assert.equal(shapeHitTest(draw, worldPoint(50, 60)), false);
});

test("text is editable and draw scales its geometry", () => {
	assert.equal(
		shapeCapabilities({ id: "t", type: "text", text: "", frame } as never)
			.canEdit,
		true,
	);
	const draw: BoardDrawItem = {
		id: "d",
		type: "draw",
		points: [],
		color: "brand",
		size: 4,
		frame,
	};
	// A stroke resizes by scaling its points and width, so the box stays hugged
	// to the ink and the aspect can never be distorted.
	assert.equal(shapeCapabilities(draw).canResize, true);
	assert.equal(shapeCapabilities(draw).aspectLocked, true);
});

test("content-scaling shapes lock their aspect; container shapes do not", () => {
	const aspectLockedFor = (item: unknown) =>
		shapeCapabilities(item as never).aspectLocked;
	// Text scales one font size; media has fixed pixel aspect — both must never
	// letterbox or distort.
	assert.equal(
		aspectLockedFor({ id: "t", type: "text", text: "", frame }),
		true,
	);
	assert.equal(
		aspectLockedFor({
			id: "i",
			type: "image",
			ref: { kind: "space-file", path: "a.png" },
			frame,
		}),
		true,
	);
	assert.equal(
		aspectLockedFor({
			id: "v",
			type: "video",
			ref: { kind: "space-file", path: "a.mp4" },
			frame,
		}),
		true,
	);
	// Containers reflow their contents, so free resize is the intuitive default.
	assert.equal(
		aspectLockedFor({
			id: "g",
			type: "geo",
			geo: "rectangle",
			text: "",
			frame,
		}),
		false,
	);
	assert.equal(
		aspectLockedFor({ id: "f", type: "frame", label: "Frame", frame }),
		false,
	);
});

test("shapeBounds falls back to frame bounds for box shapes", () => {
	const bounds = shapeBounds({
		id: "t",
		type: "text",
		text: "",
		frame,
	} as never);
	assert.equal(bounds.width, 100);
});

// Helper re-export guard: ensure the empty document constructor works.
test("createEmptyBoardDocument yields an empty document", () => {
	const doc = createEmptyBoardDocument();
	assert.equal(doc.items.length, 0);
});

test("runtime resolution follows the persisted semantic model", () => {
	const runtime = resolveBoardRuntime(createEmptyBoardDocument());
	assert.equal(runtime.id, "cohub-pixi");
	assert.equal(runtime.modelKind, "cohub.board");
});

test("board bootstrap restores persisted document appearance", () => {
	const document = boardBootstrapToDocument({
		board: {
			id: "d",
			spaceId: "s",
			title: "Board",
			version: 1,
			metadata: {
				appearance: {
					theme: "clean",
					background: { kind: "grid", color: "#123456" },
					grid: { visible: true, size: 40, opacity: 0.2 },
					mood: "natural",
				},
			},
			createdAt: null,
			updatedAt: null,
		},
		nodes: [],
	});
	assert.equal(document.appearance.background.kind, "grid");
	assert.equal(document.appearance.background.color, "#123456");
	assert.equal(document.appearance.grid.size, 40);
	assert.equal(document.appearance.mood, "natural");
});

// ─── Item creation helpers ───────────────────────────────────────

test("createTextBoardItem uses the shared readable default style", () => {
	const item = createTextBoardItem("Hello", 10, 20);
	assert.equal(item.type, "text");
	if (item.type !== "text") return;
	assert.equal(item.color, "neutral");
	assert.equal(item.fontSize, 24);
	assert.equal(item.frame.x, 10);
	assert.equal(item.frame.y, 20);
	assert.equal(item.frame.height, 32);
});

test("createTextBoardItem measures an explicit tool style", () => {
	const item = createTextBoardItem("Hello", 0, 0, "rose", 32);
	assert.equal(item.type, "text");
	if (item.type !== "text") return;
	assert.equal(item.color, "rose");
	assert.equal(item.fontSize, 32);
	assert.ok(item.frame.width > 0);
	assert.ok(item.frame.height > 32);
});

test("createGeoBoardItem carries the chosen geometry", () => {
	const item = createGeoBoardItem("ellipse", 0, 0, "blue");
	assert.equal(item.type, "geo");
	if (item.type === "geo") {
		assert.equal(item.geo, "ellipse");
		assert.equal(item.color, "blue");
	}
});

test("createDrawBoardItem stores points relative to the bounds frame", () => {
	const world = [
		{ x: 100, y: 100, p: 0.5 },
		{ x: 150, y: 120, p: 0.5 },
	];
	const item = createDrawBoardItem(world, "brand", 4);
	assert.equal(item.type, "draw");
	if (item.type === "draw") {
		// Frame origin is near the first point (minus stroke padding); local
		// points are small offsets from it.
		assert.ok(item.frame.x < 100);
		assert.ok(item.points[0].x < 10);
		assert.ok(item.points[0].y < 10);
	}
});

test("scaling a stroke keeps its bounds proportional to the frame", () => {
	const item = createDrawBoardItem(
		[
			{ x: 100, y: 100, p: 0.5 },
			{ x: 150, y: 120, p: 0.5 },
		],
		"brand",
		4,
	);
	assert.equal(item.type, "draw");
	if (item.type !== "draw") return;
	const scale = 2;
	// This mirrors the editor's resize bake: points and width scale together.
	const scaledPoints = item.points.map((point) => ({
		x: point.x * scale,
		y: point.y * scale,
		p: point.p,
	}));
	const before = computeDrawBounds(item.points, item.size);
	const after = computeDrawBounds(scaledPoints, item.size * scale);
	// Uniform scale: bounds grow by exactly the same factor on both axes, so the
	// selection box stays hugged to the ink.
	assert.ok(Math.abs(after.width - before.width * scale) < 1e-6);
	assert.ok(Math.abs(after.height - before.height * scale) < 1e-6);
});

test("mediaFrameSize preserves natural aspect and falls back per media kind", () => {
	const wide = mediaFrameSize(1920, 1080);
	assert.ok(Math.abs(wide.width / wide.height - 16 / 9) < 1e-6);
	// Bounded by the max edge rather than upscaled.
	assert.equal(wide.width, 480);
	// Smaller-than-max images keep their intrinsic size.
	assert.deepEqual(mediaFrameSize(120, 90), { width: 120, height: 90 });
	// Unknown dimensions use the caller's fallback (video defaults to 16:9).
	assert.deepEqual(mediaFrameSize(null, null), { width: 320, height: 200 });
	assert.deepEqual(
		mediaFrameSize(null, null, 480, { width: 320, height: 180 }),
		{
			width: 320,
			height: 180,
		},
	);
});

test("createVideoBoardItem defaults to a 16:9 frame when size is unknown", () => {
	const item = createVideoBoardItem("clip.mp4", 0, 0);
	assert.ok(Math.abs(item.frame.width / item.frame.height - 16 / 9) < 1e-6);
});

test("createArrowBoardItem builds a frame spanning both endpoints", () => {
	const item = createArrowBoardItem({ x: 0, y: 0 }, { x: 100, y: 50 }, "brand");
	assert.equal(item.type, "arrow");
	if (item.type === "arrow") {
		assert.equal(item.start.kind, "point");
		assert.equal(item.end.kind, "point");
		assert.ok(item.frame.width >= 100);
		assert.ok(item.frame.height >= 50);
		assert.equal(item.arrowEnd, true);
		assert.equal(item.size, 2.5);
	}
});

test("createArrowBoardItem honours provided bindings", () => {
	const binding = {
		kind: "binding" as const,
		target: "box",
		nx: 0.5,
		ny: 0.5,
		precise: true,
	};
	const item = createArrowBoardItem(
		{ x: 0, y: 0 },
		{ x: 100, y: 0 },
		"brand",
		binding,
	);
	if (item.type === "arrow") assert.equal(item.start.kind, "binding");
});

test("translateArrow moves free endpoints but keeps bindings anchored", () => {
	const arrow: BoardArrowItem = {
		id: "a1",
		type: "arrow",
		frame,
		start: { kind: "point", x: 0, y: 0 },
		end: { kind: "binding", target: "box", nx: 0.5, ny: 0.5, precise: true },
		bend: 0,
		color: "brand",
		size: 3,
		arrowStart: false,
		arrowEnd: true,
		label: "",
	};
	const moved = translateArrow(arrow, 100, 50, () => undefined);
	// Free start moved by the delta…
	assert.equal(moved.start.kind, "point");
	if (moved.start.kind === "point") {
		assert.equal(moved.start.x, 100);
		assert.equal(moved.start.y, 50);
	}
	// …bound end is unchanged (still anchored to its target).
	assert.equal(moved.end.kind, "binding");
	if (moved.end.kind === "binding") assert.equal(moved.end.target, "box");
});

test("duplicating an arrow offsets its free endpoints (no overlap)", () => {
	const arrow = createArrowBoardItem({ x: 0, y: 0 }, { x: 100, y: 0 }, "brand");
	const copy = duplicateBoardItem(arrow);
	assert.notEqual(copy.id, arrow.id);
	if (copy.type === "arrow" && arrow.type === "arrow") {
		assert.ok(copy.start.kind === "point" && arrow.start.kind === "point");
		if (copy.start.kind === "point" && arrow.start.kind === "point")
			assert.ok(copy.start.x > arrow.start.x);
	}
});

export { BoardItemSchema };
