import assert from "node:assert/strict";
import test from "node:test";
import { parseRetryAfterMs } from "./api.js";

test("parseRetryAfterMs handles absent, delta, and HTTP-date values", () => {
  const now = Date.parse("2026-08-03T07:00:00.000Z");
  assert.equal(parseRetryAfterMs(null, now), undefined);
  assert.equal(parseRetryAfterMs("", now), undefined);
  assert.equal(parseRetryAfterMs("1.5", now), 1_500);
  assert.equal(parseRetryAfterMs("Mon, 03 Aug 2026 07:00:05 GMT", now), 5_000);
  assert.equal(parseRetryAfterMs("invalid", now), undefined);
});
