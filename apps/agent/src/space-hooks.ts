import { maybeEnqueueSpaceHookTask } from "@cohub/infra/space-hooks";
import { COHUB_SYSTEM_QUEUE, createBullmqQueue, defaultCriticalJobOptions } from "@cohub/infra/bullmq";
import { env } from "./env.js";
import { logger } from "./logger.js";

const systemQueue = createBullmqQueue(COHUB_SYSTEM_QUEUE, {
  redisUrl: env.BULLMQ_REDIS_URL,
  telemetryServiceName: "cohub-agent-space-hooks",
});

type RedisLike = {
  get(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<unknown>;
};

export function enqueueSpaceHookFromEvent(
  input: {
    id?: string | null;
    type: string;
    timestamp?: number;
    spaceId?: string | null;
    sessionId?: string | null;
    payload?: Record<string, unknown> | null;
  },
  /** App Redis for empty-hook gate. Passed by caller to avoid circular imports. */
  redis?: RedisLike | null,
) {
  return maybeEnqueueSpaceHookTask({
    event: input,
    redis: redis ?? null,
    enqueue: (name, payload, options) => systemQueue.add(name, payload, {
      ...defaultCriticalJobOptions,
      ...options,
    }),
  }).catch((error) => {
    logger.warn("[SpaceHooks] failed to enqueue space_hook.dispatch", {
      type: input.type,
      spaceId: input.spaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
}
