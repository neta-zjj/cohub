import { randomUUID } from "node:crypto";
import type { SpaceFsChangedPayload } from "@cohub/protocol/fs";
import { REALTIME_OUTBOUND_CHANNEL } from "@cohub/protocol/realtime";
import { redisCommandClient } from "./redis.js";
import { enqueueFsCdnWarmForChanges } from "./space-fs-cdn-prewarm.js";
import { enqueueSpaceHookFromEvent } from "./space-hooks.js";
import { createLogger } from "@cohub/infra/logging";

const logger = createLogger({ serviceName: "cohub-worker" });

export async function publishSpaceEvent(input: {
  type: string;
  spaceId: string;
  sessionId?: string | null;
  payload: Record<string, unknown>;
  id?: string;
  timestamp?: number;
}) {
  const id = input.id ?? randomUUID();
  const timestamp = input.timestamp ?? Date.now();
  await Promise.all([
    redisCommandClient.publish(
      REALTIME_OUTBOUND_CHANNEL,
      JSON.stringify({
        id,
        timestamp,
        domain: "space",
        type: input.type,
        spaceId: input.spaceId,
        sessionId: input.sessionId ?? null,
        payload: input.payload,
      }),
    ),
    enqueueSpaceHookFromEvent({
      id,
      type: input.type,
      timestamp,
      spaceId: input.spaceId,
      sessionId: input.sessionId ?? null,
      payload: input.payload,
    }),
  ]);
}

export async function publishSpaceFsChanged(spaceId: string, payload: SpaceFsChangedPayload) {
  try {
    await Promise.all([
      publishSpaceEvent({
        type: "space.fs.changed",
        spaceId,
        payload: payload as unknown as Record<string, unknown>,
      }),
      enqueueFsCdnWarmForChanges(spaceId, payload.changes).catch((error) => {
        logger.error("[SpaceFS] Failed to enqueue CDN prewarm:", error);
      }),
    ]);
  } catch (error) {
    logger.warn(`[SpaceEvents] Failed to publish space fs changed for ${spaceId}:`, error);
    throw error;
  }
}
