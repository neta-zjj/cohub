import type { Api, Model, ProviderHeaders } from "@earendil-works/pi-ai";
import { mergeHeaders } from "@cohub/infra/config-runtime/models";
import type { RequestProfile } from "./index.js";

/** Kept in step with pi's Anthropic OAuth identity; upstreams gate newer Claude models on it. */
export const CLAUDE_CODE_VERSION = "2.1.280";
export const CLAUDE_CODE_SYSTEM_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";
export const CLAUDE_CODE_BETA = "claude-code-20250219";

const CLAUDE_CODE_HEADERS: Record<string, string> = {
  "User-Agent": `claude-cli/${CLAUDE_CODE_VERSION}`,
  "x-app": "cli",
};

function hasHeader(sources: ReadonlyArray<ProviderHeaders | undefined>, name: string): boolean {
  const expected = name.toLowerCase();
  return sources.some((headers) => Object.keys(headers ?? {}).some((key) => key.toLowerCase() === expected));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function withClaudeCodePayload(payload: unknown, options: { beta: boolean }): unknown {
  if (!isRecord(payload)) return payload;
  const system = payload.system ?? [];
  const betas = payload.betas ?? [];
  if (!Array.isArray(system) || !Array.isArray(betas)) return payload;

  const first: unknown = system[0];
  const hasIdentity = isRecord(first) && first.text === CLAUDE_CODE_SYSTEM_IDENTITY;
  return {
    ...payload,
    system: hasIdentity ? system : [{ type: "text", text: CLAUDE_CODE_SYSTEM_IDENTITY }, ...system],
    ...(options.beta && !betas.includes(CLAUDE_CODE_BETA) ? { betas: [CLAUDE_CODE_BETA, ...betas] } : {}),
  };
}

/** As pi already does for Anthropic OAuth tokens. Configured headers win over the identity defaults. */
export const claudeCodeOverrides: RequestProfile = (model: Model<Api>, options) => {
  if (model.api !== "anthropic-messages") return {};
  const configured = [model.headers, options.headers];
  const identityHeaders = Object.fromEntries(
    Object.entries(CLAUDE_CODE_HEADERS).filter(([name]) => !hasHeader(configured, name)),
  );
  const beta = !hasHeader(configured, "anthropic-beta");
  const onPayload = options.onPayload;
  return {
    headers: mergeHeaders<string | null>(identityHeaders, options.headers),
    onPayload: async (payload, payloadModel) => {
      const next = onPayload ? ((await onPayload(payload, payloadModel)) ?? payload) : payload;
      return withClaudeCodePayload(next, { beta });
    },
  };
};
