import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { isBillingApiError } from "../lib/billing-api-error.js";
import { mapWithConcurrency } from "../lib/concurrency.js";
import { authzDenied, getOptionalAuth, requireValidId, useAuth } from "../lib/middleware.js";
import { handleWorkCommerceRouteError } from "../lib/commerce-http.js";
import { hasPermission } from "../permissions.js";
import {
  buildWorkCheckoutReturnUrls,
  createSpaceCommerceSdk,
  createSpaceBusinessBillingOperations,
  getWorkCommerceContextById,
  loadBoundBenefitKeys,
  loadBusinessCreditBenefits,
  requireSpaceCommerceBusinessKey,
} from "../lib/space-commerce.js";
import { serializeProduct, serializeOrder } from "../lib/commerce-serialize.js";
import { db } from "../db/index.js";
import { spaces, userProfiles } from "@cohub/db";
import { eq } from "drizzle-orm";
import { config } from "../config.js";
import {
  isCohubBalanceProductValid,
  readCohubBalanceDescriptor,
} from "../lib/space-commerce-balance.js";
import {
  createWorkPurchaseIdempotencyKey,
  normalizePurchaseAttemptId,
} from "../lib/work-commerce-purchase.js";

const router = new Hono();

/** Public resolve fan-out caps: bound upstream Billing load per request. */
const RESOLVE_MAX_PRODUCT_KEYS = 20;
const RESOLVE_MAX_PRODUCT_KEY_LENGTH = 128;
const RESOLVE_BILLING_CONCURRENCY = 4;

async function getPublishedWorkOrDeny(workId: string, userUuid?: string | null) {
  const work = await getWorkCommerceContextById(workId);
  if (work?.workStatus !== "published") return { error: "work not found" as const };
  if ((work.workVisibility ?? "public") === "space") {
    if (!userUuid) return { auth: "required" as const, work };
  }
  return { work };
}

async function resolvePublicWorkUrl(input: { spaceId: string; workSlug: string }) {
  const [row] = await db
    .select({ username: userProfiles.username, spaceSlug: spaces.slug })
    .from(spaces)
    .innerJoin(userProfiles, eq(userProfiles.userUuid, spaces.userUuid))
    .where(eq(spaces.id, input.spaceId))
    .limit(1);
  if (!row?.username || !row.spaceSlug) return null;
  const origin = config.webOrigin?.replace(/\/+$/, "") ?? "https://dev.cohub.run";
  return `${origin}/${encodeURIComponent(row.username)}/${encodeURIComponent(row.spaceSlug)}/w/${encodeURIComponent(input.workSlug)}`;
}

