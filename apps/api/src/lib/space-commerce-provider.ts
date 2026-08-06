// @ts-nocheck
// Optional hosted-billing provider. Requires @talesofai-billing/sdk at runtime.
/**
 * Hosted space-commerce provider backed by @talesofai-billing/sdk.
 * Loaded only when billing env is configured.
 */

import { ApiError, createSdk } from "@talesofai-billing/sdk/base";
import { benefitsFeature, type CreditsBenefit } from "@talesofai-billing/sdk/admin/benefits";
import { businessesFeature } from "@talesofai-billing/sdk/admin/businesses";
import { customersFeature } from "@talesofai-billing/sdk/admin/customers";
import { ordersFeature } from "@talesofai-billing/sdk/admin/orders";
import { productsFeature } from "@talesofai-billing/sdk/admin/products";
import { createBusinessBillingOperations } from "@cohub/billing";
import type { BillingClientConfig } from "@cohub/billing";
import { config } from "../config.js";
import type { CreditsBenefit as LocalCreditsBenefit } from "./commerce-types.js";

export { ApiError };

function requireBillingClientConfig() {
  const baseURL = config.talesofaiBillingBaseUrl?.trim();
  const adminApiKey = config.talesofaiBillingAdminApiKey?.trim();
  if (!baseURL || !adminApiKey) {
    throw new Error("Billing is not configured");
  }
  return { baseURL, adminApiKey };
}

export function createSpaceCommerceSdk() {
  const client = requireBillingClientConfig();
  return createSdk(client)
    .useAdmin(businessesFeature())
    .useAdmin(productsFeature())
    .useAdmin(benefitsFeature())
    .useAdmin(customersFeature())
    .useAdmin(ordersFeature());
}

export type SpaceCommerceSdk = ReturnType<typeof createSpaceCommerceSdk>;

export function createSpaceBusinessBillingOperations(businessKey: string) {
  const client = requireBillingClientConfig();
  const clientConfig: BillingClientConfig = {
    baseUrl: client.baseURL,
    adminApiKey: client.adminApiKey,
    // business-scoped ops still need a platform business key field on the client
    // config type; use the space business key for both.
    businessKey,
  };
  return createBusinessBillingOperations({
    clientConfig,
    businessKey,
  });
}

export async function loadBusinessCreditBenefits(input: {
  sdk: SpaceCommerceSdk;
  businessKey: string;
}): Promise<Map<string, LocalCreditsBenefit>> {
  const creditBenefits = new Map<string, LocalCreditsBenefit>();
  let page = 1;
  while (true) {
    const result = await input.sdk.admin.benefits.list({
      business_key: input.businessKey,
      include_count: false,
      limit: 100,
      page,
    });
    for (const benefit of result.items as CreditsBenefit[]) {
      if (benefit.type === "credits") {
        creditBenefits.set(benefit.key, benefit as unknown as LocalCreditsBenefit);
      }
    }
    if (!result.pagination.has_more) break;
    page += 1;
  }
  return creditBenefits;
}

export async function loadBoundBenefitKeys(input: {
  sdk: SpaceCommerceSdk;
  businessKey: string;
  productKey: string;
}): Promise<string[]> {
  const bindings = await input.sdk.admin.products.listBenefits({
    business_key: input.businessKey,
    product_key: input.productKey,
  });
  return bindings.map((binding) => binding.benefit_key);
}

export async function createBillingBusiness(input: {
  businessKey: string;
  name: string;
}) {
  const sdk = createSpaceCommerceSdk();
  try {
    await sdk.admin.businesses.create({
      key: input.businessKey,
      name: input.name,
      status: "active",
    });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error;
  }
}
