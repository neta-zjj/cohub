import type { Api, Model, ProviderHeaders, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { mergeHeaders, type ModelRequestProfile } from "@cohub/infra/config-runtime/models";

export type ProfiledModel = Model<Api> & { requestProfile?: ModelRequestProfile };
export type RequestProfileOptions = SimpleStreamOptions & { threadId?: string };

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
