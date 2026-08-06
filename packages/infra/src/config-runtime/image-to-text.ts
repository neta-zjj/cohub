import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const IMAGE_TO_TEXT_CONFIG_PATH = ".cohub/image-to-text.json";
export const IMAGE_TO_TEXT_CACHE_REDIS_KEY_VERSION = "v1";
export const PLATFORM_IMAGE_TO_TEXT_REDIS_KEY = `configs:image-to-text:${IMAGE_TO_TEXT_CACHE_REDIS_KEY_VERSION}:platform`;
export const USER_IMAGE_TO_TEXT_REDIS_KEY_PREFIX = `configs:image-to-text:${IMAGE_TO_TEXT_CACHE_REDIS_KEY_VERSION}:user`;
export const IMAGE_TO_TEXT_CACHE_TTL_SEC = 24 * 60 * 60;

const SAFE_REDIS_KEY_SEGMENT_REGEX = /^[0-9a-zA-Z_-]+$/;
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export type ImageToTextThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type ImageToTextModelConfig = {
  provider: string;
  id: string;
  name?: string;
  api: string;
  baseUrl: string;
  apiKey?: string;
  reasoning?: boolean;
  input?: Array<"text" | "image">;
  cost?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  contextWindow?: number;
  maxTokens?: number;
  headers?: Record<string, string>;
  compat?: unknown;
};

export type ImageToTextConfig = {
  enabled?: boolean;
  model: ImageToTextModelConfig;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  thinkingLevel?: ImageToTextThinkingLevel;
  timeoutMs?: number;
};

export type ImageToTextConfigOverride = Omit<Partial<ImageToTextConfig>, "model"> & {
  model?: Omit<Partial<ImageToTextModelConfig>, "cost"> & {
    cost?: Partial<NonNullable<ImageToTextModelConfig["cost"]>>;
  };
};

