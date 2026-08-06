import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { parseImageToTextConfig } from "@cohub/infra/config-runtime/image-to-text";
import { SessionManager } from "../runtime/local-session-manager.js";

process.env.DATABASE_URL ??= "postgres://localhost/cohub_test";
process.env.APP_ENCRYPTION_KEY ??= "test-key";
process.env.SESSIONS_NAMESPACE ??= "test";

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

function createMessage(): AgentMessage {
  return {
    role: "user",
    content: [
      { type: "text", text: "Inspect this." },
      { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
    ],
    timestamp: Date.now(),
    meta: { messageId: "message-u1", turnId: "turn-u1" },
  } as AgentMessage;
}

test("Agent projects JSONL sidecar descriptions while custom entries stay out of normal context", async () => {
  const { prepareAgentImagesForModel } = await import("../runtime/image-to-text.js");
  const sessionManager = SessionManager.create("/workspace", "/tmp");
  const message = createMessage();
  const sourceEntryId = sessionManager.appendMessage(message, { id: "entry-u1" });
  sessionManager.appendCustomEntry("image_description.v1", {
    sourceEntryId,
    imageIndex: 0,
    text: "A terminal displaying a build result.",
    provider: "cohub",
    model: "vlm",
    usage: { input: 10, output: 5, totalTokens: 15 },
    generatedAt: "2026-08-03T10:00:00.000Z",
  });

  assert.equal(sessionManager.buildSessionContext().messages.length, 1);
  const context = { systemPrompt: "", messages: [message] } as Context;
  const prepared = await prepareAgentImagesForModel({
    context,
    targetModel: textModel,
    config,
    sessionManager,
    sessionId: "session-1",
    executionTurnId: "turn-current",
  });

  assert.equal(prepared.calls.length, 0);
  const projectedContent = prepared.context.messages[0]?.content;
  const originalContent = context.messages[0]?.content;
  assert.ok(Array.isArray(projectedContent));
  assert.ok(Array.isArray(originalContent));
  assert.equal((projectedContent[1] as { type: string }).type, "text");
  assert.match((projectedContent[1] as { text: string }).text, /terminal displaying/);
  assert.equal((originalContent[1] as { type: string }).type, "image");
});

test("Agent projection keeps uncloneable tool references and does not mutate the original context", async () => {
  const { prepareAgentImagesForModel } = await import("../runtime/image-to-text.js");
  const sessionManager = SessionManager.create("/workspace", "/tmp");
  const message = createMessage();
  const sourceEntryId = sessionManager.appendMessage(message, { id: "entry-u2" });
  sessionManager.appendCustomEntry("image_description.v1", {
    sourceEntryId,
    imageIndex: 0,
    text: "A chart showing request latency.",
    provider: "cohub",
    model: "vlm",
    usage: { input: 8, output: 4, totalTokens: 12 },
    generatedAt: "2026-08-03T10:00:00.000Z",
  });

  const execute = async () => ({ content: [{ type: "text", text: "ok" }] });
  const tools = [{ name: "shell", description: "Run a command", parameters: {}, execute }];
  const context = { systemPrompt: "", messages: [message], tools } as unknown as Context;

  const prepared = await prepareAgentImagesForModel({
    context,
    targetModel: textModel,
    config,
    sessionManager,
    sessionId: "session-2",
    executionTurnId: "turn-current",
  });

  assert.equal(prepared.calls.length, 0);
  assert.equal(prepared.context.tools, tools, "tool references must be preserved");
  const projectedContent = prepared.context.messages[0]?.content;
  assert.ok(Array.isArray(projectedContent));
  assert.equal((projectedContent[1] as { type: string }).type, "text");
  assert.match((projectedContent[1] as { text: string }).text, /request latency/);

  const originalContent = context.messages[0]?.content;
  assert.ok(Array.isArray(originalContent));
  assert.equal((originalContent[1] as { type: string }).type, "image", "original context must stay untouched");
  assert.notEqual(projectedContent, originalContent);
});
