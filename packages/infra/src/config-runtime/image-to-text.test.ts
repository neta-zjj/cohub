import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mergeImageToTextConfigs,
  parseImageToTextConfig,
  parseImageToTextConfigOverride,
} from "./image-to-text.js";

const raw = JSON.stringify({
  enabled: true,
  model: {
    provider: "cohub",
    id: "vlm",
    api: "openai-responses",
    baseUrl: "https://example.com/v1",
    apiKey: "VLM_API_KEY",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0.1, output: 0.2 },
  },
  prompt: "Describe the image.",
  temperature: 0,
  maxTokens: 900,
  thinkingLevel: "off",
  timeoutMs: 10_000,
});

test("parseImageToTextConfig accepts a standalone no-think model", () => {
  const config = parseImageToTextConfig(raw);
  assert.equal(config.model.reasoning, false);
  assert.equal(config.thinkingLevel, "off");
  assert.deepEqual(config.model.input, ["text", "image"]);
});

test("mergeImageToTextConfigs keeps platform model fields while applying user overrides", () => {
  const platform = parseImageToTextConfig(raw);
  const user = parseImageToTextConfigOverride(JSON.stringify({
    prompt: "Use concise OCR.",
    maxTokens: 500,
    model: { headers: { "x-scope": "user" } },
  }));
  const merged = mergeImageToTextConfigs(platform, user);
  assert.equal(merged?.prompt, "Use concise OCR.");
  assert.equal(merged?.maxTokens, 500);
  assert.equal(merged?.model.baseUrl, "https://example.com/v1");
  assert.equal(merged?.model.headers?.["x-scope"], "user");
});

test("a minimal user override can disable the fallback", () => {
  assert.equal(mergeImageToTextConfigs(parseImageToTextConfig(raw), { enabled: false }), null);
});

test("parseImageToTextConfig rejects an incomplete model", () => {
  assert.throws(() => parseImageToTextConfig(JSON.stringify({ prompt: "Describe.", model: { id: "vlm" } })));
});
