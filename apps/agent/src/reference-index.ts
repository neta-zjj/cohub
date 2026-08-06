import type { ContentBlock } from "@cohub/protocol/core";
import type { sessionMessages } from "@cohub/db";
import { extractTurnReferences } from "@cohub/core/references";
import { logger } from "./logger.js";
import { enqueueReferences } from "./reference-index-queue.js";

type MessageRow = typeof sessionMessages.$inferSelect;

/**
 * Index the references carried by a finalized turn (@mentions, cross-resource
 * tool calls, agent file access) into resource_references.
 *
 * Takes the turn's messages that the caller has already loaded — a turn's
 * message set can be large, so we never re-query it here. Tool calls are
 * aggregated across all assistant messages so intermediate steps are not lost,
 * while the index stays at turn granularity.
 *
 * Fire-and-forget: this is a stats side-effect and must never block or fail the
 * turn lifecycle. The backfill script rebuilds anything missed, so a dropped
 * write is self-healing.
 */
export const indexTurnReferences = (input: {
  spaceId: string;
  sessionId: string;
  turnId: string;
  /** All messages of the turn, already loaded by the caller. */
  messages: readonly MessageRow[];
}): void => {
  const { spaceId, sessionId, turnId, messages } = input;

  const userContent: ContentBlock[] = [];
  const assistantContent: ContentBlock[] = [];
  for (const row of messages) {
    if (!Array.isArray(row.content)) continue;
    const blocks = row.content as ContentBlock[];
    if (row.role === "user") userContent.push(...blocks);
    else if (row.role === "assistant") assistantContent.push(...blocks);
  }

  const references = extractTurnReferences({
    spaceId,
    sessionId,
    turnId,
    userContent,
    assistantContent,
  });
  if (references.length === 0) return;

  try {
    enqueueReferences(references);
  } catch (error) {
    logger.warn("[ReferenceIndex] failed to index turn references", { sessionId, turnId, error });
  }
};
