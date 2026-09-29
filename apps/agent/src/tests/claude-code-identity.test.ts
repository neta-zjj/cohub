import assert from "node:assert/strict";
import test from "node:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  CLAUDE_CODE_BETA,
  CLAUDE_CODE_REQUEST_PROFILE,
  CLAUDE_CODE_SYSTEM_IDENTITY,
  CLAUDE_CODE_VERSION,
  claudeCodeOverrides,
  withClaudeCodePayload,
} from "@cohub/model-runtime/claude-code-identity";

function unprofiledModel(id: string, headers?: Record<string, string>): Model<Api> {
  return { id, provider: "cohub", api: "anthropic-messages", headers } as Model<Api>;
}

function model(id: string, headers?: Record<string, string>): Model<Api> & { requestProfile: string } {
  return { ...unprofiledModel(id, headers), requestProfile: CLAUDE_CODE_REQUEST_PROFILE };
}

const payload = { system: [{ type: "text", text: "cohub prompt" }], betas: ["fine-grained-tool-streaming-2025-05-14"] };

test("claude-code profile models get Claude Code identity headers", () => {
  const overrides = claudeCodeOverrides(model("claude-opus-5-5"), { headers: { "x-trace": "1" } });
  assert.deepEqual(overrides.headers, { "User-Agent": `claude-cli/${CLAUDE_CODE_VERSION} (external, cli)`, "x-app": "cli", "x-trace": "1" });
});

test("models without the claude-code profile are untouched, whatever their id", () => {
  assert.deepEqual(claudeCodeOverrides(unprofiledModel("claude-opus-5-5"), { headers: { "x-trace": "1" } }), {});
  assert.deepEqual(claudeCodeOverrides(unprofiledModel("glm-5"), undefined), {});
});

test("configured headers win over the identity", () => {
  const fromModel = claudeCodeOverrides(model("claude-sonnet-5", { "user-agent": "custom/1" }), undefined);
  assert.deepEqual(fromModel.headers, { "x-app": "cli" });
  const fromOptions = claudeCodeOverrides(model("claude-sonnet-5"), { headers: { "X-App": "web" } });
  assert.deepEqual(fromOptions.headers, { "User-Agent": `claude-cli/${CLAUDE_CODE_VERSION} (external, cli)`, "X-App": "web" });
});

test("API-key requests carry stable Claude Code session metadata", () => {
  const first = claudeCodeOverrides(model("claude-opus-5-5"), {
    apiKey: "sk-test",
    sessionId: "session-1",
  });
  const second = claudeCodeOverrides(model("claude-opus-5-5"), {
    apiKey: "sk-test",
    sessionId: "session-2",
  });
  const otherCredential = claudeCodeOverrides(model("claude-opus-5-5"), {
    apiKey: "sk-other",
    sessionId: "session-1",
  });
  const firstUser = JSON.parse(String(first.metadata?.user_id)) as {
    device_id: string;
    account_uuid: string;
    session_id: string;
  };
  const secondUser = JSON.parse(String(second.metadata?.user_id)) as typeof firstUser;
  const otherCredentialUser = JSON.parse(String(otherCredential.metadata?.user_id)) as typeof firstUser;
  assert.match(firstUser.device_id, /^[0-9a-f]{64}$/);
  assert.equal(firstUser.device_id, secondUser.device_id);
  assert.notEqual(firstUser.device_id, otherCredentialUser.device_id);
  assert.equal(firstUser.account_uuid, "");
  assert.equal(firstUser.session_id, "session-1");
  assert.equal(secondUser.session_id, "session-2");
});

test("configured metadata wins over generated Claude Code metadata", () => {
  const overrides = claudeCodeOverrides(model("claude-opus-5-5"), {
    apiKey: "sk-test",
    sessionId: "session-1",
    metadata: { user_id: "configured", trace: "1" },
  });
  assert.deepEqual(overrides.metadata, { user_id: "configured", trace: "1" });
});

test("identity leads the system prompt and the Claude Code beta is declared", async () => {
  const overrides = claudeCodeOverrides(model("claude-opus-5-5"), undefined);
  const next = await overrides.onPayload?.(payload, model("claude-opus-5-5"));
  assert.deepEqual(next, {
    system: [{ type: "text", text: CLAUDE_CODE_SYSTEM_IDENTITY }, { type: "text", text: "cohub prompt" }],
    betas: [CLAUDE_CODE_BETA, "fine-grained-tool-streaming-2025-05-14"],
  });
  // Applying twice changes nothing.
  assert.deepEqual(withClaudeCodePayload(next, { beta: true }), next);
});

test("requests without a system prompt still carry the identity", () => {
  assert.deepEqual(withClaudeCodePayload({ messages: [] }, { beta: true }), {
    messages: [],
    system: [{ type: "text", text: CLAUDE_CODE_SYSTEM_IDENTITY }],
    betas: [CLAUDE_CODE_BETA],
  });
});

test("a configured anthropic-beta list is left as configured", async () => {
  const overrides = claudeCodeOverrides(model("claude-opus-5-5", { "anthropic-beta": "context-1m-2025-08-07" }), undefined);
  const next = await overrides.onPayload?.({ ...payload, betas: ["context-1m-2025-08-07"] }, model("claude-opus-5-5"));
  assert.deepEqual((next as { betas: string[] }).betas, ["context-1m-2025-08-07"]);
});

test("the caller's payload hook runs first", async () => {
  const overrides = claudeCodeOverrides(model("claude-opus-5-5"), {
    onPayload: (value) => ({ ...(value as object), metadata: { user_id: "u" } }),
  });
  const next = await overrides.onPayload?.(payload, model("claude-opus-5-5"));
  assert.deepEqual((next as { metadata: unknown }).metadata, { user_id: "u" });
  assert.equal((next as { system: Array<{ text: string }> }).system[0]?.text, CLAUDE_CODE_SYSTEM_IDENTITY);
});