export type CachedImageToTextConfig = {
  rev: string;
  updatedAt: string;
  sourceCheckpointId?: string | null;
  content: ImageToTextConfigOverride | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isModelOverride(value: unknown): value is NonNullable<ImageToTextConfigOverride["model"]> {
  if (!isRecord(value)) return false;
  const input = value.input;
  const cost = value.cost;
  return (value.provider === undefined || (typeof value.provider === "string" && Boolean(value.provider.trim())))
    && (value.id === undefined || (typeof value.id === "string" && Boolean(value.id.trim())))
    && (value.api === undefined || (typeof value.api === "string" && Boolean(value.api.trim())))
    && (value.baseUrl === undefined || (typeof value.baseUrl === "string" && Boolean(value.baseUrl.trim())))
    && (value.name === undefined || typeof value.name === "string")
    && (value.apiKey === undefined || typeof value.apiKey === "string")
    && (value.reasoning === undefined || typeof value.reasoning === "boolean")
    && (input === undefined || (Array.isArray(input) && input.every((item) => item === "text" || item === "image")))
    && (cost === undefined || (isRecord(cost)
      && (cost.input === undefined || (isFiniteNumber(cost.input) && cost.input >= 0))
      && (cost.output === undefined || (isFiniteNumber(cost.output) && cost.output >= 0))
      && (cost.cacheRead === undefined || (isFiniteNumber(cost.cacheRead) && cost.cacheRead >= 0))
      && (cost.cacheWrite === undefined || (isFiniteNumber(cost.cacheWrite) && cost.cacheWrite >= 0))))
    && (value.contextWindow === undefined || (isFiniteNumber(value.contextWindow) && value.contextWindow > 0))
    && (value.maxTokens === undefined || (isFiniteNumber(value.maxTokens) && value.maxTokens > 0))
    && (value.headers === undefined || isStringRecord(value.headers));
}

function isModelConfig(value: unknown): value is ImageToTextModelConfig {
  return isModelOverride(value)
    && typeof value.provider === "string"
    && typeof value.id === "string"
    && typeof value.api === "string"
    && typeof value.baseUrl === "string"
    && (value.input === undefined || value.input.includes("image"))
    && (value.cost === undefined || (typeof value.cost.input === "number" && typeof value.cost.output === "number"));
}

export function isImageToTextConfigOverride(value: unknown): value is ImageToTextConfigOverride {
  if (!isRecord(value)) return false;
  return (value.enabled === undefined || typeof value.enabled === "boolean")
    && (value.model === undefined || isModelOverride(value.model))
    && (value.prompt === undefined || (typeof value.prompt === "string" && Boolean(value.prompt.trim())))
    && (value.temperature === undefined || isFiniteNumber(value.temperature))
    && (value.maxTokens === undefined || (isFiniteNumber(value.maxTokens) && value.maxTokens > 0))
    && (value.thinkingLevel === undefined || (typeof value.thinkingLevel === "string" && THINKING_LEVELS.has(value.thinkingLevel)))
    && (value.timeoutMs === undefined || (isFiniteNumber(value.timeoutMs) && value.timeoutMs > 0));
}

export function isImageToTextConfig(value: unknown): value is ImageToTextConfig {
  return isImageToTextConfigOverride(value)
    && isModelConfig(value.model)
    && typeof value.prompt === "string";
}

export function parseImageToTextConfig(rawText: string): ImageToTextConfig {
  const parsed = JSON.parse(rawText) as unknown;
  if (!isImageToTextConfig(parsed)) throw new Error("Image-to-text config file has invalid schema");
  return parsed;
}

export function parseImageToTextConfigOverride(rawText: string): ImageToTextConfigOverride {
  const parsed = JSON.parse(rawText) as unknown;
  if (!isImageToTextConfigOverride(parsed)) throw new Error("Image-to-text config file has invalid schema");
  return parsed;
}

function createFastContentHash(rawText: string): string {
  let hash = 2166136261;
  for (let index = 0; index < rawText.length; index += 1) {
    hash ^= rawText.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16)}:${rawText.length}`;
}

export function createCachedImageToTextConfig(input: {
  rawText?: string;
  content: ImageToTextConfigOverride | null;
  sourceCheckpointId?: string | null;
  updatedAt?: string;
}): CachedImageToTextConfig {
  return {
    rev: input.rawText ? createFastContentHash(input.rawText) : `missing:${input.sourceCheckpointId ?? "image-to-text"}`,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    sourceCheckpointId: input.sourceCheckpointId ?? null,
    content: input.content,
  };
}

export function parseCachedImageToTextConfig(rawText: string): CachedImageToTextConfig | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const content = parsed.content;
  if (content !== null && !isImageToTextConfigOverride(content)) return null;
  return {
    rev: typeof parsed.rev === "string" ? parsed.rev : "unknown",
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
    sourceCheckpointId: typeof parsed.sourceCheckpointId === "string" ? parsed.sourceCheckpointId : null,
    content,
  };
}

export function getUserImageToTextRedisKey(userId: string): string {
  const trimmed = userId.trim();
  if (!SAFE_REDIS_KEY_SEGMENT_REGEX.test(trimmed)) throw new Error("Invalid userId for Redis key");
  return `${USER_IMAGE_TO_TEXT_REDIS_KEY_PREFIX}:${trimmed}`;
}

export function mergeImageToTextConfigs(
  platform: ImageToTextConfigOverride | null | undefined,
  user: ImageToTextConfigOverride | null | undefined,
): ImageToTextConfig | null {
  if (!platform && !user) return null;
  const cost = platform?.model?.cost || user?.model?.cost
    ? { ...(platform?.model?.cost ?? {}), ...(user?.model?.cost ?? {}) }
    : undefined;
  const headers = platform?.model?.headers || user?.model?.headers
    ? { ...(platform?.model?.headers ?? {}), ...(user?.model?.headers ?? {}) }
    : undefined;
  const merged = {
    ...(platform ?? {}),
    ...(user ?? {}),
    model: {
      ...(platform?.model ?? {}),
      ...(user?.model ?? {}),
      ...(cost ? { cost } : {}),
      ...(headers ? { headers } : {}),
    },
  };
  if (merged.enabled === false) return null;
  if (!isImageToTextConfig(merged)) throw new Error("Merged image-to-text config is incomplete");
  return merged;
}

export function resolveImageToTextApiKey(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const envValue = process.env[value];
  return envValue?.trim() || value.trim() || undefined;
}

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
};

export function createImageToTextConfigLoader(input: {
  platformConfigRoot: string;
  redis: RedisLike;
}) {
  const inflightByKey = new Map<string, Promise<ImageToTextConfigOverride | null>>();

  async function loadOne(params: { path: string; redisKey: string }): Promise<ImageToTextConfigOverride | null> {
    const inflight = inflightByKey.get(params.redisKey);
    if (inflight) return inflight;

    const promise = (async () => {
      const cached = await input.redis.get(params.redisKey).catch(() => null);
      if (cached) {
        const parsed = parseCachedImageToTextConfig(cached);
        if (parsed) return parsed.content;
      }

      let rawText: string;
      try {
        rawText = await readFile(params.path, "utf-8");
      } catch (error) {
        const code = isRecord(error) && typeof error.code === "string" ? error.code : null;
        if (code !== "ENOENT") throw error;
        const missing = createCachedImageToTextConfig({ content: null });
        await input.redis.set(params.redisKey, JSON.stringify(missing), "EX", IMAGE_TO_TEXT_CACHE_TTL_SEC).catch(() => undefined);
        return null;
      }

      const content = parseImageToTextConfigOverride(rawText);
      const cachedConfig = createCachedImageToTextConfig({ rawText, content });
      await input.redis.set(params.redisKey, JSON.stringify(cachedConfig), "EX", IMAGE_TO_TEXT_CACHE_TTL_SEC).catch(() => undefined);
      return content;
    })();

    inflightByKey.set(params.redisKey, promise);
    try {
      return await promise;
    } finally {
      inflightByKey.delete(params.redisKey);
    }
  }

  return async function loadImageToTextConfig(userId?: string | null): Promise<ImageToTextConfig | null> {
    const platform = await loadOne({
      path: join(input.platformConfigRoot, "platform", IMAGE_TO_TEXT_CONFIG_PATH),
      redisKey: PLATFORM_IMAGE_TO_TEXT_REDIS_KEY,
    });
    const normalizedUserId = userId?.trim();
    const user = normalizedUserId
      ? await loadOne({
          path: join(input.platformConfigRoot, "users", normalizedUserId, IMAGE_TO_TEXT_CONFIG_PATH),
          redisKey: getUserImageToTextRedisKey(normalizedUserId),
        })
      : null;
    return mergeImageToTextConfigs(platform, user);
  };
}
