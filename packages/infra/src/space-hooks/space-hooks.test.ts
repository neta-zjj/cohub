import assert from "node:assert/strict";
import test from "node:test";
import { SPACE_HOOK_DISPATCH_JOB, getSpaceHooksRedisKey } from "@cohub/protocol";
import {
  buildSpaceHookDispatchJobId,
  buildSpaceHookTaskId,
  isReentrantSpaceHookEvent,
  maybeEnqueueSpaceHookTask,
} from "./index.js";

test("buildSpaceHookTaskId is stable for the same event", () => {
  const a = buildSpaceHookTaskId({
    spaceId: "space-1",
    eventId: "event-1",
    eventType: "space.fs.changed",
  });
  const b = buildSpaceHookTaskId({
    spaceId: "space-1",
    eventId: "event-1",
    eventType: "space.fs.changed",
  });
  assert.equal(a, b);
  assert.match(a, /^space-hook-[0-9a-f]{24}$/);
});

test("buildSpaceHookDispatchJobId is stable and distinct from execute id", () => {
  const dispatchId = buildSpaceHookDispatchJobId({
    spaceId: "space-1",
    eventId: "event-1",
    eventType: "space.fs.changed",
  });
  const taskId = buildSpaceHookTaskId({
    spaceId: "space-1",
    eventId: "event-1",
    eventType: "space.fs.changed",
  });
  assert.match(dispatchId, /^space-hook-dispatch-[0-9a-f]{24}$/);
  assert.notEqual(dispatchId, taskId);
});

test("isReentrantSpaceHookEvent blocks hook-generated turns", () => {
  assert.equal(
    isReentrantSpaceHookEvent({
      type: "session.turn.finalized",
      payload: {
        turn: {
          meta: { source: "space_hook", context: { kind: "space_hook" } },
        },
      },
    }),
    true,
  );
  assert.equal(
    isReentrantSpaceHookEvent({
      type: "session.turn.finalized",
      payload: {
        turn: {
          meta: { source: "web_app" },
        },
      },
    }),
    false,
  );
});

test("maybeEnqueueSpaceHookTask skips non-hookable and re-entrant events", async () => {
  const calls: unknown[] = [];
  const enqueue = async (name: string, payload: unknown, options: unknown) => {
    calls.push({ name, payload, options });
    return { id: "job-1" };
  };

  assert.equal(
    await maybeEnqueueSpaceHookTask({
      event: { type: "session.created", spaceId: "space-1" },
      enqueue,
    }),
    null,
  );

  assert.equal(
    await maybeEnqueueSpaceHookTask({
      event: {
        type: "session.turn.finalized",
        spaceId: "space-1",
        payload: { turn: { meta: { source: "space_hook" } } },
      },
      enqueue,
    }),
    null,
  );

  const result = await maybeEnqueueSpaceHookTask({
    event: {
      id: "event-1",
      type: "checkpoint.created",
      spaceId: "space-1",
      sessionId: "session-1",
      payload: { actor: { userId: "user-1" } },
    },
    enqueue,
  });

  assert.ok(result);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    name: SPACE_HOOK_DISPATCH_JOB,
    payload: {
      event: {
        id: "event-1",
        type: "checkpoint.created",
        timestamp: (result as { event: { timestamp: number } }).event.timestamp,
        spaceId: "space-1",
        sessionId: "session-1",
        payload: { actor: { userId: "user-1" } },
      },
      eventActorUserId: "user-1",
    },
    options: {
      jobId: buildSpaceHookDispatchJobId({
        spaceId: "space-1",
        eventId: "event-1",
        eventType: "checkpoint.created",
      }),
    },
  });
});

test("maybeEnqueueSpaceHookTask accepts published Work versions", async () => {
  const calls: unknown[] = [];
  const result = await maybeEnqueueSpaceHookTask({
    event: {
      id: "event-work-3",
      type: "work.version.published",
      spaceId: "space-1",
      payload: {
        work: { id: "work-1" },
        version: { id: "version-3", version: 3 },
        actor: { userId: "user-1" },
      },
    },
    enqueue: async (name, payload, options) => {
      calls.push({ name, payload, options });
      return { id: "job-work-3" };
    },
  });

  assert.ok(result);
  assert.equal(calls.length, 1);
  assert.equal(
    (calls[0] as { payload: { eventActorUserId: string } }).payload.eventActorUserId,
    "user-1",
  );
});

