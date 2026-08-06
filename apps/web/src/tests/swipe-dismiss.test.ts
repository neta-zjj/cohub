import assert from "node:assert/strict";
import { test } from "node:test";
import {
	resolveSwipeAxis,
	SWIPE_DISMISS_MIN_DISTANCE_PX,
	shouldDismissOnSwipe,
	swipeDismissOpacity,
} from "../lib/gestures/swipe-dismiss.ts";

test("axis stays unresolved until the finger clears the lock distance", () => {
	assert.equal(resolveSwipeAxis(3, 2), null);
	assert.equal(resolveSwipeAxis(40, 4), "horizontal");
	assert.equal(resolveSwipeAxis(4, 40), "vertical");
	// Diagonal drags stay ambiguous so neither axis steals the gesture.
	assert.equal(resolveSwipeAxis(20, 19), null);
});

test("a long drag dismisses, a short slow drag settles back", () => {
	const width = 360;
	assert.equal(
		shouldDismissOnSwipe({ deltaX: 200, velocityX: 0.05, width }),
		true,
	);
	assert.equal(
		shouldDismissOnSwipe({ deltaX: -200, velocityX: -0.05, width }),
		true,
	);
	assert.equal(
		shouldDismissOnSwipe({ deltaX: 30, velocityX: 0.05, width }),
		false,
	);
});

test("a flick dismisses only when it agrees with the drag direction", () => {
	const width = 360;
	assert.equal(
		shouldDismissOnSwipe({ deltaX: 40, velocityX: 0.9, width }),
		true,
	);
	// Finger reversed at the end: treat it as a cancel, not a dismiss.
	assert.equal(
		shouldDismissOnSwipe({ deltaX: 40, velocityX: -0.9, width }),
		false,
	);
});

test("narrow cards still need a usable minimum travel", () => {
	const width = 80;
	assert.equal(
		shouldDismissOnSwipe({
			deltaX: SWIPE_DISMISS_MIN_DISTANCE_PX - 1,
			velocityX: 0,
			width,
		}),
		false,
	);
	assert.equal(
		shouldDismissOnSwipe({
			deltaX: SWIPE_DISMISS_MIN_DISTANCE_PX,
			velocityX: 0,
			width,
		}),
		true,
	);
});

test("opacity fades with travel and never fully disappears mid-drag", () => {
	assert.equal(swipeDismissOpacity(0, 300), 1);
	assert.ok(swipeDismissOpacity(150, 300) < 1);
	assert.ok(swipeDismissOpacity(300, 300) >= 0.15);
	assert.equal(swipeDismissOpacity(10, 0), 1);
});
