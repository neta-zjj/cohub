import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  getUserImageToTextRedisKey,
  IMAGE_TO_TEXT_CACHE_TTL_SEC,
  parseCachedImageToTextConfig,
  PLATFORM_IMAGE_TO_TEXT_REDIS_KEY,
  type ImageToTextConfigOverride,
} from "@cohub/infra/config-runtime/image-to-text";
import { publishImageToTextCacheFromFile } from "../src/image-to-text-cache.js";
import { redisCommandClient } from "../src/redis.js";

after(() => redisCommandClient.disconnect());

const override: ImageToTextConfigOverride = {
  enabled: true,
  model: { provider: "cohub", id: "vlm", api: "openai-responses", baseUrl: "https://example.com/v1" },
  prompt: "Describe the image.",
};

type CacheWrite = [key: string, value: string, mode: "EX", ttl: number];

function createDeps(readFile: () => Promise<string>) {
  const writes: CacheWrite[] = [];
  return {
    writes,
    deps: {
      cache: {
        set: async (...args: CacheWrite) => {
          writes.push(args);
          return "OK";
        },
      },
      readFile: async () => readFile(),
    },
  };
}

function singleWrite(writes: CacheWrite[]): CacheWrite {
  assert.equal(writes.length, 1);
  const write = writes[0];
  assert.ok(write);
  return write;
}

test("publishImageToTextCacheFromFile refreshes the platform cache from the published file", async () => {
  const rawText = JSON.stringify(override);
  const { deps, writes } = createDeps(async () => rawText);

  const cached = await publishImageToTextCacheFromFile(
    { configPath: "/configs/platform/.cohub/image-to-text.json", scope: "platform", sourceCheckpointId: "checkpoint-1" },
    deps,
  );

  const [key, value, mode, ttl] = singleWrite(writes);
  assert.equal(key, PLATFORM_IMAGE_TO_TEXT_REDIS_KEY);
  assert.equal(mode, "EX");
  assert.equal(ttl, IMAGE_TO_TEXT_CACHE_TTL_SEC);
  assert.deepEqual(parseCachedImageToTextConfig(value)?.content, override);
  assert.equal(cached.sourceCheckpointId, "checkpoint-1");
});

test("publishImageToTextCacheFromFile refreshes the per-user cache key", async () => {
  const rawText = JSON.stringify({ enabled: false });
  const { deps, writes } = createDeps(async () => rawText);

  await publishImageToTextCacheFromFile(
    { configPath: "/configs/users/user-1/.cohub/image-to-text.json", scope: "user", userId: "user-1", sourceCheckpointId: "checkpoint-2" },
    deps,
  );

  const [key, value] = singleWrite(writes);
  assert.equal(key, getUserImageToTextRedisKey("user-1"));
  assert.deepEqual(parseCachedImageToTextConfig(value)?.content, { enabled: false });
});

test("publishImageToTextCacheFromFile negatively caches a missing file so removal disables the fallback", async () => {
  const { deps, writes } = createDeps(async () => {
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  });

  const cached = await publishImageToTextCacheFromFile(
    { configPath: "/configs/platform/.cohub/image-to-text.json", scope: "platform", sourceCheckpointId: "checkpoint-3" },
    deps,
  );

  const [key, value, mode, ttl] = singleWrite(writes);
  assert.equal(key, PLATFORM_IMAGE_TO_TEXT_REDIS_KEY);
  assert.equal(mode, "EX");
  assert.equal(ttl, IMAGE_TO_TEXT_CACHE_TTL_SEC);
  assert.equal(parseCachedImageToTextConfig(value)?.content, null);
  assert.equal(cached.content, null);
});

test("publishImageToTextCacheFromFile rejects a user scope publish without userId", async () => {
  const writes: CacheWrite[] = [];
  const deps = {
    cache: {
      set: async (...args: CacheWrite) => {
        writes.push(args);
        return "OK";
      },
    },
    readFile: async () => "{}",
  };

  await assert.rejects(
    publishImageToTextCacheFromFile({ configPath: "/configs/users/user-1/.cohub/image-to-text.json", scope: "user" }, deps),
    /userId is required/,
  );
  assert.equal(writes.length, 0);
});

test("publishImageToTextCacheFromFile rejects an invalid config instead of refreshing the cache", async () => {
  const { deps, writes } = createDeps(async () => JSON.stringify({ enabled: "not-a-boolean" }));

  await assert.rejects(
    publishImageToTextCacheFromFile({ configPath: "/configs/platform/.cohub/image-to-text.json", scope: "platform" }, deps),
    /invalid schema/,
  );
  assert.equal(writes.length, 0);
});
