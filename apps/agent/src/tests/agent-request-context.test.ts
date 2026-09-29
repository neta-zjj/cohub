import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { ModelsConfig } from "@cohub/infra/config-runtime/models";
import { SessionManager } from "../runtime/local-session-manager.js";
import { CohubModelRegistry } from "../runtime/model-registry.js";

process.env.DATABASE_URL ??= "postgres://localhost/cohub_test";
process.env.APP_ENCRYPTION_KEY ??= "test-key";
process.env.SESSIONS_NAMESPACE ??= "test";
process.env.TEST_ANTHROPIC_API_KEY = "test-key";

const { createCohubAgentSession } = await import("../runtime/session-runtime.js");

const config: ModelsConfig = {
  providers: {
    test: {
      api: "anthropic-messages",
      baseUrl: "https://anthropic.test",
      apiKey: "TEST_ANTHROPIC_API_KEY",
      models: [{ id: "claude-opus-5-5", reasoning: true }, { id: "glm-5", reasoning: true }],
    },
  },
};

type CapturedRequest = { headers: Headers; body: Record<string, unknown> };

const SSE_TEXT_REPLY = [
  { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "m", content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
  { type: "message_stop" },
].map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");

const requests: CapturedRequest[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_input, init) => {
  requests.push({ headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
  return new Response(SSE_TEXT_REPLY, { status: 200, headers: { "content-type": "text/event-stream" } });
};

const root = await mkdtemp(join(tmpdir(), "cohub-agent-request-"));
test.after(async () => {
  globalThis.fetch = originalFetch;
  await rm(root, { recursive: true, force: true });
});

const echoTool: AgentTool = {
  name: "echo",
  label: "Echo",
  description: "Echo the input",
  parameters: Type.Object({ text: Type.String() }),
  execute: async () => ({ content: [{ type: "text", text: "echo" }], details: undefined }),
};

async function createSession(modelId: string) {
  const modelRegistry = new CohubModelRegistry({ configs: [config] });
  const model = modelRegistry.find("test", modelId);
  assert.ok(model);
  const sessionManager = SessionManager.create(root, join(root, "sessions"));
  sessionManager.newSession({ id: `session-${modelId}` });
  const { session } = await createCohubAgentSession({ cwd: root, sessionManager, modelRegistry, tools: [echoTool], model });
  return { session, sessionManager };
}

function systemTexts(request: CapturedRequest | undefined): string[] {
  const system = request?.body.system;
  assert.ok(Array.isArray(system), "request carries a system prompt");
  return system.map((block: { text?: string }) => block.text ?? "");
}

function toolNames(request: CapturedRequest | undefined): string[] {
  const tools = request?.body.tools;
  assert.ok(Array.isArray(tools), "request declares tools");
  return tools.map((tool: { name?: string }) => tool.name ?? "");
}

test("agent requests carry the system prompt and tools, also after the transcript is rebuilt", async () => {
  requests.length = 0;
  const { session, sessionManager } = await createSession("claude-opus-5-5");

  await session.prompt("first");
  // Compaction and cloud sync rebuild the transcript from the session file,
  // which never holds system messages.
  session.agent.state.messages = sessionManager.buildSessionContext().messages;
  await session.prompt("second");

  assert.equal(requests.length, 2);
  const prompts = requests.map((request) => systemTexts(request).at(-1));
  assert.ok(prompts[0] && prompts[0].length > 0, "Cohub system prompt is sent");
  assert.equal(prompts[1], prompts[0]);
  for (const request of requests) assert.deepEqual(toolNames(request), ["echo"]);
  // Pi's transcript system messages stay out of the session file.
  const roles = sessionManager.getBranchEntries().flatMap((entry) => entry.type === "message" ? [entry.message.role] : []);
  assert.deepEqual(roles, ["user", "assistant", "user", "assistant"]);
  session.dispose();
});
