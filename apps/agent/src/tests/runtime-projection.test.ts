import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contextToPiMessages, type RuntimeContext } from "@cohub/protocol";
import sharp from "sharp";
import { contentBlockToPiImage, getRemoteImageUrl } from "@cohub/model-runtime/image-content";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { ContentBlock } from "@cohub/protocol/core";
import { SessionManager } from "../runtime/local-session-manager.js";
import { syncCloudContext } from "../runtime/cloud-context.js";
import { hydrateContextImages } from "../runtime/context-images.js";

const png = (width = 20) => sharp({ create: { width, height: 20, channels: 3, background: "red" } }).png().toBuffer();

const history: RuntimeContext = { revision: "r", throughTurnId: "t", messages: [
  { id: "u", turnId: "t", role: "user", content: [{ type: "text", text: "request" }] },
  { id: "a", turnId: "t", role: "assistant", provider: "p", model: "m", stopReason: "error", errorMessage: "failed", usage: { input: 7, output: 3 }, meta: { nativeApi: "anthropic-messages", createdAt: "2026-09-16T00:00:00Z" }, content: [
    { type: "thinking", thinking: "reasoning", signature: "opaque" },
    { type: "tool_use", id: "tc", name: "read", input: { path: "a" } },
    { type: "tool_result", tool_use_id: "tc", content: "result", is_error: true },
  ] },
] };

