import assert from "node:assert/strict";
import { test } from "node:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { parseImageToTextConfig } from "@cohub/infra/config-runtime/image-to-text";
import { prepareCompletionImagesForModel } from "./image-to-text.js";

const config = parseImageToTextConfig(JSON.stringify({
  enabled: true,
  model: {
    provider: "cohub",
    id: "vlm",
    api: "openai-responses",
    baseUrl: "https://example.com/v1",
    apiKey: "VLM_API_KEY",
    reasoning: false,
    input: ["text", "image"],
  },
  prompt: "Describe the image.",
  thinkingLevel: "off",
}));

const textModel = { provider: "cohub", id: "text-model", input: ["text"] } as Model<Api>;
const visionModel = { provider: "cohub", id: "vision-model", input: ["text", "image"] } as Model<Api>;

function messagesWithStoredDescription() {
  return [{
    role: "user" as const,
    content: [
      { type: "text" as const, text: "What is shown?" },
      {
        type: "image" as const,
        source: { type: "base64" as const, media_type: "image/png", data: "aGVsbG8=" },
        _meta: {
          cohub: {
            imageDescription: {
              text: "A settings dialog.",
              provider: "cohub",
              model: "vlm",
              generatedAt: "2026-08-03T10:00:00.000Z",
            },
          },
        },
      },
    ],
    timestamp: Date.now(),
  }];
}

test("text-only completion reuses stored descriptions without changing canonical images", async () => {
  const messages = messagesWithStoredDescription();
  const original = structuredClone(messages);
  const prepared = await prepareCompletionImagesForModel({ messages, targetModel: textModel, config });

  assert.deepEqual(messages, original);
  assert.equal(prepared.calls.length, 0);
  assert.equal(prepared.messages[0]?.content[1]?.type, "image");
  const projectedBlock = prepared.projectedMessages[0]?.content[1];
  assert.equal(projectedBlock?.type, "text");
  assert.match((projectedBlock as { text: string }).text, /A settings dialog/);
});

test("vision completion stays on the original provider path", async () => {
  const messages = messagesWithStoredDescription();
  const prepared = await prepareCompletionImagesForModel({ messages, targetModel: visionModel, config });
  assert.deepEqual(prepared.messages, messages);
  assert.deepEqual(prepared.projectedMessages, messages);
  assert.notStrictEqual(prepared.messages, messages);
  assert.equal(prepared.calls.length, 0);
});
