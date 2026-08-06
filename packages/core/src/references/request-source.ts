import {
  hasRequestSourceIdentity,
  isRequestSourceUuid,
  normalizeRequestSource,
  type RequestSource,
} from "@cohub/protocol/provenance";
import type { ReferenceInput } from "./types.js";

/** Optional HTTP route context stamped onto a cross-space request edge. */
export type CrossSpaceRouteMeta = {
  method?: string;
  path?: string;
  pattern?: string;
};

/**
 * Build a reference edge when a request against `targetSpaceId` carries
 * X-Cohub-Source-* identity for a *different* space.
 *
 * Requires `turnId` (sandbox injects `COHUB_TURN_ID`) so edges anchor to a real
 * agent turn and bare forged space headers are ignored.
 *
 * `countMode: increment` so each successful cross-space hit in the same turn
 * raises count (multiple `cohub -s` calls accumulate).
 */
export const crossSpaceRequestReference = (input: {
  requestSource: RequestSource | null | undefined;
  targetSpaceId: string;
  route?: CrossSpaceRouteMeta | null;
}): ReferenceInput | null => {
  if (!isRequestSourceUuid(input.targetSpaceId)) return null;

  const source = normalizeRequestSource(input.requestSource);
  if (!source || !hasRequestSourceIdentity(source) || !source.spaceId) return null;
  if (source.spaceId === input.targetSpaceId) return null;
  if (!source.turnId) return null;

  const method = asNonEmpty(input.route?.method)?.toUpperCase();
  const path = asNonEmpty(input.route?.path);
  const pattern = asNonEmpty(input.route?.pattern);

  return {
    kind: "tool_call",
    sourceType: "turn",
    sourceId: source.turnId,
    targetType: "space",
    targetId: input.targetSpaceId,
    sourceSpaceId: source.spaceId,
    sourceSessionId: source.sessionId ?? null,
    count: 1,
    countMode: "increment",
    meta: {
      via: source.via ?? "cli",
      ...(source.toolCallId ? { toolCallId: source.toolCallId } : {}),
      ...(method ? { method } : {}),
      ...(path ? { path } : {}),
      ...(pattern ? { pattern } : {}),
    },
  };
};

const asNonEmpty = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};
