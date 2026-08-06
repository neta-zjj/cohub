import assert from "node:assert/strict";
import { test } from "node:test";
import {
	isSessionScrollAnchorInTurns,
	resolveSessionScrollRestore,
} from "../lib/features/session-chat/session-scroll-controller.svelte.ts";

const turns = [{ sequence: 1 }, { sequence: 2 }, { sequence: 5 }];

test("matches process-card sequence (turn.sequence)", () => {
	assert.equal(isSessionScrollAnchorInTurns(1, turns), true);
	assert.equal(isSessionScrollAnchorInTurns(5, turns), true);
	assert.equal(isSessionScrollAnchorInTurns(3, turns), false);
});

test("matches user message sequence (turn.sequence * 10)", () => {
	assert.equal(isSessionScrollAnchorInTurns(10, turns), true);
	assert.equal(isSessionScrollAnchorInTurns(20, turns), true);
	assert.equal(isSessionScrollAnchorInTurns(50, turns), true);
	assert.equal(isSessionScrollAnchorInTurns(30, turns), false);
});

test("matches assistant message sequence (turn.sequence * 10 + 2)", () => {
	// Regression: first-visible assistant bubble must keep the leave anchor.
	assert.equal(isSessionScrollAnchorInTurns(12, turns), true);
	assert.equal(isSessionScrollAnchorInTurns(22, turns), true);
	assert.equal(isSessionScrollAnchorInTurns(52, turns), true);
	assert.equal(isSessionScrollAnchorInTurns(32, turns), false);
});

test("rejects non-finite sequences", () => {
	assert.equal(isSessionScrollAnchorInTurns(Number.NaN, turns), false);
	assert.equal(
		isSessionScrollAnchorInTurns(Number.POSITIVE_INFINITY, turns),
		false,
	);
});

test("keeps restore pending while the anchor target is not scrollable yet", () => {
	assert.deepEqual(
		resolveSessionScrollRestore({
			anchorTop: 640,
			anchorOffset: -40,
			scrollHeight: 500,
			clientHeight: 500,
		}),
		{ scrollTop: 0, reached: false },
	);
});

test("reaches the same anchor after timeline layout expands", () => {
	assert.deepEqual(
		resolveSessionScrollRestore({
			anchorTop: 640,
			anchorOffset: -40,
			scrollHeight: 1800,
			clientHeight: 500,
		}),
		{ scrollTop: 600, reached: true },
	);
});
