import type { Api, Model, ProviderHeaders, ProviderStreams, StreamOptions } from "@earendil-works/pi-ai";

/**
 * Claude Code release the identity claims. Upstreams gate newer Claude models on
 * it (claude-opus-5-5 requires >= 2.1.280). Keep in step with the identity pi's
 * Anthropic OAuth path sends.
 */
export const CLAUDE_CODE_VERSION = "2.1.280";
/** models.json `requestProfile` that opts a provider or model into the Claude Code identity. */
export const CLAUDE_CODE_REQUEST_PROFILE = "claude-code";
export const CLAUDE_CODE_SYSTEM_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";
export const CLAUDE_CODE_BETA = "claude-code-20250219";

const CLAUDE_CODE_HEADERS: Record<string, string> = {
  "User-Agent": `claude-cli/${CLAUDE_CODE_VERSION}`,
  "x-app": "cli",
};

type ClaudeCodeOverrides = Pick<StreamOptions, "headers" | "onPayload">;

export function usesClaudeCodeProfile(model: Model<Api>): boolean {
  return "requestProfile" in model && model.requestProfile === CLAUDE_CODE_REQUEST_PROFILE;
}

function hasHeader(sources: ReadonlyArray<ProviderHeaders | undefined>, name: string): boolean {
  const expected = name.toLowerCase();
  return sources.some((headers) => Object.keys(headers ?? {}).some((key) => key.toLowerCase() === expected));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Lead the system prompt with the Claude Code identity and declare the Claude Code beta. */
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

/**
 * Request options that make a `claude-code` profile request look like Claude
 * Code, as pi already does for Anthropic OAuth tokens. Explicitly configured
 * headers win: identity headers are only defaults, and a configured
 * `anthropic-beta` (which replaces pi's beta list) is left untouched.
 */
export function claudeCodeOverrides(model: Model<Api>, options: StreamOptions | undefined): ClaudeCodeOverrides {
  if (!usesClaudeCodeProfile(model)) return {};
  const configured = [model.headers, options?.headers];
  const identityHeaders = Object.fromEntries(
    Object.entries(CLAUDE_CODE_HEADERS).filter(([name]) => !hasHeader(configured, name)),
  );
  const beta = !hasHeader(configured, "anthropic-beta");
  const onPayload = options?.onPayload;
  return {
    headers: { ...identityHeaders, ...options?.headers },
    onPayload: async (payload, payloadModel) => {
      const next = onPayload ? ((await onPayload(payload, payloadModel)) ?? payload) : payload;
      return withClaudeCodePayload(next, { beta });
    },
  };
}

/** Wrap an Anthropic Messages API so every `claude-code` profile request carries the Claude Code identity. */
export function withClaudeCodeIdentity(streams: ProviderStreams): ProviderStreams {
  return {
    ...streams,
    stream: (model, context, options) => streams.stream(model, context, { ...options, ...claudeCodeOverrides(model, options) }),
    streamSimple: (model, context, options) =>
      streams.streamSimple(model, context, { ...options, ...claudeCodeOverrides(model, options) }),
  };
}