router.post("/works/:id/commerce/products/resolve", async (c) => {
  const principal = getOptionalAuth(c);
  const workId = c.req.param("id");
  if (!requireValidId(workId)) return c.json({ message: "work not found" }, 404);
  const resolved = await getPublishedWorkOrDeny(workId, principal?.uuid ?? null);
  if ("error" in resolved) return c.json({ message: resolved.error }, 404);
  if ("auth" in resolved) return authzDenied(c);
  if ((resolved.work.workVisibility ?? "public") === "space" && !(await hasPermission(principal, "space.view", { spaceId: resolved.work.spaceId }))) return authzDenied(c);
  const body = await c.req.json().catch(() => null) as { productKeys?: unknown } | null;
  const requested = Array.isArray(body?.productKeys)
    ? [...new Set(body.productKeys.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
    : [];
  if (requested.length === 0) return c.json({ message: "productKeys is required" }, 400);
  if (requested.length > RESOLVE_MAX_PRODUCT_KEYS) {
    return c.json({ message: `productKeys must contain at most ${RESOLVE_MAX_PRODUCT_KEYS} items` }, 400);
  }
  if (requested.some((key) => key.length > RESOLVE_MAX_PRODUCT_KEY_LENGTH)) {
    return c.json({ message: `productKeys entries must be at most ${RESOLVE_MAX_PRODUCT_KEY_LENGTH} characters` }, 400);
  }
  try {
    const businessKey = await requireSpaceCommerceBusinessKey(resolved.work.spaceId);
    const sdk = await createSpaceCommerceSdk();
    const [products, creditBenefitsMap] = await Promise.all([
      mapWithConcurrency(requested, RESOLVE_BILLING_CONCURRENCY, async (productKey) => {
        try {
          const product = await sdk.admin.products.get({ business_key: businessKey, product_key: productKey });
          if (product.status !== "active" || product.visibility !== "public" || product.billing_type !== "one_time") return null;
          return product;
        } catch (error) {
          if (isBillingApiError(error) && error.status === 404) return null;
          throw error;
        }
      }),
      loadBusinessCreditBenefits({ sdk, businessKey }),
    ]);
    const visibleProducts = products.filter(
      (item): item is NonNullable<typeof item> => Boolean(item),
    );
    const boundKeysByProduct = await mapWithConcurrency(
      visibleProducts,
      RESOLVE_BILLING_CONCURRENCY,
      (item) => loadBoundBenefitKeys({ sdk, businessKey, productKey: item.key }),
    );
    const serializedProducts = [];
    for (const [index, item] of visibleProducts.entries()) {
      const boundKeys = boundKeysByProduct[index] ?? [];
      const boundCredits = boundKeys
        .map((key) => creditBenefitsMap.get(key))
        .filter((b): b is NonNullable<typeof b> => Boolean(b));
      const balance = readCohubBalanceDescriptor(item);
      if (balance && !isCohubBalanceProductValid({
        productKey: item.key,
        productAmountMinor: Number(item.amount ?? item.unit_amount ?? 0),
        productCurrency: item.currency,
        balance,
        benefit: creditBenefitsMap.get(balance.benefitKey),
        boundBenefitKeys: boundKeys,
      })) {
        continue;
      }
      serializedProducts.push(serializeProduct(item, boundCredits, balance));
    }
    return c.json({
      products: serializedProducts,
    });
  } catch (error) {
    const response = handleWorkCommerceRouteError(c, error);
    if (response) return response;
    throw error;
  }
});

router.get("/works/:id/commerce/entitlements", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;
  const workId = c.req.param("id");
  if (!requireValidId(workId)) return c.json({ message: "work not found" }, 404);
  const resolved = await getPublishedWorkOrDeny(workId, user.uuid);
  if ("error" in resolved) return c.json({ message: resolved.error }, 404);
  if ((resolved.work.workVisibility ?? "public") === "space" && !(await hasPermission(user, "space.view", { spaceId: resolved.work.spaceId }))) return authzDenied(c);
  try {
    const businessKey = await requireSpaceCommerceBusinessKey(resolved.work.spaceId);
    const ops = await createSpaceBusinessBillingOperations(businessKey);
    const state = await ops.getEntitlements({ userId: user.uuid });
    const creditBalance = state.credits.find((c: { tokenType: string }) => c.tokenType === "cohub_credit");
    return c.json({
      entitlements: state.entitlements.map((entitlement: { key: string; enabled: boolean; metadata: Record<string, string | number | boolean> }) => ({
        benefitKey: entitlement.key,
        enabled: entitlement.enabled,
        metadata: entitlement.metadata,
      })),
      credits: {
        available: creditBalance?.availableBalance ?? 0,
        net: creditBalance?.netBalance ?? 0,
      },
      businessKey,
    });
  } catch (error) {
    const response = handleWorkCommerceRouteError(c, error);
    if (response) return response;
    throw error;
  }
});

router.post("/works/:id/commerce/credits/consume", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;
  const workId = c.req.param("id");
  if (!requireValidId(workId)) return c.json({ message: "work not found" }, 404);
  const resolved = await getPublishedWorkOrDeny(workId, user.uuid);
  if ("error" in resolved) return c.json({ message: resolved.error }, 404);
  if ((resolved.work.workVisibility ?? "public") === "space" && !(await hasPermission(user, "space.view", { spaceId: resolved.work.spaceId }))) return authzDenied(c);
  const body = await c.req.json().catch(() => null) as {
    amount?: unknown;
    operationId?: unknown;
    consumerUserId?: unknown;
    reason?: unknown;
  } | null;
  const rawAmount = typeof body?.amount === "number" ? body.amount : null;
  if (rawAmount === null || !Number.isSafeInteger(rawAmount) || rawAmount <= 0) {
    return c.json({ message: "amount must be a positive safe integer" }, 400);
  }
  const operationId = typeof body?.operationId === "string" ? body.operationId.trim() : "";
  if (!operationId || operationId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(operationId)) {
    return c.json({ message: "operationId must be 1-128 chars of [a-zA-Z0-9_-]" }, 400);
  }
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 512) : undefined;

  const consumerUserId = typeof body?.consumerUserId === "string" ? body.consumerUserId.trim() : null;
  const targetUserId = consumerUserId ?? user.uuid;
  if (consumerUserId && consumerUserId !== user.uuid) {
    if (!(await hasPermission(user, "space.commerce.manage", { spaceId: resolved.work.spaceId }))) return authzDenied(c);
  }
  try {
    const businessKey = await requireSpaceCommerceBusinessKey(resolved.work.spaceId);
    const ops = await createSpaceBusinessBillingOperations(businessKey);
    const result = await ops.consume({
      userId: targetUserId,
      amount: rawAmount,
      operationId,
      sourceId: resolved.work.workId,
      reason,
    });
    return c.json({
      status: result.status,
      amount: result.amount,
      remaining: result.remaining,
      shortfall: result.shortfall,
      businessKey,
    });
  } catch (error) {
    const response = handleWorkCommerceRouteError(c, error);
    if (response) return response;
    throw error;
  }
});

