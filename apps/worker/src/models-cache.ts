import { readFile } from "node:fs/promises";
import {
  createCachedModelsConfig,
  getUserModelsRedisKey,
  MODELS_CACHE_TTL_SEC,
  parseModelsConfig,
  PLATFORM_MODELS_REDIS_KEY,
  type CachedModelsConfig,
} from "@cohub/infra/config-runtime/models";
import { redisCommandClient } from "./redis.js";

export async function publishModelsCacheFromFile(input: {
  modelsPath: string;
  scope: "platform" | "user";
  userId?: string;
  sourceCheckpointId?: string | null;
}): Promise<CachedModelsConfig> {
  if (input.scope === "user" && !input.userId) {
    throw new Error("userId is required when publishing user models cache");
  }

  const redisKey = input.scope === "platform"
    ? PLATFORM_MODELS_REDIS_KEY
    : getUserModelsRedisKey(input.userId ?? "");

  let cached: CachedModelsConfig;
  try {
    const rawText = await readFile(input.modelsPath, "utf-8");
    const content = parseModelsConfig(rawText);
    cached = createCachedModelsConfig({
      rawText,
      content,
      sourceCheckpointId: input.sourceCheckpointId ?? null,
    });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : undefined;
    if (code !== "ENOENT") throw error;
    cached = createCachedModelsConfig({
      content: null,
      sourceCheckpointId: input.sourceCheckpointId ?? null,
    });
  }

  await redisCommandClient.set(redisKey, JSON.stringify(cached), "EX", MODELS_CACHE_TTL_SEC);
  return cached;
}
