import assert from "node:assert/strict";
import test from "node:test";
import { mapWithConcurrency } from "./concurrency.js";

test("preserves input order regardless of completion order", async () => {
  const results = await mapWithConcurrency([30, 10, 20, 0], 2, async (delay) => {
    await new Promise((resolve) => setTimeout(resolve, delay));
    return delay;
  });
  assert.deepEqual(results, [30, 10, 20, 0]);
});

test("never exceeds the concurrency limit", async () => {
  let active = 0;
  let peak = 0;
  await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
    return value;
  });
  assert.equal(peak, 4);
});

test("handles empty input and limits larger than the input", async () => {
  assert.deepEqual(await mapWithConcurrency([], 4, async () => 1), []);
  assert.deepEqual(await mapWithConcurrency([1, 2], 99, async (v) => v * 2), [2, 4]);
});

test("propagates worker rejections", async () => {
  await assert.rejects(
    mapWithConcurrency([1, 2, 3], 2, async (value) => {
      if (value === 2) throw new Error("boom");
      return value;
    }),
    /boom/,
  );
});
