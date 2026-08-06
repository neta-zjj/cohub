import { createHash } from "node:crypto";

const PURCHASE_ATTEMPT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export function normalizePurchaseAttemptId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return PURCHASE_ATTEMPT_ID_PATTERN.test(normalized) ? normalized : null;
}

export type WorkPurchaseAttemptIdentity = {
  workId: string;
  buyerUserUuid: string;
  productKey: string;
  purchaseAttemptId: string;
};

export function createWorkPurchaseIdempotencyKey(input: WorkPurchaseAttemptIdentity): string {
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        input.workId,
        input.buyerUserUuid,
        input.productKey,
        input.purchaseAttemptId,
      ]),
    )
    .digest("hex");
  return `cohub-work-purchase-v1-${fingerprint}`;
}
