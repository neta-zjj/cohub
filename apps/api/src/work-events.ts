import { randomUUID } from "node:crypto";
import type {
  RealtimeWorkRecord,
  RealtimeWorkVersionRecord,
} from "@cohub/protocol/realtime";
import type { RequestSource } from "@cohub/protocol/provenance";
import { dispatchSpaceDomainEvent } from "./space-events.js";

export async function dispatchWorkVersionPublished(input: {
  work: RealtimeWorkRecord;
  version: RealtimeWorkVersionRecord;
  previousVersionId: string | null;
  actorUserId: string;
  source: RequestSource | null;
}) {
  await dispatchSpaceDomainEvent({
    id: randomUUID(),
    timestamp: Date.now(),
    domain: "space",
    type: "work.version.published",
    spaceId: input.work.spaceId,
    sessionId: null,
    payload: {
      work: input.work,
      version: input.version,
      previousVersionId: input.previousVersionId,
      actor: { userId: input.actorUserId },
      source: input.source,
    },
  });
}
