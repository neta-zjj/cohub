import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createWorkPurchaseIdempotencyKey,
  normalizePurchaseAttemptId,
} from "./work-commerce-purchase.js";

test("normalizes valid Work purchase attempt ids", () => {
  assert.equal(normalizePurchaseAttemptId(" attempt_123 "), "attempt_123");
  assert.equal(normalizePurchaseAttemptId("a".repeat(128)), "a".repeat(128));
});

test("rejects invalid Work purchase attempt ids", () => {
  assert.equal(normalizePurchaseAttemptId(undefined), null);
  assert.equal(normalizePurchaseAttemptId(""), null);
  assert.equal(normalizePurchaseAttemptId("attempt.with.dot"), null);
  assert.equal(normalizePurchaseAttemptId("a".repeat(129)), null);
});

test("builds stable, context-scoped Work purchase idempotency keys", () => {
  const input = {
    workId: "work-1",
    buyerUserUuid: "buyer-1",
    productKey: "balance-pack",
    purchaseAttemptId: "attempt-1",
  };
  const key = createWorkPurchaseIdempotencyKey(input);

  assert.equal(key, createWorkPurchaseIdempotencyKey(input));
  assert.match(key, /^cohub-work-purchase-v1-[a-f0-9]{64}$/);
  assert.notEqual(
    key,
    createWorkPurchaseIdempotencyKey({ ...input, buyerUserUuid: "buyer-2" }),
  );
  assert.notEqual(
    key,
    createWorkPurchaseIdempotencyKey({ ...input, productKey: "other-pack" }),
  );
});
