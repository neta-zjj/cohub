import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addImageToTextCallsToSummary,
  createImageToTextUsageSummaryAccumulator,
  finalizeImageToTextUsageSummary,
  readImageToTextCalls,
  sumImageToTextUsage,
} from "./image-to-text.js";

test("reads valid image-to-text calls and sums only successful usage", () => {
  const meta = {
    imageToText: {
      schemaVersion: 1,
      calls: [
        {
          sourceKey: "u1:0",
          provider: "cohub",
          model: "vlm",
          status: "succeeded",
          usage: { input: 10, output: 4, totalTokens: 14, cost: { total: 0.2 } },
          durationMs: 12.8,
        },
        {
          sourceKey: "u1:1",
          provider: "cohub",
          model: "vlm",
          status: "failed",
          usage: { input: 3, totalTokens: 3, cost: { total: 0.1 } },
          durationMs: 8,
          error: "failed",
        },
      ],
    },
  };

  assert.equal(readImageToTextCalls(meta).length, 2);
  const calls = readImageToTextCalls(meta);
  assert.equal(calls.length, 2);
  assert.deepEqual(sumImageToTextUsage(meta), {
    input: 10,
    output: 4,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 14,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0.2,
    },
  });

  const accumulator = createImageToTextUsageSummaryAccumulator();
  addImageToTextCallsToSummary(accumulator, calls);
  const repeatedCall = calls[0];
  assert.ok(repeatedCall);
  addImageToTextCallsToSummary(accumulator, [{ ...repeatedCall, usage: { input: 2, output: 1, totalTokens: 3 } }]);
  assert.deepEqual(finalizeImageToTextUsageSummary(accumulator), {
    callCount: 3,
    successCount: 2,
    errorCount: 1,
    sourceCount: 2,
    usage: {
      input: 12,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 17,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0.2,
      },
    },
  });
});
