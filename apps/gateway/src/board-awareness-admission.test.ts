import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BOARD_AWARENESS_MAX_EVENTS_PER_SECOND,
  BOARD_AWARENESS_MAX_PENDING,
  consumeBoardAwarenessRate,
  hasBoardAwarenessCapacity,
} from "./board-awareness-admission.js";

test("Board awareness admission enforces and resets its rate window", () => {
  const rate = { startedAt: 1_000, count: 0 };
  for (let index = 0; index < BOARD_AWARENESS_MAX_EVENTS_PER_SECOND; index += 1) {
    assert.equal(consumeBoardAwarenessRate(rate, 1_500), true);
  }
  assert.equal(consumeBoardAwarenessRate(rate, 1_500), false);
  assert.equal(consumeBoardAwarenessRate(rate, 2_000), true);
  assert.deepEqual(rate, { startedAt: 2_000, count: 1 });
});

test("Board awareness admission caps queued publishes", () => {
  assert.equal(hasBoardAwarenessCapacity(BOARD_AWARENESS_MAX_PENDING - 1), true);
  assert.equal(hasBoardAwarenessCapacity(BOARD_AWARENESS_MAX_PENDING), false);
});
