import { Redis } from "ioredis";
import { SYSTEM_ENV_KEY_SET, SPACE_ENV_REDIS_KEY } from "@cohub/protocol/sandbox";
import { env } from "../env.js";
import { createLogger } from "@cohub/infra/logging";


const logger = createLogger({ serviceName: "cohub-agent" });
const cachedUserEnvBySpace = new Map<string, Record<string, string>>();
let redisClient: Redis | null = null;

/** Get a Redis client (lazy init, reused across calls; ioredis handles auto-reconnect) */
function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL, { disableClientInfo: true });
    redisClient.on("error", (err) => {
      logger.warn(`[EnvCache] Redis error for space env: ${err.message}`);
    });
  }
  return redisClient;
}

/**
 * Fetch space env from Redis cache (set by API on env changes).
 * Falls back to empty object if Redis is unavailable.
 */
export async function refreshUserEnv(spaceId: string): Promise<void> {
  try {
    const key = SPACE_ENV_REDIS_KEY(spaceId);
    const raw = await getRedisClient().get(key);
    if (!raw) {
      cachedUserEnvBySpace.set(spaceId, {});
      return;
    }

    const parsed: Array<{ name: string; value: string }> = JSON.parse(raw);
    const nextEnv: Record<string, string> = {};
    for (const entry of parsed) {
      // Double-safety: skip system keys even if somehow stored
      if (!SYSTEM_ENV_KEY_SET.has(entry.name) && entry.name.length > 0) {
        nextEnv[entry.name] = entry.value;
      }
    }
    cachedUserEnvBySpace.set(spaceId, nextEnv);
  } catch (err) {
    // Redis unavailable or bad data — keep using stale cache for this space
    logger.warn(`[EnvCache] Failed to refresh env for ${spaceId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Return a snapshot of the current user env for process injection */
export function getUserEnvForProcess(spaceId: string): Record<string, string> {
  return { ...(cachedUserEnvBySpace.get(spaceId) ?? {}) };
}
