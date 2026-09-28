import assert from "node:assert/strict";
import type { Model } from "@earendil-works/pi-ai";
import type { ModelsConfig } from "@cohub/infra/config-runtime/models";
import { CohubModelRegistry } from "../runtime/model-registry.js";
import { applyRequestProfile, withAnthropicSessionAffinity, type ProfiledModel } from "../runtime/request-profile.js";

const config: ModelsConfig = {
  providers: {
    test: {
      api: "openai-responses",
      baseUrl: "https://example.test/v1",
      headers: { Originator: "provider", "User-Agent": "provider-agent", "X-Shared": "provider" },
      models: [
        {
          id: "gpt-test",
          requestProfile: "codex",
          compat: { sessionAffinityFormat: "openai-nosession" },
          headers: { originator: "codex_cli_rs", "user-agent": "codex_cli_rs/test", "x-shared": "model" },
        },
      ],
    },
  },
};

const registry = new CohubModelRegistry({ configs: [config] });
const model = registry.find("test", "gpt-test");
assert.ok(model);
assert.equal(model.requestProfile, "codex");
assert.equal(registry.getHeaders("test", "gpt-test"), model.headers);
assert.deepEqual(model.headers, {
  originator: "codex_cli_rs",
  "user-agent": "codex_cli_rs/test",
  "x-shared": "model",
});

const sessionId = "x".repeat(67);
const options = applyRequestProfile(model, {
  sessionId,
  threadId: "thread-branch",
  headers: { "Session-Id": "override", "X-Request": "request" },
});
assert.deepEqual(options.headers, {
  "thread-id": "thread-branch",
  "Session-Id": "override",
  "X-Request": "request",
});

const alternateCompatModel = {
  ...model,
  compat: { sessionAffinityFormat: "openai" },
} as ProfiledModel;
assert.deepEqual(applyRequestProfile(alternateCompatModel, { sessionId: "session" }).headers, {
  "session-id": "session",
  "thread-id": "session",
});

const alternateApiModel = {
  ...model,
  api: "anthropic-messages",
} as Model<"anthropic-messages"> & { requestProfile: "codex" };
assert.deepEqual(applyRequestProfile(alternateApiModel, { sessionId: "session" }).headers, {
  "session-id": "session",
  "thread-id": "session",
});

// Anthropic session affinity: metadata.user_id mirrors the Cohub session uuid so
// NewAPI's Claude channel-affinity rule can pin the session to one channel.
const sessionUuid = "0b3cb8da-de75-4f9f-b0b7-9ed54e18fe91";
assert.deepEqual(
  withAnthropicSessionAffinity({ api: "anthropic-messages" }, {}, sessionUuid).metadata,
  { user_id: sessionUuid },
);
assert.deepEqual(
  withAnthropicSessionAffinity({ api: "anthropic-messages" }, { metadata: { trace: "t" } }, sessionUuid).metadata,
  { trace: "t", user_id: sessionUuid },
);
assert.equal(
  withAnthropicSessionAffinity({ api: "anthropic-messages" }, {}, null).metadata,
  undefined,
);
assert.deepEqual(
  withAnthropicSessionAffinity({ api: "openai-responses" }, {}, sessionUuid).metadata,
  undefined,
);
assert.deepEqual(
  withAnthropicSessionAffinity({ api: "anthropic-messages" }, {}, "s".repeat(80)).metadata,
  { user_id: "s".repeat(64) },
);

// The codex header profile must not pick up anthropic affinity.
assert.equal(applyRequestProfile(model, { sessionId: "session" }).metadata, undefined);
