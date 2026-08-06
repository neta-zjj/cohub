import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  boardClips,
  boardEffects,
  boardNodes,
  boardSequences,
  boards,
} from "@cohub/db";
import {
  BOARD_PROTOCOL_VERSION,
  BOARD_SNAPSHOT_KIND,
  type BoardAssetRef,
  type BoardClip,
  type BoardEffect,
  type BoardSequence,
  type BoardSnapshot,
  type BoardTarget,
} from "@cohub/protocol";
import { db } from "../db.js";

function dateString(value: Date | null | undefined): string | null {
  return value?.toISOString() ?? null;
}

function effectFromRow(row: typeof boardEffects.$inferSelect): BoardEffect {
  return {
    id: row.id,
    boardId: row.boardId,
    target: row.targetType === "node" && row.targetId
      ? { type: "node", nodeId: row.targetId }
      : { type: "board" },
    kind: row.kind,
    kindVersion: row.kindVersion,
    enabled: row.enabled,
    lifecycle: row.lifecycle as BoardEffect["lifecycle"],
    timeOrigin: row.timeOrigin as BoardEffect["timeOrigin"],
    layer: row.layer as BoardEffect["layer"],
    seed: row.seed,
    params: row.params,
    assetRefs: row.assetRefs as BoardAssetRef[],
    metadata: row.metadata,
    revision: row.revision,
  };
}

function sequenceFromRow(row: typeof boardSequences.$inferSelect): BoardSequence {
  return {
    id: row.id,
    boardId: row.boardId,
    name: row.name,
    duration: row.duration,
    seed: row.seed,
    restPose: row.restPose,
    metadata: row.metadata,
    revision: row.revision,
  };
}

function clipFromRow(row: typeof boardClips.$inferSelect): BoardClip {
  return {
    id: row.id,
    sequenceId: row.sequenceId,
    kind: row.kind,
    kindVersion: row.kindVersion,
    target: row.target as BoardTarget,
    start: row.start,
    duration: row.duration,
    layer: row.layer as BoardClip["layer"],
    fill: row.fill as BoardClip["fill"],
    easing: row.easing,
    params: row.params,
    keyframes: row.keyframes as BoardClip["keyframes"],
    assetRefs: row.assetRefs as BoardAssetRef[],
    seed: row.seed,
    metadata: row.metadata,
  };
}

/** Capture immutable semantic Board state without coupling it to a storage lifecycle. */
export async function captureBoardSnapshots(input: {
  spaceId: string;
  boardIds?: string[];
}): Promise<BoardSnapshot[]> {
  return db.transaction(async (tx) => {
    if (input.boardIds?.length === 0) return [];
    const boardWhere = input.boardIds
      ? and(eq(boards.spaceId, input.spaceId), inArray(boards.id, input.boardIds))
      : eq(boards.spaceId, input.spaceId);
    const sourceBoards = await tx.select().from(boards).where(boardWhere).orderBy(boards.id);
    const capturedAt = new Date().toISOString();
    const snapshots: BoardSnapshot[] = [];

    for (const board of sourceBoards) {
      const [nodes, effects, sequences, clips] = await Promise.all([
        tx.select().from(boardNodes)
          .where(and(eq(boardNodes.boardId, board.id), isNull(boardNodes.deletedAt)))
          .orderBy(boardNodes.orderKey),
        tx.select().from(boardEffects).where(eq(boardEffects.boardId, board.id)),
        tx.select().from(boardSequences).where(eq(boardSequences.boardId, board.id)),
        tx.select().from(boardClips)
          .where(eq(boardClips.boardId, board.id))
          .orderBy(boardClips.sequenceId, boardClips.start),
      ]);
      snapshots.push({
        kind: BOARD_SNAPSHOT_KIND,
        version: BOARD_PROTOCOL_VERSION,
        capturedAt,
        board: {
          id: board.id,
          spaceId: board.spaceId,
          title: board.title,
          version: board.version,
          metadata: board.metadata,
          createdAt: dateString(board.createdAt),
          updatedAt: dateString(board.updatedAt),
        },
        nodes: nodes.map(({ deletedAt: _deletedAt, ...node }) => ({
          ...node,
          createdAt: dateString(node.createdAt),
          updatedAt: dateString(node.updatedAt),
        })),
        effects: effects.map(effectFromRow),
        sequences: sequences.map(sequenceFromRow),
        clips: clips.map(clipFromRow),
        // Shared playback position is transient; persisted playback policy lives in board.metadata.
        playback: null,
      });
    }
    return snapshots;
  }, { isolationLevel: "repeatable read" });
}
