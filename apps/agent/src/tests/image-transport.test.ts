import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { restoreRemoteImageUrls, urlToPiImage } from "@cohub/model-runtime/image-content";
import { createModelsFromRegistry } from "@cohub/model-runtime/pi-models-adapter";
import { prepareRemoteImagesForModel } from "../runtime/image-transport.js";

const url = "https://public.cohub.test/chat-attachments/image.png";
const marker = urlToPiImage(url);
const context: Context = { messages: [
  { role: "user", content: [{ type: "text", text: "Inspect this." }, marker], timestamp: 0 },
  { role: "toolResult", toolCallId: "tool-1", toolName: "read", content: [marker], isError: false, timestamp: 0 },
] };

function modelFor(api: Api): Model<Api> {
  return {
    api, id: "test-model", provider: "test", name: "Test", baseUrl: "https://provider.test/v1",
    input: ["text", "image"], reasoning: false, contextWindow: 32000, maxTokens: 2048,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

async function capturePayload(model: Model<Api>, input: Context): Promise<unknown> {
  const apiKey = model.api === "openai-codex-responses"
    ? `test.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test-account" } })).toString("base64url")}.test`
    : "test-api-key";
  const models = createModelsFromRegistry({
    getAvailable: () => [model], getApiKey: () => apiKey, getHeaders: () => undefined,
  });
  let payload: unknown;
  const response = await models.completeSimple(model, input, {
    apiKey,
    onPayload: (value) => {
      payload = restoreRemoteImageUrls(value);
      throw new Error("Payload captured before network");
    },
  });
  assert.notEqual(payload, undefined, response.errorMessage ?? "No provider payload");
  assert.match(response.errorMessage ?? "", /Payload captured before network/);
  return payload;
}

for (const api of ["anthropic-messages", "openai-completions", "openai-responses", "openai-codex-responses", "azure-openai-responses", "mistral-conversations"] as const) {
  test(`${api} serializes URL images with the installed pi SDK and never downloads them`, async () => {
    const model = modelFor(api);
    const prepared = await prepareRemoteImagesForModel(context, model, { read: async () => { throw new Error("Unexpected image download"); } });
    assert.equal(prepared, context);
    const payload = await capturePayload(model, prepared);
    const serialized = JSON.stringify(payload);
    assert(serialized.includes(url));
    assert(!serialized.includes(marker.data));
    assert(!serialized.includes(marker.mimeType));
    if (api.endsWith("responses")) assert(serialized.includes(`"image_url":"${url}"`));
    if (api === "anthropic-messages") assert(serialized.includes(`"source":{"type":"url","url":"${url}"}`));
  });
}

for (const api of ["google-generative-ai", "google-vertex", "bedrock-converse-stream"] as const) {
  test(`${api} receives valid image bytes while the history retains URL markers`, async () => {
    const original = structuredClone(context);
    const model = modelFor(api);
    let reads = 0;
    const data = await sharp({ create: { width: 32, height: 24, channels: 3, background: "red" } }).png().toBuffer();
    const cacheKey = {};
    const prepared = await prepareRemoteImagesForModel(context, model, { cacheKey, read: async (requested) => {
      reads++;
      assert.equal(requested, url);
      return { data, mimeType: "image/png" };
    } });
    const nextRound = await prepareRemoteImagesForModel(structuredClone(context), model, { cacheKey, read: async () => { throw new Error("Should use cached image bytes"); } });
    assert.deepEqual(nextRound, prepared);
    assert.equal(reads, 1, "user and tool copies share one download per request");
    assert.deepEqual(context, original);
    const user = prepared.messages[0];
    assert(user?.role === "user" && Array.isArray(user.content));
    const image = user.content[1];
    assert(image?.type === "image");
    const bytes = Buffer.from(image.data, "base64");
    assert.equal((await sharp(bytes).metadata()).format, "webp");
    const payload = await capturePayload(model, prepared);
    const serialized = JSON.stringify(payload);
    assert(!serialized.includes(marker.mimeType));
    assert(!serialized.includes(marker.data));
    assert(!serialized.includes(url));
    if (api.startsWith("google")) assert(serialized.includes(`"mimeType":"image/webp","data":"${image.data}"`));
    else {
      assert(payload && typeof payload === "object" && "messages" in payload && Array.isArray(payload.messages));
      const sent = payload.messages[0].content.find((part: { image?: unknown }) => part.image)?.image;
      assert.equal(sent.format, "webp");
      assert.deepEqual(Buffer.from(sent.source.bytes), bytes);
    }
    assert.equal(await prepareRemoteImagesForModel(context, modelFor("anthropic-messages")), context, "switching back keeps the original remote images");
  });
}

test("byte-only APIs omit failed and malformed URL markers instead of sending fake image bytes", async () => {
  const broken: Context = { messages: [{ role: "user", content: [marker, { ...marker, data: "" }], timestamp: 0 }] };
  for (const read of [async () => null, async () => { throw new Error("CDN unavailable"); }]) {
    const result = await prepareRemoteImagesForModel(broken, modelFor("google-generative-ai"), { read });
    const message = result.messages[0];
    assert(message?.role === "user" && Array.isArray(message.content));
    assert(message.content.every((part) => part.type === "text" && part.text.includes("Image omitted")));
  }
});

test("byte-only downloads are bounded across history and preserve block order", async () => {
  const input: Context = { messages: [{ role: "user", content: Array.from({ length: 7 }, (_, index) => urlToPiImage(`${url}?i=${index}`)), timestamp: 0 }] };
  let active = 0, maximum = 0, reads = 0;
  const result = await prepareRemoteImagesForModel(input, modelFor("google-generative-ai"), { read: async () => {
    active++; reads++; maximum = Math.max(active, maximum);
    await new Promise<void>((resolve) => setImmediate(resolve));
    active--;
    return null;
  } });
  assert.equal(reads, 7);
  assert.equal(maximum, 4);
  assert.equal(result.messages[0]?.content.length, 7);
});
