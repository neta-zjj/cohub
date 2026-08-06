import assert from "node:assert/strict";
import test from "node:test";
import { QQApiError } from "./api.js";
import { resolveQQReconnectDelay } from "./transport.js";

test("Retry-After never bypasses the base reconnect delay", () => {
  assert.equal(resolveQQReconnectDelay(new QQApiError("limited", 429, "/gateway", undefined, undefined, 0), 0), 1_000);
  assert.equal(resolveQQReconnectDelay(new QQApiError("limited", 429, "/gateway", undefined, undefined, 250), 0), 1_000);
  assert.equal(resolveQQReconnectDelay(new QQApiError("limited", 429, "/gateway", undefined, undefined, 2_500), 0), 2_500);
});

test("reconnect delay retains config and jitter behavior", () => {
  assert.equal(resolveQQReconnectDelay(new QQApiError("unauthorized", 401, "/gateway"), 0), 5 * 60_000);
  assert.equal(resolveQQReconnectDelay(new Error("network"), 2, () => 0.5), 2_000);
});
