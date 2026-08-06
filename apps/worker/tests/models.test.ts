import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  createCachedModelsConfig,
  MODELS_CACHE_TTL_SEC,
  parseCachedModelsConfig,
  type ModelsConfig,
} from "@cohub/infra/config-runtime/models";
import { loadConfig } from "../src/models.js";
import { redisCommandClient } from "../src/redis.js";

after(() => redisCommandClient.disconnect());

const models: ModelsConfig = {
  providers: {
    cohub: {
      api: "openai-completions",
      baseUrl: "https://models.example.test/v1",
      models: [{ id: "model-1" }],
    },
  },
};

type CacheWrite = [key: string, value: string, mode: "EX", ttl: number];

function singleWrite(writes: CacheWrite[]): CacheWrite {
  assert.equal(writes.length, 1);
  const write = writes[0];
  assert.ok(write);
  return write;
}

function createDeps(cached: string | null, readFile: () => Promise<string>) {
  const writes: CacheWrite[] = [];
  return {
    writes,
    deps: {
      cache: {
        get: async () => cached,
        set: async (...args: CacheWrite) => {
          writes.push(args);
          return "OK";
        },
      },
      readFile: async () => readFile(),
    },
  };
}

test("loadConfig returns a valid cached catalog without reading the file", async () => {
  let reads = 0;
  const cached = JSON.stringify(createCachedModelsConfig({ content: models }));
  const { deps, writes } = createDeps(cached, async () => {
    reads += 1;
    return JSON.stringify(models);
  });

  assert.deepEqual(await loadConfig("models:key", "/models.json", false, deps), models);
  assert.equal(reads, 0);
  assert.deepEqual(writes, []);
});

test("loadConfig writes a parsed file back using the shared cache envelope and TTL", async () => {
  const rawText = JSON.stringify(models);
  const { deps, writes } = createDeps(null, async () => rawText);

  assert.deepEqual(await loadConfig("models:key", "/models.json", false, deps), models);
  const [key, value, mode, ttl] = singleWrite(writes);
  assert.equal(key, "models:key");
  assert.equal(mode, "EX");
  assert.equal(ttl, MODELS_CACHE_TTL_SEC);
  assert.deepEqual(parseCachedModelsConfig(value)?.content, models);
});

test("loadConfig negatively caches a missing optional user catalog", async () => {
  const { deps, writes } = createDeps(null, async () => {
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  });

  assert.equal(await loadConfig("models:user", "/missing.json", true, deps), null);
  const [key, value, mode, ttl] = singleWrite(writes);
  assert.equal(key, "models:user");
  assert.equal(mode, "EX");
  assert.equal(ttl, MODELS_CACHE_TTL_SEC);
  assert.equal(parseCachedModelsConfig(value)?.content, null);
});
