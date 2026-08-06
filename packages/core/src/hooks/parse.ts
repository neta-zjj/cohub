import { parse as parseYaml } from "yaml";
import {
  SPACE_HOOK_SCHEMA,
  SPACE_HOOKS_DIR,
  isSpaceHookableEvent,
  type SpaceHookableEvent,
} from "@cohub/protocol";
import { parsePromptEnv } from "../sessions/prompt-env.js";
import type { SpaceHookDefinition } from "./types.js";

const HOOK_FILE_EXTENSIONS = new Set([".yml", ".yaml", ".json"]);
const MAX_RUN_LENGTH = 64 * 1024;
const DEFAULT_TIMEOUT_SECS = 10 * 60;
const MAX_TIMEOUT_SECS = 30 * 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function normalizeKinds(value: unknown): SpaceHookDefinition["kinds"] | undefined {
  if (!Array.isArray(value)) return undefined;
  const kinds = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item): item is "create" | "modify" | "delete" | "rename" =>
      item === "create" || item === "modify" || item === "delete" || item === "rename");
  return kinds.length > 0 ? Array.from(new Set(kinds)) : undefined;
}

function normalizeTimeoutSecs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(Math.floor(value), MAX_TIMEOUT_SECS);
}

function parseDocument(raw: string, path: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error(`hook file is empty: ${path}`);
  if (path.endsWith(".json")) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch (error) {
      throw new Error(`invalid hook json ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  try {
    return parseYaml(trimmed);
  } catch (error) {
    throw new Error(`invalid hook yaml ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function isSpaceHookFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return Array.from(HOOK_FILE_EXTENSIONS).some((ext) => lower.endsWith(ext));
}

export function normalizeSpaceHookPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
}

export function isSpaceHookPath(path: string): boolean {
  const normalized = normalizeSpaceHookPath(path);
  if (!normalized.startsWith(`${SPACE_HOOKS_DIR}/`)) return false;
  const relative = normalized.slice(SPACE_HOOKS_DIR.length + 1);
  if (!relative || relative.includes("/")) return false;
  return isSpaceHookFileName(relative);
}

export function parseSpaceHookDefinition(raw: string, path: string): SpaceHookDefinition {
  const normalizedPath = normalizeSpaceHookPath(path);
  if (!isSpaceHookPath(normalizedPath)) {
    throw new Error(`hook path must be a top-level file under ${SPACE_HOOKS_DIR}: ${path}`);
  }

  const document = parseDocument(raw, normalizedPath);
  if (!isRecord(document)) throw new Error(`hook must be an object: ${normalizedPath}`);
  if (document.schema !== SPACE_HOOK_SCHEMA) {
    throw new Error(`unsupported hook schema in ${normalizedPath}; expected ${SPACE_HOOK_SCHEMA}`);
  }

  const on = isRecord(document.on) ? document.on : null;
  const eventValue = typeof on?.event === "string" ? on.event.trim() : "";
  if (!eventValue || !isSpaceHookableEvent(eventValue)) {
    throw new Error(`unsupported or missing on.event in ${normalizedPath}`);
  }

  const hasRun = Object.hasOwn(document, "run");
  const hasPrompt = Object.hasOwn(document, "prompt");
  if (hasRun === hasPrompt) {
    throw new Error(`exactly one of run or prompt is required in ${normalizedPath}`);
  }

  const timeoutSecs = normalizeTimeoutSecs(document.timeoutSecs ?? document.timeout)
    ?? DEFAULT_TIMEOUT_SECS;
  const topLevelEnv = parseHookUserEnv(document.env, normalizedPath);

  const triggerFilters = {
    paths: normalizeStringList(on?.paths),
    ignore: normalizeStringList(on?.ignore),
    kinds: normalizeKinds(on?.kinds),
    sessionIds: normalizeStringList(on?.sessionIds),
    ignoreSessionIds: normalizeStringList(on?.ignoreSessionIds),
    sources: normalizeStringList(on?.sources),
  };

  if (hasRun) {
    const run = typeof document.run === "string" ? document.run.trim() : "";
    if (!run) throw new Error(`missing run in ${normalizedPath}`);
    if (run.length > MAX_RUN_LENGTH) throw new Error(`run is too long in ${normalizedPath}`);
    return {
      schema: SPACE_HOOK_SCHEMA,
      path: normalizedPath,
      event: eventValue as SpaceHookableEvent,
      ...triggerFilters,
      action: "run",
      run,
      ...(topLevelEnv ? { env: topLevelEnv } : {}),
      timeoutSecs,
    };
  }

  const prompt = parsePromptDefinition(document.prompt, normalizedPath);
  // Prefer top-level env; keep legacy prompt.env as fallback only when top-level is absent.
  const env = topLevelEnv ?? parseHookUserEnv(
    isRecord(document.prompt) ? document.prompt.env : undefined,
    normalizedPath,
  );

  return {
    schema: SPACE_HOOK_SCHEMA,
    path: normalizedPath,
    event: eventValue as SpaceHookableEvent,
    ...triggerFilters,
    action: "prompt",
    prompt,
    ...(env ? { env } : {}),
    timeoutSecs,
  };
}

function parseHookUserEnv(value: unknown, path: string): Record<string, string> | null {
  if (value === undefined || value === null) return null;
  try {
    return parsePromptEnv(value);
  } catch (error) {
    throw new Error(`invalid env in ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parsePromptDefinition(value: unknown, path: string): SpaceHookDefinition["prompt"] {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) throw new Error(`missing prompt text in ${path}`);
    if (text.length > MAX_RUN_LENGTH) throw new Error(`prompt is too long in ${path}`);
    return { text };
  }
  if (!isRecord(value)) throw new Error(`prompt must be a string or object in ${path}`);

  const text = typeof value.text === "string"
    ? value.text.trim()
    : typeof value.content === "string"
      ? value.content.trim()
      : "";
  if (!text) throw new Error(`missing prompt text in ${path}`);
  if (text.length > MAX_RUN_LENGTH) throw new Error(`prompt is too long in ${path}`);

  const intent = value.intent === "followup" || value.intent === "steer" ? value.intent : null;
  const accessMode = value.accessMode === "read_only" || value.accessMode === "full_access"
    ? value.accessMode
    : null;

  const labelRefs = Array.isArray(value.labelRefs)
    ? value.labelRefs.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : null;

  return {
    text,
    sessionId: typeof value.sessionId === "string" && value.sessionId.trim() ? value.sessionId.trim() : null,
    title: typeof value.title === "string" && value.title.trim() ? value.title.trim() : null,
    intent,
    accessMode,
    model: typeof value.model === "string" && value.model.trim() ? value.model.trim() : null,
    provider: typeof value.provider === "string" && value.provider.trim() ? value.provider.trim() : null,
    thinkingLevel: typeof value.thinkingLevel === "string" && value.thinkingLevel.trim() ? value.thinkingLevel.trim() : null,
    ...(labelRefs && labelRefs.length > 0 ? { labelRefs } : {}),
  };
}

export function getDefaultSpaceHookTimeoutSecs() {
  return DEFAULT_TIMEOUT_SECS;
}

export function getMaxSpaceHookTimeoutSecs() {
  return MAX_TIMEOUT_SECS;
}