test("maybeEnqueueSpaceHookTask skips when cache confirms empty definitions", async () => {
  const calls: unknown[] = [];
  const redis = {
    store: new Map<string, string>([
      [
        getSpaceHooksRedisKey("space-1"),
        JSON.stringify({
          version: 1,
          spaceId: "space-1",
          updatedAt: new Date().toISOString(),
          definitions: [],
        }),
      ],
    ]),
    async get(key: string) {
      return this.store.get(key) ?? null;
    },
    async del(...keys: string[]) {
      for (const key of keys) this.store.delete(key);
      return keys.length;
    },
  };

  assert.equal(
    await maybeEnqueueSpaceHookTask({
      event: {
        id: "event-1",
        type: "checkpoint.created",
        spaceId: "space-1",
      },
      enqueue: async (name, payload, options) => {
        calls.push({ name, payload, options });
        return { id: "job-1" };
      },
      redis,
    }),
    null,
  );
  assert.equal(calls.length, 0);
});

test("maybeEnqueueSpaceHookTask invalidates empty cache when hooks path changes", async () => {
  const calls: unknown[] = [];
  const redis = {
    store: new Map<string, string>([
      [
        getSpaceHooksRedisKey("space-1"),
        JSON.stringify({
          version: 1,
          spaceId: "space-1",
          updatedAt: new Date().toISOString(),
          definitions: [],
        }),
      ],
    ]),
    async get(key: string) {
      return this.store.get(key) ?? null;
    },
    async del(...keys: string[]) {
      for (const key of keys) this.store.delete(key);
      return keys.length;
    },
  };

  const result = await maybeEnqueueSpaceHookTask({
    event: {
      id: "event-hooks",
      type: "space.fs.changed",
      spaceId: "space-1",
      payload: {
        changes: [{ path: ".cohub/hooks/on-fs.yml", kind: "create" }],
      },
    },
    enqueue: async (name, payload, options) => {
      calls.push({ name, payload, options });
      return { id: "job-1" };
    },
    redis,
  });

  assert.ok(result);
  assert.equal(calls.length, 1);
  assert.equal(redis.store.has(getSpaceHooksRedisKey("space-1")), false);
  assert.equal(
    (calls[0] as { name: string }).name,
    SPACE_HOOK_DISPATCH_JOB,
  );
});

test("maybeEnqueueSpaceHookTask bypasses an empty cache when invalidation fails", async () => {
  const calls: unknown[] = [];
  const cached = JSON.stringify({
    version: 1,
    spaceId: "space-1",
    updatedAt: new Date().toISOString(),
    definitions: [],
  });
  const redis = {
    async get() {
      return cached;
    },
    async del() {
      throw new Error("redis unavailable");
    },
  };

  const result = await maybeEnqueueSpaceHookTask({
    event: {
      id: "event-hooks-failed-invalidation",
      type: "space.fs.changed",
      spaceId: "space-1",
      payload: {
        changes: [{ path: ".cohub/hooks/on-fs.yml", kind: "create" }],
      },
    },
    enqueue: async (name, payload, options) => {
      calls.push({ name, payload, options });
      return { id: "job-1" };
    },
    redis,
  });

  assert.ok(result);
  assert.equal(calls.length, 1);
  assert.equal((calls[0] as { name: string }).name, SPACE_HOOK_DISPATCH_JOB);
});

test("maybeEnqueueSpaceHookTask enqueues on cache miss", async () => {
  const calls: unknown[] = [];
  const redis = {
    async get() {
      return null;
    },
    async del() {
      return 0;
    },
  };

  const result = await maybeEnqueueSpaceHookTask({
    event: {
      id: "event-miss",
      type: "space.workspace.ready",
      spaceId: "space-1",
    },
    enqueue: async (name, payload, options) => {
      calls.push({ name, payload, options });
      return { id: "job-1" };
    },
    redis,
  });

  assert.ok(result);
  assert.equal(calls.length, 1);
  assert.equal((calls[0] as { name: string }).name, SPACE_HOOK_DISPATCH_JOB);
});