test("Cloud DB projection survives file reload with native reasoning, tools and error state", async () => {
  const root = await mkdtemp(join(tmpdir(), "cloud-projection-"));
  try {
    const path = join(root, "session.jsonl");
    const manager = SessionManager.create(root, root); manager.newSession({ id: "s" }); manager.setSessionFile(path);
    assert(syncCloudContext(manager, history));
    await manager.close();
    const reopened = await SessionManager.open(path, root);
    const expected = contextToPiMessages(history.messages);
    assert.deepEqual(reopened.buildSessionContext().messages, expected);
    assert.equal(syncCloudContext(reopened, { ...history, revision: "new" }), false);
    assert.deepEqual(reopened.buildSessionContext().messages, expected);
    const assistant = expected[1];
    assert(assistant);
    assert.equal(assistant.api, "anthropic-messages"); assert.equal(assistant.errorMessage, "failed");
    assert.equal((assistant.usage as { input: number }).input, 7);
    await reopened.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("generation placeholders never advance the Cloud resume marker", () => {
  const manager = SessionManager.create("/tmp", "/tmp"); manager.newSession({ id: "test" });
  const context: RuntimeContext = { ...history, messages: [{ id: "g", turnId: "t", role: "assistant", content: [{ type: "text", text: "queued" }], meta: { generationTaskId: "g", messageKind: "generation_result", generationStatus: "queued" } }] };
  assert.throws(() => syncCloudContext(manager, context), /not settled/);
  assert.equal(manager.getCustomEntries("cohub.context").length, 0);
  assert.equal(manager.buildSessionContext().messages.length, 0);
});

test("historical images download across messages with bounded concurrency and deduplicated URLs", { timeout: 5000 }, async () => {
  const image = (index: number): ContentBlock => ({ type: "image", source: { type: "url", url: `https://trusted.test/${index}.png` } });
  const context: RuntimeContext = { ...history, messages: [
    { id: "a", turnId: "t", role: "user", content: [image(0), image(1), { type: "tool_result", tool_use_id: "tool", content: [image(0), image(2)] }] },
    { id: "b", turnId: "t", role: "user", content: [image(3), image(4), image(5), image(1)] },
  ] };
  const original = structuredClone(context);
  const data = await png();
  const releases = new Map<string, () => void>();
  const calls: string[] = [];
  const starts = new Map<string, () => void>();
  const fourthStarted = new Promise<void>((resolve) => starts.set("https://trusted.test/4.png", resolve));
  const fifthStarted = new Promise<void>((resolve) => starts.set("https://trusted.test/5.png", resolve));
  let active = 0, maximum = 0;
  const result = hydrateContextImages(context, async (url) => {
    calls.push(url); active++; maximum = Math.max(maximum, active);
    starts.get(url)?.();
    await new Promise<void>((resolve) => releases.set(url, resolve));
    active--;
    return { data, mimeType: "image/png" };
  });
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
  await tick(); assert.equal(active, 4);
  releases.get("https://trusted.test/1.png")?.();
  await fourthStarted; assert(calls.includes("https://trusted.test/4.png"), "later images start even while the first one is pending");
  releases.get("https://trusted.test/4.png")?.();
  await fifthStarted; assert(calls.includes("https://trusted.test/5.png"));
  for (const release of releases.values()) release();
  const hydrated = await result;
  assert.equal(maximum, 4); assert.equal(calls.length, 6); assert.equal(new Set(calls).size, 6);
  assert.deepEqual(context, original);
  const urls = (content: ContentBlock[]): string[] => content.flatMap((block) =>
    block.type === "image" && block.source.type === "url" ? [block.source.url]
      : block.type === "tool_result" && Array.isArray(block.content) ? urls(block.content) : []);
  assert.deepEqual(hydrated.messages.flatMap((message) => urls(message.content)), [0, 1, 0, 2, 3, 4, 5, 1].map((index) => `https://trusted.test/${index}.png`));
});

test("historical images hydrate through the trusted reader without mutating DB history", async () => {
  const context: RuntimeContext = { ...history, messages: [{ id: "image", turnId: "t", role: "user", content: [{ type: "image", source: { type: "url", url: "https://trusted.test/a.png" } }] }] };
  const original = structuredClone(context);
  const data = await png();
  const projected = await hydrateContextImages(context, async () => ({ data, mimeType: "image/png" }));
  assert.equal(projected.messages[0]?.content[0]?.type === "image" && projected.messages[0].content[0].source.type, "url");
  assert.equal(context.messages[0]?.content[0]?.type === "image" && context.messages[0].content[0].source.type, "url");
  for (const read of [async () => null, async () => { throw new Error("CDN timeout"); }]) {
    let attempts = 0;
    const repeated = { ...context, messages: [...context.messages, ...context.messages] };
    const fallback = await hydrateContextImages(repeated, async () => { attempts++; return read(); });
    assert.equal(attempts, 1, "unavailable URLs are not repeatedly downloaded within a rebuild");
    assert.equal(fallback.messages[0]?.content[0]?.type, "text");
    const projected = contextToPiMessages(fallback.messages, { projectImage: contentBlockToPiImage });
    assert.ok(!JSON.stringify(projected).includes("application/x-cohub-image-url"));
    assert.ok(JSON.stringify(projected).includes("Image omitted"));
    assert.deepEqual(context, original, "DB history remains unchanged");
  }
});


test("recovered user and tool images stay URLs through JSONL reload and subsequent rounds", async () => {
  const root = await mkdtemp(join(tmpdir(), "cloud-url-images-"));
  const url = "https://trusted.test/a.png";
  const image: ContentBlock = { type: "image", source: { type: "url", url } };
  const context: RuntimeContext = { ...history, messages: [
    { id: "u-image", turnId: "t", role: "user", content: [image] },
    { id: "a-image", turnId: "t", role: "assistant", content: [
      { type: "tool_use", id: "tc", name: "read", input: {} },
      { type: "tool_result", tool_use_id: "tc", content: [image] },
    ] },
  ] };
  try {
    const data = await png();
    const hydrated = await hydrateContextImages(context, async () => ({ data, mimeType: "image/png" }));
    const path = join(root, "session.jsonl");
    const manager = SessionManager.create(root, root); manager.newSession({ id: "s" }); manager.setSessionFile(path);
    assert(syncCloudContext(manager, hydrated));
    await manager.close();
    const reopened = await SessionManager.open(path, root);
    const expected = contextToPiMessages(hydrated.messages, { projectImage: contentBlockToPiImage });
    assert.deepEqual(reopened.buildSessionContext().messages, expected);
    for (const index of [0, 2]) {
      const content = expected[index]?.content;
      assert(Array.isArray(content));
      assert.equal(getRemoteImageUrl(content[0]), url);
    }
    assert.equal(syncCloudContext(reopened, { ...hydrated, revision: "next" }), false);
    assert.deepEqual(reopened.buildSessionContext().messages, expected);
    await reopened.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("resume revalidates persisted passthrough metadata and normalizes oversized originals", async () => {
  const context: RuntimeContext = { ...history, messages: [{ id: "u", turnId: "t", role: "user", content: [{
    type: "image", source: { type: "url", url: "https://trusted.test/large.png" }, _meta: { imageUrlPassthrough: true },
  }] }] };
  const data = await png(3000);
  const hydrated = await hydrateContextImages(context, async () => ({ data, mimeType: "image/png" }), {
    writeImage: async (image) => {
      assert.equal((await sharp(image.data).metadata()).width, 2048);
      return "https://trusted.test/resized.png";
    },
  });
  const messages = contextToPiMessages(hydrated.messages, { projectImage: contentBlockToPiImage });
  const content = messages[0]?.content;
  assert(Array.isArray(content));
  const image: ImageContent = content[0];
  assert.equal(getRemoteImageUrl(image), "https://trusted.test/resized.png");
});

test("legacy inline history becomes uploaded URLs during recovery without rewriting DB content", async () => {
  const data = await png();
  const context: RuntimeContext = { ...history, messages: [{ id: "legacy", turnId: "t", role: "user", content: [{
    type: "image", source: { type: "base64", media_type: "image/png", data: data.toString("base64") },
  }] }] };
  const original = structuredClone(context);
  const hydrated = await hydrateContextImages(context, async () => { throw new Error("Unexpected download"); }, {
    writeImage: async (image) => { assert.deepEqual(image.data, data); return "https://trusted.test/migrated.png"; },
  });
  assert.deepEqual(context, original);
  const content = contextToPiMessages(hydrated.messages, { projectImage: contentBlockToPiImage })[0]?.content;
  assert(Array.isArray(content));
  assert.equal(getRemoteImageUrl(content[0]), "https://trusted.test/migrated.png");
});