router.post("/works/:id/commerce/purchase", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;
  const workId = c.req.param("id");
  if (!requireValidId(workId)) return c.json({ message: "work not found" }, 404);
  const resolved = await getPublishedWorkOrDeny(workId, user.uuid);
  if ("error" in resolved) return c.json({ message: resolved.error }, 404);
  if ((resolved.work.workVisibility ?? "public") === "space" && !(await hasPermission(user, "space.view", { spaceId: resolved.work.spaceId }))) return authzDenied(c);
  const body = await c.req.json().catch(() => null) as {
    productKey?: unknown;
    purchaseAttemptId?: unknown;
  } | null;
  const productKey = typeof body?.productKey === "string" ? body.productKey.trim() : "";
  if (!productKey) return c.json({ message: "productKey is required" }, 400);
  const rawPurchaseAttemptId = body?.purchaseAttemptId ?? c.req.header("Idempotency-Key");
  const purchaseAttemptId = rawPurchaseAttemptId === undefined
    ? randomUUID()
    : normalizePurchaseAttemptId(rawPurchaseAttemptId);
  if (!purchaseAttemptId) {
    return c.json({
      message: "purchaseAttemptId must be 1-128 chars of [a-zA-Z0-9_-]",
    }, 400);
  }
  try {
    const businessKey = await requireSpaceCommerceBusinessKey(resolved.work.spaceId);
    const sdk = await createSpaceCommerceSdk();
    const product = await sdk.admin.products.get({ business_key: businessKey, product_key: productKey });
    if (product.status !== "active" || product.visibility !== "public" || product.billing_type !== "one_time") {
      return c.json({ message: "product is not available" }, 400);
    }
    const amountMinor = Number(product.amount ?? product.unit_amount ?? 0);
    const balance = readCohubBalanceDescriptor(product);
    if (balance) {
      let balanceBenefit = null;
      try {
        const benefit = await sdk.admin.benefits.get({
          business_key: businessKey,
          benefit_key: balance.benefitKey,
        });
        if (benefit.type === "credits") balanceBenefit = benefit;
      } catch (error) {
        if (!isBillingApiError(error) || error.status !== 404) throw error;
      }
      const boundBenefitKeys = await loadBoundBenefitKeys({
        sdk,
        businessKey,
        productKey: product.key,
      });
      if (!isCohubBalanceProductValid({
        productKey: product.key,
        productAmountMinor: amountMinor,
        productCurrency: product.currency,
        balance,
        benefit: balanceBenefit,
        boundBenefitKeys,
      })) {
        return c.json({ message: "Cohub Balance configuration is invalid" }, 409);
      }
    }
    const workUrl = await resolvePublicWorkUrl({
      spaceId: resolved.work.spaceId,
      workSlug: resolved.work.workSlug,
    });
    if (!workUrl) return c.json({ message: "work public url is unavailable" }, 409);
    const provisionalRedirects = buildWorkCheckoutReturnUrls({ workUrl });
    const result = await sdk.admin.orders.create(
      {
        business_key: businessKey,
        external_user_id: user.uuid,
        product_key: product.key,
        billing_reason: "purchase",
        success_redirect_url: provisionalRedirects.successRedirectUrl,
        failed_redirect_url: provisionalRedirects.failedRedirectUrl,
        cancel_redirect_url: provisionalRedirects.cancelRedirectUrl,
        metadata: {
          source: "cohub",
          source_type: "work",
          cohub_space_id: resolved.work.spaceId,
          cohub_work_id: resolved.work.workId,
          cohub_purchase_attempt_id: purchaseAttemptId,
          cohub_purchase_idempotency_version: "work-purchase-v1",
          ...(balance ? {
            cohub_balance_amount_minor: balance.amountMinor,
            cohub_balance_benefit_key: balance.benefitKey,
            cohub_balance_policy_version: balance.policyVersion,
            cohub_balance_owner_gross_amount_minor: amountMinor - balance.amountMinor,
          } : {}),
        },
      },
      {
        idempotencyKey: createWorkPurchaseIdempotencyKey({
          workId: resolved.work.workId,
          buyerUserUuid: user.uuid,
          productKey: product.key,
          purchaseAttemptId,
        }),
      },
    );
    return c.json({ checkout: {
      providerKey: result.checkout?.provider_key ?? null,
      checkoutUrl: result.checkout?.checkout_url ?? null,
      checkoutUsable: result.checkout?.checkout_usable === true,
      status: result.checkout?.status ?? null,
      message: result.checkout?.message ?? null,
      orderId: result.order.id,
      productKey: result.order.product_key_snapshot,
    } });
  } catch (error) {
    const response = handleWorkCommerceRouteError(c, error);
    if (response) return response;
    throw error;
  }
});

router.get("/works/:id/commerce/orders/:orderId", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;
  const workId = c.req.param("id");
  const orderId = c.req.param("orderId");
  if (!requireValidId(workId)) return c.json({ message: "work not found" }, 404);
  if (!requireValidId(orderId)) return c.json({ message: "order not found" }, 404);
  const resolved = await getPublishedWorkOrDeny(workId, user.uuid);
  if ("error" in resolved) return c.json({ message: resolved.error }, 404);
  if ((resolved.work.workVisibility ?? "public") === "space" && !(await hasPermission(user, "space.view", { spaceId: resolved.work.spaceId }))) return authzDenied(c);
  try {
    const businessKey = await requireSpaceCommerceBusinessKey(resolved.work.spaceId);
    const sdk = await createSpaceCommerceSdk();
    const order = await sdk.admin.orders.get({
      business_key: businessKey,
      order_id: orderId,
    });
    if (order.external_user_id !== user.uuid) return authzDenied(c);
    return c.json({ order: serializeOrder(order) });
  } catch (error) {
    const response = handleWorkCommerceRouteError(c, error);
    if (response) return response;
    throw error;
  }
});

export default router;
