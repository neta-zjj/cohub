import { and, eq } from "drizzle-orm";
import { spaceCommerceBusinesses, spaces, works } from "@cohub/db";
import { db } from "../db/index.js";
import {
  billingOperations,
  COHUB_BILLING_FEATURES,
} from "@cohub/billing";
import { createLogger } from "@cohub/infra/logging";
import type { CreditsBenefit } from "./commerce-types.js";
import { isBillingApiError } from "./billing-api-error.js";
import type { SpaceCommerceSdk } from "./space-commerce-provider.js";

const BILLING_NAMESPACE = "cohub_space";

const logger = createLogger({ serviceName: "cohub-api" });

/**
 * Resolves the space commerce entitlement. Returns `true` when entitled,
 * `false` when explicitly not entitled, or `null` when the billing service
 * could not be reached — letting callers distinguish a missing subscription
 * (402) from a transient verification failure (503) instead of masking a
 * billing outage as an upgrade prompt.
 */
export async function resolveSpaceCommerceEntitlement(
  userId: string,
): Promise<boolean | null> {
  try {
    const entitlement = await billingOperations.getFeatureEntitlement({
      userId,
      featureKey: COHUB_BILLING_FEATURES.spaceCommerce,
    });
    return Boolean(entitlement?.enabled);
  } catch (error) {
    logger.warn("[space-commerce] failed to check commerce entitlement", {
      userId,
      error,
    });
    return null;
  }
}

export class SpaceCommerceNotInitializedError extends Error {
  override name = "SpaceCommerceNotInitializedError";

  constructor(readonly spaceId: string) {
    super("Space commerce is not initialized");
  }
}

type SpaceCommerceProvider = typeof import("./space-commerce-provider.js");

let providerPromise: Promise<SpaceCommerceProvider> | null = null;

function loadProvider(): Promise<SpaceCommerceProvider> {
  providerPromise ??= import("./space-commerce-provider.js").catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Space commerce provider is unavailable. Install @talesofai-billing/sdk for hosted commerce. (${detail})`,
    );
  });
  return providerPromise;
}

export type { SpaceCommerceSdk };

export async function createSpaceCommerceSdk(): Promise<SpaceCommerceSdk> {
  return (await loadProvider()).createSpaceCommerceSdk();
}

export async function createSpaceBusinessBillingOperations(businessKey: string) {
  return (await loadProvider()).createSpaceBusinessBillingOperations(businessKey);
}

export async function loadBusinessCreditBenefits(input: {
  sdk: SpaceCommerceSdk;
  businessKey: string;
}): Promise<Map<string, CreditsBenefit>> {
  return (await loadProvider()).loadBusinessCreditBenefits(input);
}

export async function loadBoundBenefitKeys(input: {
  sdk: SpaceCommerceSdk;
  businessKey: string;
  productKey: string;
}): Promise<string[]> {
  return (await loadProvider()).loadBoundBenefitKeys(input);
}

function normalizeBusinessKeyValue(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
}

function buildBillingBusinessKey(spaceId: string) {
  return `${BILLING_NAMESPACE}_${normalizeBusinessKeyValue(spaceId)}`;
}

function appendCheckoutQuery(urlString: string, input: { status: "success" | "failed" | "cancel"; orderId?: string | null }) {
  const url = new URL(urlString);
  url.searchParams.set("cohub_checkout", input.status);
  if (input.orderId) url.searchParams.set("cohub_order", input.orderId);
  return url.toString();
}

function buildBillingBusinessName(input: { spaceName: string; spaceId: string }) {
  const name = input.spaceName.trim() || input.spaceId;
  const suffix = input.spaceId.slice(0, 8);
  return `Cohub Space · ${name} · ${suffix}`.slice(0, 256);
}

export async function getSpaceCommerceBusiness(spaceId: string) {
  const [mapping] = await db
    .select()
    .from(spaceCommerceBusinesses)
    .where(eq(spaceCommerceBusinesses.spaceId, spaceId))
    .limit(1);
  return mapping ?? null;
}

export async function ensureSpaceCommerceBusiness(spaceId: string) {
  const existing = await getSpaceCommerceBusiness(spaceId);
  if (existing) return existing;

  const [space] = await db
    .select({ id: spaces.id, name: spaces.name })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);
  if (!space) throw new Error("Space not found");

  const businessKey = buildBillingBusinessKey(space.id);
  const provider = await loadProvider();
  try {
    await provider.createBillingBusiness({
      businessKey,
      name: buildBillingBusinessName({ spaceName: space.name, spaceId: space.id }),
    });
  } catch (error) {
    // Provider rethrows non-409; 409 is treated as already exists.
    if (!isBillingApiError(error) || error.status !== 409) throw error;
  }

  const [mapping] = await db
    .insert(spaceCommerceBusinesses)
    .values({
      spaceId: space.id,
      billingBusinessKey: businessKey,
    })
    .onConflictDoUpdate({
      target: spaceCommerceBusinesses.spaceId,
      set: {
        billingBusinessKey: businessKey,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!mapping) throw new Error("Failed to persist space commerce business mapping");
  return mapping;
}

export async function requireSpaceCommerceBusiness(spaceId: string) {
  const mapping = await getSpaceCommerceBusiness(spaceId);
  if (!mapping) throw new SpaceCommerceNotInitializedError(spaceId);
  return mapping;
}

export async function getSpaceCommerceBusinessKey(spaceId: string) {
  return (await getSpaceCommerceBusiness(spaceId))?.billingBusinessKey ?? null;
}

export async function requireSpaceCommerceBusinessKey(spaceId: string) {
  return (await requireSpaceCommerceBusiness(spaceId)).billingBusinessKey;
}

export async function ensureSpaceCommerceBusinessKey(spaceId: string) {
  return (await ensureSpaceCommerceBusiness(spaceId)).billingBusinessKey;
}

export async function getWorkCommerceContextById(workId: string) {
  const [row] = await db
    .select({
      workId: works.id,
      workSlug: works.slug,
      workStatus: works.status,
      workVisibility: works.visibility,
      spaceId: works.spaceId,
    })
    .from(works)
    .where(eq(works.id, workId))
    .limit(1);
  if (!row) return null;
  return row;
}

export async function getWorkCommerceContextBySpaceAndSlug(input: {
  spaceId: string;
  workSlug: string;
}) {
  const [row] = await db
    .select({
      workId: works.id,
      workSlug: works.slug,
      workStatus: works.status,
      workVisibility: works.visibility,
      spaceId: works.spaceId,
    })
    .from(works)
    .where(and(eq(works.spaceId, input.spaceId), eq(works.slug, input.workSlug)))
    .limit(1);
  return row ?? null;
}

export function buildWorkCheckoutReturnUrls(input: { workUrl: string; orderId?: string | null }) {
  return {
    successRedirectUrl: appendCheckoutQuery(input.workUrl, { status: "success", orderId: input.orderId }),
    failedRedirectUrl: appendCheckoutQuery(input.workUrl, { status: "failed", orderId: input.orderId }),
    cancelRedirectUrl: appendCheckoutQuery(input.workUrl, { status: "cancel", orderId: input.orderId }),
  };
}
