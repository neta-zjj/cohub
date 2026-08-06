import { readFile } from "node:fs/promises";
import {
  createCachedImageToTextConfig,
  getUserImageToTextRedisKey,
  IMAGE_TO_TEXT_CACHE_TTL_SEC,
  parseImageToTextConfigOverride,
  PLATFORM_IMAGE_TO_TEXT_REDIS_KEY,
  type CachedImageToTextConfig,
} from "@cohub/infra/config-runtime/image-to-text";
import { redisCommandClient } from "./redis.js";

type ImageToTextCacheClient = Pick<typeof redisCommandClient, "set">;
type ReadImageToTextFile = (path: string, encoding: "utf-8") => Promise<string>;

export async function publishImageToTextCacheFromFile(
  input: {
    configPath: string;
    scope: "platform" | "user";
    userId?: string;
    sourceCheckpointId?: string | null;
  },
  deps: { cache: ImageToTextCacheClient; readFile: ReadImageToTextFile } = {
    cache: redisCommandClient,
    readFile,
  },
): Promise<CachedImageToTextConfig> {
  if (input.scope === "user" && !input.userId) {
    throw new Error("userId is required when publishing user image-to-text cache");
  }

  const redisKey = input.scope === "platform"
    ? PLATFORM_IMAGE_TO_TEXT_REDIS_KEY
    : getUserImageToTextRedisKey(input.userId ?? "");

  let cached: CachedImageToTextConfig;
  try {
    const rawText = await deps.readFile(input.configPath, "utf-8");
    const content = parseImageToTextConfigOverride(rawText);
    cached = createCachedImageToTextConfig({
      rawText,
      content,
      sourceCheckpointId: input.sourceCheckpointId ?? null,
    });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : undefined;
    if (code !== "ENOENT") throw error;
    cached = createCachedImageToTextConfig({
      content: null,
      sourceCheckpointId: input.sourceCheckpointId ?? null,
    });
  }

  await deps.cache.set(redisKey, JSON.stringify(cached), "EX", IMAGE_TO_TEXT_CACHE_TTL_SEC);
  return cached;
}
