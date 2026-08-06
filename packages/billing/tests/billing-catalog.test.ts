import assert from "node:assert/strict";
import { test } from "node:test";
import { createTalesofaiBillingOperations } from "../src/client.js";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const product = (input: {
  id: string;
  key: string;
  appName?: string;
}) => ({
  id: input.id,
  business_id: "business_1",
  key: input.key,
  name: input.key,
  description: null,
  status: "active",
  visibility: "public",
  billing_type: "recurring",
  amount: 1_000,
  currency: "USD",
  billing_period: "month",
  billing_interval_count: 1,
  meta: input.appName === undefined ? {} : { appName: input.appName },
  created_at: "2026-07-20T00:00:00.000Z",
  updated_at: "2026-07-20T00:00:00.000Z",
});

test("billing catalog only includes products for Cohub", async () => {
  const originalFetch = globalThis.fetch;
  const products = [
    product({ id: "product_cohub", key: "cohub_pro", appName: "cohub" }),
    product({ id: "product_other", key: "other_pro", appName: "other" }),
    product({ id: "product_legacy", key: "legacy_pro" }),
  ];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/products") {
      return jsonResponse({
        items: products,
        pagination: { has_more: false },
      });
    }
    if (url.pathname === "/v1/benefits") {
      return jsonResponse({
        items: [],
        pagination: { has_more: false },
      });
    }
    if (url.pathname === "/v1/business-default-plan") {
      return jsonResponse({
        default_plan: {
          status: "enabled",
          product_id: "product_other",
        },
      });
    }
    if (url.pathname === "/v1/providers/status") {
      return jsonResponse({
        status: "available",
        checkout_available: true,
        active_provider_key: "stripe",
        providers: [],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const operations = createTalesofaiBillingOperations({
      baseUrl: "https://billing.example.test/v1",
      businessKey: "cohub",
      adminApiKey: "test-key",
    });
    const catalog = await operations.getCatalog();

    assert.deepEqual(
      catalog.products.map(({ key }) => key),
      ["cohub_pro"],
    );
    assert.deepEqual(
      catalog.plans.map(({ key }) => key),
      ["cohub_pro"],
    );
    assert.deepEqual(catalog.addons, []);
    assert.equal(catalog.defaultPlanProductKey, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
