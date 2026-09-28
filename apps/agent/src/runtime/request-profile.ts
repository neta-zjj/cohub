import type { Api, Model, ProviderHeaders, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { mergeHeaders, type ModelRequestProfile } from "@cohub/infra/config-runtime/models";

export type ProfiledModel = Model<Api> & { requestProfile?: ModelRequestProfile };
export type RequestProfileOptions = SimpleStreamOptions & { threadId?: string };

/**
 * Prompt-cache routing hint for `anthropic-messages` requests: expose the
 * Cohub session uuid as `metadata.user_id` so NewAPI's Claude channel-affinity
 * rule can pin a session to one upstream channel.
 *
 * This only stabilizes channel selection. It is not part of Anthropic's
 * prompt-cache org+key prefix hash, so it cannot fix a changed tools/system
 * prefix.
 */
export function withAnthropicSessionAffinity(
  model: Pick<Model<Api>, "api">,
  options: SimpleStreamOptions,
  sessionId: string | null | undefined,
): SimpleStreamOptions {
  if (model.api !== "anthropic-messages" || !sessionId) return options;
  return {
    ...options,
    metadata: { ...options.metadata, user_id: sessionId.slice(0, 64) },
  };
}

export function applyRequestProfile(model: ProfiledModel, options: RequestProfileOptions): SimpleStreamOptions {
  const { threadId, ...streamOptions } = options;
  if (model.requestProfile !== "codex" || !streamOptions.sessionId) return streamOptions;

  const sessionId = streamOptions.sessionId.slice(0, 64);
  const affinityHeaders: ProviderHeaders = {
    "session-id": sessionId,
    "thread-id": (threadId ?? streamOptions.sessionId).slice(0, 64),
  };
  return { ...streamOptions, headers: mergeHeaders(affinityHeaders, streamOptions.headers) };
}
