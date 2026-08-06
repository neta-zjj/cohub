import { maybeEnqueueSpaceHookTask } from "@cohub/infra/space-hooks";
import { COHUB_SYSTEM_QUEUE, createBullmqQueue, defaultCriticalJobOptions } from "@cohub/infra/bullmq";
import { createLogger } from "@cohub/infra/logging";
import { config } from "./config.js";
import { redisCommandClient } from "./redis.js";

const logger = createLogger({ serviceName: "cohub-worker" });

const systemQueue = createBullmqQueue(COHUB_SYSTEM_QUEUE, {
  redisUrl: config.bullmqRedisUrl,
  telemetryServiceName: "cohub-worker-space-hooks",
});

export function enqueueSpaceHookFromEvent(input: {
  id?: string | null;
  type: string;
  timestamp?: number;
  spaceId?: string | null;
  sessionId?: string | null;
  payload?: Record<string, unknown> | null;
}) {
  return maybeEnqueueSpaceHookTask({
    event: input,
    redis: redisCommandClient,
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
