import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { config } from "../config.js";
import {
  createPreviewSessionToken,
  hasPreviewSessionPermission,
  PREVIEW_SESSION_TTL_SECONDS,
  verifyPreviewSessionToken,
} from "../preview-sessions.js";
import { createPreviewRouter } from "./preview-router.js";

function createTestApp() {
  const app = new Hono();
  app.route("/", createPreviewRouter({
    getPreviewSessionPrincipal: () => null,
    hasPreviewSessionPermission,
    previewHostname: () => process.env.PREVIEW_HOSTNAME ?? "",
    previewSessionTtlSeconds: PREVIEW_SESSION_TTL_SECONDS,
    requireValidId: (value) => Boolean(value),
    resolveSpaceFileDownload: async () => {
      throw new Error("unexpected file access");
    },
    spaceFsJsonError: () => ({
      status: 500,
      body: { code: "FILE_ERROR", message: "file error" },
    }),
    streamSpaceFile: async () => {
      throw new Error("unexpected file access");
    },
    verifyPreviewSessionToken,
  }));
  app.get("/internal/ping", (c) => c.json({ ok: true }));
  app.notFound((c) => c.json({ message: "not found" }, 404));
  return app;
}

test("preview router does not intercept later routes", async () => {
  const app = createTestApp();
  const response = await app.request("/internal/ping", {
    headers: { host: "api-dev.cohub.run" },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("preview routes remain preview-host only", async () => {
  const app = createTestApp();
  const response = await app.request("/__session", {
    headers: { host: "api-dev.cohub.run" },
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { message: "not found" });
});

test("direct preview query tokens stay bound to their space", async () => {
  const previousHostname = process.env.PREVIEW_HOSTNAME;
  const previousKey = config.appEncryptionKey;
  process.env.PREVIEW_HOSTNAME = "preview.test";
  config.appEncryptionKey = "preview-route-test-key";
  try {
    const app = createTestApp();
    const token = createPreviewSessionToken({
      userUuid: "10000000-0000-4000-8000-000000000001",
      spaceId: "20000000-0000-4000-8000-000000000002",
    });
    const response = await app.request(
      `/s/30000000-0000-4000-8000-000000000003/index.html?token=${encodeURIComponent(token)}`,
      { headers: { host: "preview.test" } },
    );

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { message: "forbidden" });
  } finally {
    process.env.PREVIEW_HOSTNAME = previousHostname;
    config.appEncryptionKey = previousKey;
  }
});

test("legacy preview session ingress still redirects to a clean file URL", async () => {
  const previousHostname = process.env.PREVIEW_HOSTNAME;
  const previousKey = config.appEncryptionKey;
  process.env.PREVIEW_HOSTNAME = "preview.test";
  config.appEncryptionKey = "preview-route-test-key";
  try {
    const app = createTestApp();
    const spaceId = "20000000-0000-4000-8000-000000000002";
    const token = createPreviewSessionToken({
      userUuid: "10000000-0000-4000-8000-000000000001",
      spaceId,
    });
    const response = await app.request(
      `/__session?token=${encodeURIComponent(token)}&next=${encodeURIComponent(`/s/${spaceId}/index.html`)}`,
      { headers: { host: "preview.test" }, redirect: "manual" },
    );

    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), `/s/${spaceId}/index.html`);
    assert.match(response.headers.get("set-cookie") ?? "", /__preview_session=/);
  } finally {
    process.env.PREVIEW_HOSTNAME = previousHostname;
    config.appEncryptionKey = previousKey;
  }
});
