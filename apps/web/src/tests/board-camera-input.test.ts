import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeWheelDelta, wheelZoomFactor } from "$lib/board/camera-input";

test("wheelZoomFactor responds quickly and symmetrically", () => {
	const zoomIn = wheelZoomFactor(-10);
	const zoomOut = wheelZoomFactor(10);
	assert.ok(zoomIn > 1.12);
	assert.ok(zoomOut < 0.9);
	assert.ok(Math.abs(zoomIn * zoomOut - 1) < 1e-12);
});

test("wheel input normalizes line and page deltas", () => {
	assert.equal(normalizeWheelDelta(2, 1), 32);
	assert.equal(normalizeWheelDelta(2, 2), 160);
	assert.equal(wheelZoomFactor(-1, 1), wheelZoomFactor(-16, 0));
});

test("wheel zoom ignores invalid input and limits large ticks", () => {
	assert.equal(wheelZoomFactor(Number.NaN), 1);
	assert.equal(wheelZoomFactor(Number.POSITIVE_INFINITY), 1);
	assert.equal(wheelZoomFactor(-10_000), 1.35);
	assert.equal(wheelZoomFactor(10_000), 1 / 1.35);
});
