import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardFrame, BoardItem } from "@neta-art/cohub/board";
import { resizeFrame, worldPoint } from "@neta-art/cohub/board";
import {
	textResolutionForZoom,
	textZoomBucket,
} from "@neta-art/cohub/board/render";
import { createSpatialIndex } from "../lib/board/board-spatial.ts";
import { alignFrames, distributeFrames } from "../lib/board/core/align.ts";
import {
	encodeClipboard,
	materializeClipboard,
	parseClipboard,
} from "../lib/board/core/clipboard.ts";

const frame = (x: number, y: number, w = 100, h = 80): BoardFrame => ({
	x,
	y,
	width: w,
	height: h,
	rotation: 0,
});

let fixtureId = 0;
function box(x: number, y: number, color = "brand"): BoardItem {
	fixtureId += 1;
	return {
		id: `box-${fixtureId}`,
		type: "geo",
		geo: "rectangle",
		text: "",
		color,
		fillOpacity: 0,
		frame: frame(x - 100, y - 70, 200, 140),
	};
}

test("alignFrames left / center-x / right", () => {
	const frames = new Map<string, BoardFrame>([
		["a", frame(0, 0, 100, 50)],
		["b", frame(200, 10, 50, 50)],
	]);
	const left = alignFrames(frames, "left");
	assert.equal(left.get("b")?.x, 0);

	const right = alignFrames(frames, "right");
	assert.equal(right.get("a")?.x, 150); // 250 - 100

	const cx = alignFrames(frames, "center-x");
	// selection bounds: x0..250, center 125; a center should land on 125 → x=75
	assert.equal(cx.get("a")?.x, 75);
});

test("distributeFrames horizontal spaces evenly", () => {
	const frames = new Map<string, BoardFrame>([
		["a", frame(0, 0, 20, 20)],
		["b", frame(40, 0, 20, 20)],
		["c", frame(200, 0, 20, 20)],
	]);
	const next = distributeFrames(frames, "horizontal");
	// a and c stay outermost; b moves to midpoint of free space.
	// total span 0..220, sizes 60, gap = (220-60)/2 = 80
	// positions: 0, 100, 200
	assert.equal(next.get("b")?.x, 100);
	assert.equal(next.has("a"), false); // unchanged outermost
	assert.equal(next.has("c"), false);
});

test("clipboard round-trip remaps ids and offsets", () => {
	const a = box(10, 20);
	const b = box(50, 60, "blue");
	const payload = encodeClipboard([a, b]);
	assert.ok(payload);
	// Origin is the top-left of the selection AABB.
	assert.equal(payload?.origin.x, a.frame.x);
	assert.equal(payload?.origin.y, a.frame.y);

	const parsed = parseClipboard(payload);
	assert.ok(parsed);
	if (!parsed) return;
	const items = materializeClipboard(parsed, { x: 100, y: 100 });
	assert.equal(items.length, 2);
	assert.notEqual(items[0]?.id, a.id);
	assert.equal(items[0]?.frame.x, 100); // relative 0 + 100
	const dx = b.frame.x - a.frame.x;
	assert.equal(items[1]?.frame.x, 100 + dx);
});

test("parseClipboard rejects duplicate ids and malformed entries", () => {
	const item = box(0, 0);
	assert.equal(
		parseClipboard({
			kind: "cohub.board.clipboard",
			version: 1,
			origin: { x: 0, y: 0 },
			items: [item, { ...item }], // same id twice
		}),
		null,
	);
	assert.equal(
		parseClipboard({
			kind: "cohub.board.clipboard",
			version: 1,
			origin: { x: 0, y: 0 },
			items: [null, item],
		}),
		null,
	);
	assert.equal(
		parseClipboard({
			kind: "cohub.board.clipboard",
			version: 1,
			origin: { x: 0, y: 0 },
			items: [{ id: "r1", type: "image" }], // malformed known type
		}),
		null,
	);
});

test("textZoomBucket quantises zoom for re-rasterisation", () => {
	assert.equal(textZoomBucket(0.4), 0.5);
	assert.equal(textZoomBucket(1.2), 1.5);
	assert.equal(textZoomBucket(2.5), 3);
	assert.ok(textResolutionForZoom(2) >= textResolutionForZoom(1));
});

test("spatial index upsert updates a dirty entry without full rebuild", () => {
	const index = createSpatialIndex();
	index.rebuild([
		{ id: "a", order: 0, rect: { x: 0, y: 0, width: 10, height: 10 } },
		{ id: "b", order: 1, rect: { x: 100, y: 100, width: 10, height: 10 } },
	]);
	assert.deepEqual(index.idsAtPoint({ x: 5, y: 5 }), ["a"]);

	index.upsert(
		new Map([
			[
				"a",
				{ id: "a", order: 0, rect: { x: 50, y: 50, width: 10, height: 10 } },
			],
		]),
	);
	assert.deepEqual(index.idsAtPoint({ x: 5, y: 5 }), []);
	assert.deepEqual(index.idsAtPoint({ x: 55, y: 55 }), ["a"]);
});

test("resizeFrame keepAspect preserves ratio on corner drag", () => {
	const start = frame(0, 0, 100, 50);
	const next = resizeFrame(start, "se", worldPoint(200, 200), 24, true);
	assert.ok(Math.abs(next.width / next.height - 2) < 1e-6);
});
