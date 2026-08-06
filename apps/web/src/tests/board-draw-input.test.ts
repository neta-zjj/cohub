import assert from "node:assert/strict";
import { test } from "node:test";
import { appendBoardDrawSample } from "../lib/board/board-draw-input.ts";

const initial = [{ x: 10, y: 20, p: 0.5 }];

test("a stroke ignores samples from another pointer", () => {
	const points = appendBoardDrawSample(
		initial,
		1,
		{ pointerId: 2, world: { x: 200, y: 300 }, pressure: 1 },
		1,
	);
	assert.strictEqual(points, initial);
});

test("a stroke keeps owned samples that add visible detail", () => {
	const points = appendBoardDrawSample(
		initial,
		1,
		{ pointerId: 1, world: { x: 12, y: 24 }, pressure: 0.8 },
		1,
	);
	assert.deepEqual(points, [...initial, { x: 12, y: 24, p: 0.8 }]);
});

test("near-duplicate samples preserve the existing points array", () => {
	const points = appendBoardDrawSample(
		initial,
		1,
		{ pointerId: 1, world: { x: 10.2, y: 20.2 }, pressure: 0.8 },
		1,
	);
	assert.strictEqual(points, initial);
});
