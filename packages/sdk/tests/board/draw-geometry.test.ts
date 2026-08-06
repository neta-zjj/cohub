import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildStrokeOutline,
	computeDrawBounds,
	sampleRadius,
} from "../../src/board/core/draw-geometry.js";

const sharpReversal = [
	{ x: 0, y: 0, p: 0.2 },
	{ x: 80, y: 0, p: 0.8 },
	{ x: 5, y: 3, p: 0.3 },
	{ x: 80, y: 6, p: 1 },
	{ x: 5, y: 9, p: 0.5 },
];

test("freehand outlines stay finite and inside their pressure bounds", () => {
	const bounds = computeDrawBounds(sharpReversal, 8);
	const outline = buildStrokeOutline(sharpReversal, 8);
	assert.ok(outline.length > sharpReversal.length);
	for (const point of outline) {
		assert.ok(Number.isFinite(point.x));
		assert.ok(Number.isFinite(point.y));
		assert.ok(point.x >= bounds.x - 1e-6);
		assert.ok(point.x <= bounds.x + bounds.width + 1e-6);
		assert.ok(point.y >= bounds.y - 1e-6);
		assert.ok(point.y <= bounds.y + bounds.height + 1e-6);
	}
});

test("freehand outline derivation preserves raw samples", () => {
	const points = sharpReversal.map((point) => ({ ...point }));
	const before = structuredClone(points);
	buildStrokeOutline(points, 8);
	assert.deepEqual(points, before);
});

test("a single sample remains a compact round dot", () => {
	const point = { x: 12, y: 24, p: 0.5 };
	const radius = sampleRadius(8, point.p);
	const outline = buildStrokeOutline([point], 8);
	assert.equal(outline.length, 8);
	for (const sample of outline) {
		assert.ok(Math.abs(Math.hypot(sample.x - point.x, sample.y - point.y) - radius) < 1e-6);
	}
});
