import { and, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import {
  boardClips,
  boardEffects,
  boardNodes,
  boardOperations,
  boardPlaybackStates,
  boardSequences,
  boardTransactions,
  boards,
} from "@cohub/db";
import type {
  BoardAssetRef,
  BoardBootstrap,
  BoardCapabilities,
  BoardClip,
  BoardEffect,
  BoardInspectInput,
  BoardOperation,
  BoardPlaybackCommand,
  BoardPlaybackSnapshot,
  BoardSequence,
  BoardTarget,
  BoardValidationResult,
  RequestSource,
} from "@cohub/protocol";
import {
  BOARD_BUILTIN_CAPABILITIES,
  DEFAULT_BOARD_RENDER_LIMITS,
} from "@cohub/protocol";
import {
  collectTouchedNodeIds,
  type ExistingNodeRow,
  planNodeWrites,
} from "./board-node-plan.js";
import { db } from "./db/index.js";
import { dispatchBoardPlaybackChanged, dispatchBoardTransactionApplied } from "./board-events.js";
import {
  BoardServiceError,
  contextualValidation,
  normalizeBoardTransaction,
  normalizePlaybackPosition,
  NODE_WRITE_CHUNK,
  type BoardValidationContext,
  ZERO_BOARD_COST,
} from "./board-ops.js";

export * from "./board-ops.js";

const BOARD_CAPABILITIES: BoardCapabilities = {
  protocolVersion: 1,
  capabilities: BOARD_BUILTIN_CAPABILITIES,
  limits: DEFAULT_BOARD_RENDER_LIMITS,
};

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

function playbackFromRow(row: typeof boardPlaybackStates.$inferSelect): BoardPlaybackSnapshot {
  return {
    boardId: row.boardId,
    playbackId: row.playbackId,
    sequenceId: row.sequenceId,
    sequenceRevision: row.sequenceRevision,
    playbackRevision: row.playbackRevision,
    status: row.status as BoardPlaybackSnapshot["status"],
    position: row.position,
    effectiveAt: row.effectiveAt.getTime(),
    timeScale: row.timeScale,
    seed: row.seed,
  };
}

export async function inspectBoard(
  spaceId: string,
  boardId: string,
  input: BoardInspectInput = {},
): Promise<BoardBootstrap> {
  const [board] = await db.select().from(boards).where(and(eq(boards.id, boardId), eq(boards.spaceId, spaceId))).limit(1);
  if (!board) throw new BoardServiceError(404, "board not found", "BOARD_NOT_FOUND");
  const included = input.include ? new Set(input.include) : null;
  const wants = (section: NonNullable<BoardInspectInput["include"]>[number]) => !included || included.has(section);
  const viewport = input.viewport;
  const nodeWhere = viewport
    ? and(
        eq(boardNodes.boardId, boardId),
        isNull(boardNodes.deletedAt),
        lt(boardNodes.x, viewport.x + viewport.width),
        gt(sql<number>`${boardNodes.x} + ${boardNodes.width}`, viewport.x),
        lt(boardNodes.y, viewport.y + viewport.height),
        gt(sql<number>`${boardNodes.y} + ${boardNodes.height}`, viewport.y),
      )
    : and(eq(boardNodes.boardId, boardId), isNull(boardNodes.deletedAt));
  const [nodes, effects, sequences, clips, playback] = await Promise.all([
    wants("nodes") ? db.select().from(boardNodes).where(nodeWhere).orderBy(boardNodes.orderKey) : Promise.resolve([]),
    wants("effects") ? db.select().from(boardEffects).where(eq(boardEffects.boardId, boardId)) : Promise.resolve([]),
    wants("sequences") ? db.select().from(boardSequences).where(eq(boardSequences.boardId, boardId)) : Promise.resolve([]),
    wants("clips") ? db.select().from(boardClips).where(eq(boardClips.boardId, boardId)).orderBy(boardClips.sequenceId, boardClips.start) : Promise.resolve([]),
    wants("playback") ? db.select().from(boardPlaybackStates).where(eq(boardPlaybackStates.boardId, boardId)).limit(1) : Promise.resolve([]),
  ]);
  return {
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
    playback: playback[0] ? playbackFromRow(playback[0]) : null,
  };
}

export async function getBoardCapabilities(spaceId: string, boardId: string): Promise<BoardCapabilities> {
  const [board] = await db.select({ id: boards.id }).from(boards).where(and(eq(boards.id, boardId), eq(boards.spaceId, spaceId))).limit(1);
  if (!board) throw new BoardServiceError(404, "board not found", "BOARD_NOT_FOUND");
  return BOARD_CAPABILITIES;
}

function createValidationContext(input: {
  boardVersion: number;
  metadata: Record<string, unknown>;
  nodes: Array<{ nodeId: string }>;
  effects: Array<typeof boardEffects.$inferSelect>;
  sequences: Array<typeof boardSequences.$inferSelect>;
  clips: Array<typeof boardClips.$inferSelect>;
}): BoardValidationContext {
  const clipsBySequence = new Map<string, BoardClip[]>();
  for (const clip of input.clips) {
    const list = clipsBySequence.get(clip.sequenceId) ?? [];
    list.push(clipFromRow(clip));
    clipsBySequence.set(clip.sequenceId, list);
  }
  return {
    boardVersion: input.boardVersion,
    metadata: input.metadata,
    nodeIds: input.nodes.map((node) => node.nodeId),
    effects: input.effects.map(effectFromRow),
    sequences: input.sequences.map((sequence) => ({
      id: sequence.id,
      clips: clipsBySequence.get(sequence.id) ?? [],
    })),
  };
}

export async function validateBoardTransaction(input: {
  spaceId: string;
  value: unknown;
}): Promise<BoardValidationResult> {
  const transaction = normalizeBoardTransaction(input.value);
  const [board] = await db.select({ id: boards.id, version: boards.version, metadata: boards.metadata }).from(boards)
    .where(and(eq(boards.id, transaction.boardId), eq(boards.spaceId, input.spaceId))).limit(1);
  if (!board) throw new BoardServiceError(404, "board not found", "BOARD_NOT_FOUND");
  const [nodes, effects, sequences, clips] = await Promise.all([
    db.select({ nodeId: boardNodes.nodeId }).from(boardNodes).where(and(eq(boardNodes.boardId, board.id), isNull(boardNodes.deletedAt))),
    db.select().from(boardEffects).where(eq(boardEffects.boardId, board.id)),
    db.select().from(boardSequences).where(eq(boardSequences.boardId, board.id)),
    db.select().from(boardClips).where(eq(boardClips.boardId, board.id)),
  ]);
  return contextualValidation(transaction, createValidationContext({
    boardVersion: board.version,
    metadata: board.metadata,
    nodes,
    effects,
    sequences,
    clips,
  }));
}

function effectValues(boardId: string, effect: BoardOperation & { type: "effect.upsert" }, revision: number, now: Date) {
  const value = effect.payload.effect;
  return {
    id: value.id,
    boardId,
    targetType: value.target.type,
    targetId: value.target.type === "node" ? value.target.nodeId : null,
    kind: value.kind,
    kindVersion: value.kindVersion,
    enabled: value.enabled,
    lifecycle: value.lifecycle,
    timeOrigin: value.timeOrigin,
    layer: value.layer,
    seed: value.seed,
    params: value.params,
    assetRefs: value.assetRefs,
    metadata: value.metadata,
    revision,
    updatedAt: now,
  };
}

function clipValues(boardId: string, sequenceId: string, clip: BoardClip) {
  return {
    id: clip.id,
    boardId,
    sequenceId,
    kind: clip.kind,
    kindVersion: clip.kindVersion,
    target: clip.target,
    start: clip.start,
    duration: clip.duration,
    layer: clip.layer,
    fill: clip.fill,
    easing: clip.easing,
    params: clip.params,
    keyframes: clip.keyframes,
    assetRefs: clip.assetRefs,
    seed: clip.seed,
    metadata: clip.metadata,
  };
}

export async function applyBoardTransaction(input: {
  spaceId: string;
  actorId: string;
  transaction: unknown;
  requestSource?: RequestSource | null;
  broadcast?: boolean;
}): Promise<BoardBootstrap> {
  const transaction = normalizeBoardTransaction(input.transaction);
  const transactionMetadata: Record<string, unknown> = input.requestSource
    ? { source: input.requestSource }
    : {};
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [board] = await tx.select().from(boards)
      .where(and(eq(boards.id, transaction.boardId), eq(boards.spaceId, input.spaceId))).for("update").limit(1);
    if (!board) throw new BoardServiceError(404, "board not found", "BOARD_NOT_FOUND");

    const [existing] = await tx.select({ resultVersion: boardTransactions.resultVersion })
      .from(boardTransactions)
      .where(and(eq(boardTransactions.boardId, transaction.boardId), eq(boardTransactions.txId, transaction.txId))).limit(1);
    if (existing) return { idempotent: true, version: existing.resultVersion, playback: null };

    const [validationNodes, validationEffects, validationSequences, validationClips] = await Promise.all([
      tx.select({ nodeId: boardNodes.nodeId }).from(boardNodes).where(and(eq(boardNodes.boardId, board.id), isNull(boardNodes.deletedAt))),
      tx.select().from(boardEffects).where(eq(boardEffects.boardId, board.id)),
      tx.select().from(boardSequences).where(eq(boardSequences.boardId, board.id)),
      tx.select().from(boardClips).where(eq(boardClips.boardId, board.id)),
    ]);
    const validation = contextualValidation(transaction, createValidationContext({
      boardVersion: board.version,
      metadata: board.metadata,
      nodes: validationNodes,
      effects: validationEffects,
      sequences: validationSequences,
      clips: validationClips,
    }));
    const validationError = validation.diagnostics.find((diagnostic) => diagnostic.severity === "error");
    if (validationError) {
      const conflict = validationError.code === "VERSION_CONFLICT" || validationError.code.endsWith("_EXISTS") || validationError.code.endsWith("_REFERENCED");
      const status = conflict ? 409 : validationError.code.endsWith("_NOT_FOUND") ? 404 : 400;
      throw new BoardServiceError(status, validationError.message, validationError.code);
    }

    const nextVersion = board.version + 1;
    const operationRows: Array<{ type: string; payload: Record<string, unknown>; inverse: Record<string, unknown> | null }> = [];
    let title = board.title;
    let metadata = board.metadata;
    let playback: BoardPlaybackSnapshot | null = null;

    // Node writes are planned in memory and flushed in bulk below, so their cost is
    // a fixed number of round-trips rather than a few queries per operation - which
    // is what let a large selection edit hold the board's row lock for as long as it
    // had nodes. Effect/sequence/playback operations stay inline: they are few by
    // nature and each carries its own bespoke cascade.
    const touchedNodeIds = collectTouchedNodeIds(transaction.operations);
    const nodeRows = touchedNodeIds.length
      ? await tx.select().from(boardNodes)
        .where(and(eq(boardNodes.boardId, transaction.boardId), inArray(boardNodes.nodeId, touchedNodeIds)))
      : [];
    const existingNodes = new Map<string, ExistingNodeRow>();
    for (const row of nodeRows) {
      const { boardId: _boardId, version: _version, createdAt: _createdAt, updatedAt: _updatedAt, deletedAt, ...fields } = row;
      existingNodes.set(row.nodeId, { ...fields, deleted: deletedAt !== null });
    }
    const nodePlan = planNodeWrites(transaction.operations, { existing: existingNodes });

    for (const [opIndex, operation] of transaction.operations.entries()) {
      // Planned above; splice its journal entry back into the operation order.
      const plannedEntry = nodePlan.journal.get(opIndex);
      if (plannedEntry) {
        operationRows.push(plannedEntry);
        continue;
      }
      if (operation.type === "board.patch") {
        operationRows.push({ type: operation.type, payload: operation.payload, inverse: { patch: { title, metadata } } });
        title = operation.payload.patch.title ?? title;
        metadata = operation.payload.patch.metadata ?? metadata;
        continue;
      }
      if (operation.type === "effect.upsert") {
        const [previous] = await tx.select().from(boardEffects)
          .where(and(eq(boardEffects.boardId, transaction.boardId), eq(boardEffects.id, operation.payload.effect.id))).limit(1);
        const values = effectValues(transaction.boardId, operation, (previous?.revision ?? -1) + 1, now);
        await tx.insert(boardEffects).values({ ...values, createdAt: previous?.createdAt ?? now })
          .onConflictDoUpdate({ target: [boardEffects.boardId, boardEffects.id], set: values });
        operationRows.push({
          type: operation.type,
          payload: operation.payload,
          inverse: previous
            ? { type: "effect.upsert", payload: { effect: effectFromRow(previous) } }
            : { type: "effect.delete", payload: { effectId: operation.payload.effect.id } },
        });
        continue;
      }
      if (operation.type === "effect.delete") {
        const clips = await tx.select({ id: boardClips.id, target: boardClips.target }).from(boardClips).where(eq(boardClips.boardId, transaction.boardId));
        if (clips.some((clip) => (clip.target as BoardTarget).type === "effect" && (clip.target as { type: "effect"; effectId: string }).effectId === operation.payload.effectId)) {
          throw new BoardServiceError(409, "effect is referenced by a sequence", "EFFECT_REFERENCED");
        }
        const [deleted] = await tx.delete(boardEffects).where(and(eq(boardEffects.boardId, transaction.boardId), eq(boardEffects.id, operation.payload.effectId))).returning();
        if (!deleted) throw new BoardServiceError(404, "board effect not found", "EFFECT_NOT_FOUND");
        operationRows.push({ type: operation.type, payload: operation.payload, inverse: { type: "effect.upsert", payload: { effect: effectFromRow(deleted) } } });
        continue;
      }
      if (operation.type === "sequence.upsert") {
        const value = operation.payload.sequence;
        const [previous] = await tx.select().from(boardSequences)
          .where(and(eq(boardSequences.boardId, transaction.boardId), eq(boardSequences.id, value.id))).limit(1);
        const previousClips = previous
          ? await tx.select().from(boardClips).where(and(eq(boardClips.boardId, transaction.boardId), eq(boardClips.sequenceId, value.id)))
          : [];
        const revision = (previous?.revision ?? -1) + 1;
        const sequenceValues = { ...value, boardId: transaction.boardId, revision, updatedAt: now };
        await tx.insert(boardSequences).values({ ...sequenceValues, createdAt: previous?.createdAt ?? now })
          .onConflictDoUpdate({ target: [boardSequences.boardId, boardSequences.id], set: sequenceValues });
        await tx.delete(boardClips).where(and(eq(boardClips.boardId, transaction.boardId), eq(boardClips.sequenceId, value.id)));
        if (operation.payload.clips.length) {
          await tx.insert(boardClips).values(operation.payload.clips.map((clip) => clipValues(transaction.boardId, value.id, { ...clip, sequenceId: value.id })));
        }
        const [activePlayback] = await tx.select().from(boardPlaybackStates).where(and(
          eq(boardPlaybackStates.boardId, transaction.boardId),
          eq(boardPlaybackStates.sequenceId, value.id),
        )).limit(1);
        if (activePlayback) {
          const [stopped] = await tx.update(boardPlaybackStates).set({
            sequenceRevision: revision,
            playbackRevision: activePlayback.playbackRevision + 1,
            status: "stopped",
            position: currentPosition(activePlayback, now, value.duration),
            effectiveAt: now,
            seed: value.seed,
            commandId: `sequence-update:${transaction.txId}`,
            updatedAt: now,
          }).where(eq(boardPlaybackStates.boardId, transaction.boardId)).returning();
          if (!stopped) throw new BoardServiceError(500, "failed to stop stale playback");
          playback = playbackFromRow(stopped);
        }
        operationRows.push({
          type: operation.type,
          payload: operation.payload,
          inverse: previous
            ? { type: "sequence.upsert", payload: { sequence: sequenceFromRow(previous), clips: previousClips.map(clipFromRow) } }
            : { type: "sequence.delete", payload: { sequenceId: value.id } },
        });
        continue;
      }
      // Only sequence.delete remains: node operations were planned above, and the
      // rest are handled by the branches before this point.
      if (operation.type !== "sequence.delete") continue;
      const [previous] = await tx.select().from(boardSequences)
        .where(and(eq(boardSequences.boardId, transaction.boardId), eq(boardSequences.id, operation.payload.sequenceId))).limit(1);
      if (!previous) throw new BoardServiceError(404, "board sequence not found", "SEQUENCE_NOT_FOUND");
      const previousClips = await tx.select().from(boardClips)
        .where(and(eq(boardClips.boardId, transaction.boardId), eq(boardClips.sequenceId, operation.payload.sequenceId)));
      await tx.delete(boardPlaybackStates).where(and(eq(boardPlaybackStates.boardId, transaction.boardId), eq(boardPlaybackStates.sequenceId, operation.payload.sequenceId)));
      if (playback?.sequenceId === operation.payload.sequenceId) playback = null;
      await tx.delete(boardClips).where(and(eq(boardClips.boardId, transaction.boardId), eq(boardClips.sequenceId, operation.payload.sequenceId)));
      await tx.delete(boardSequences).where(and(eq(boardSequences.boardId, transaction.boardId), eq(boardSequences.id, operation.payload.sequenceId)));
      operationRows.push({ type: operation.type, payload: operation.payload, inverse: { type: "sequence.upsert", payload: { sequence: sequenceFromRow(previous), clips: previousClips.map(clipFromRow) } } });
    }

    // Flush the planned node writes. Every touched node is written as its final
    // state via one upsert, so a create, a patch, a revive of a soft-deleted row
    // and a soft delete all collapse into the same statement. Chunked because
    // Postgres caps bind parameters per statement.
    if (nodePlan.writes.length) {
      for (let offset = 0; offset < nodePlan.writes.length; offset += NODE_WRITE_CHUNK) {
        const chunk = nodePlan.writes.slice(offset, offset + NODE_WRITE_CHUNK);
        await tx.insert(boardNodes)
          .values(chunk.map((write) => ({
            ...write.fields,
            boardId: transaction.boardId,
            version: nextVersion,
            createdAt: now,
            updatedAt: now,
            deletedAt: write.deleted ? now : null,
          })))
          .onConflictDoUpdate({
            target: [boardNodes.boardId, boardNodes.nodeId],
            // createdAt is deliberately absent: an existing row keeps its original.
            set: {
              type: sql`excluded.type`,
              parentId: sql`excluded.parent_id`,
              orderKey: sql`excluded.order_key`,
              x: sql`excluded.x`,
              y: sql`excluded.y`,
              width: sql`excluded.width`,
              height: sql`excluded.height`,
              rotation: sql`excluded.rotation`,
              refKind: sql`excluded.ref_kind`,
              refPath: sql`excluded.ref_path`,
              refUrl: sql`excluded.ref_url`,
              view: sql`excluded.view`,
              style: sql`excluded.style`,
              data: sql`excluded.data`,
              version: sql`excluded.version`,
              updatedAt: sql`excluded.updated_at`,
              deletedAt: sql`excluded.deleted_at`,
            },
          });
      }
    }

    const [storedTransaction] = await tx.insert(boardTransactions).values({
      boardId: transaction.boardId,
      txId: transaction.txId,
      baseVersion: transaction.baseVersion,
      resultVersion: nextVersion,
      actorId: input.actorId,
      clientId: transaction.clientId ?? null,
      undoGroupId: transaction.undoGroupId ?? null,
      operations: transaction.operations,
      metadata: transactionMetadata,
      createdAt: now,
    }).returning({ id: boardTransactions.id });
    if (!storedTransaction) throw new BoardServiceError(500, "failed to store board transaction");
    await tx.insert(boardOperations).values(operationRows.map((operation, index) => ({
      boardId: transaction.boardId,
      transactionId: storedTransaction.id,
      operationIndex: index,
      type: operation.type,
      payload: operation.payload,
      inverse: operation.inverse,
      createdAt: now,
    })));
    await tx.update(boards).set({ title, metadata, version: nextVersion, updatedAt: now }).where(eq(boards.id, transaction.boardId));
    return { idempotent: false, version: nextVersion, playback };
  });

  if (input.broadcast !== false && !result.idempotent) {
    await dispatchBoardTransactionApplied({
      spaceId: input.spaceId,
      boardId: transaction.boardId,
      actorId: input.actorId,
      txId: transaction.txId,
      version: result.version,
      operations: transaction.operations,
      metadata: transactionMetadata,
    }).catch(() => undefined);
    if (result.playback) {
      await dispatchBoardPlaybackChanged({
        spaceId: input.spaceId,
        snapshot: result.playback,
      }).catch(() => undefined);
    }
  }
  return inspectBoard(input.spaceId, transaction.boardId);
}

function currentPosition(
  row: typeof boardPlaybackStates.$inferSelect,
  now: Date,
  duration: number,
): number {
  const position = row.status === "playing"
    ? row.position + Math.max(0, now.getTime() - row.effectiveAt.getTime()) * row.timeScale
    : row.position;
  return normalizePlaybackPosition(position, duration);
}

export async function applyBoardPlaybackCommand(input: {
  spaceId: string;
  boardId: string;
  command: BoardPlaybackCommand;
}): Promise<BoardPlaybackSnapshot> {
  if (input.command.type === "play" && input.command.shared === false) {
    throw new BoardServiceError(400, "local playback must be handled by a Board runtime", "LOCAL_PLAYBACK_REQUIRES_RUNTIME");
  }
  const now = new Date();
  const snapshot = await db.transaction(async (tx) => {
    const [board] = await tx.select({ id: boards.id }).from(boards)
      .where(and(eq(boards.id, input.boardId), eq(boards.spaceId, input.spaceId))).for("update").limit(1);
    if (!board) throw new BoardServiceError(404, "board not found", "BOARD_NOT_FOUND");
    const [existing] = await tx.select().from(boardPlaybackStates).where(eq(boardPlaybackStates.boardId, input.boardId)).limit(1);
    if (existing?.commandId === input.command.commandId) return playbackFromRow(existing);

    if (input.command.type === "play") {
      const [sequence] = await tx.select().from(boardSequences).where(and(
        eq(boardSequences.boardId, input.boardId),
        eq(boardSequences.id, input.command.sequenceId),
      )).limit(1);
      if (!sequence) throw new BoardServiceError(404, "board sequence not found", "SEQUENCE_NOT_FOUND");
      const position = normalizePlaybackPosition(input.command.position ?? 0, sequence.duration);
      const timeScale = input.command.timeScale ?? 1;
      const values = {
        boardId: input.boardId,
        playbackId: crypto.randomUUID(),
        sequenceId: sequence.id,
        sequenceRevision: sequence.revision,
        playbackRevision: (existing?.playbackRevision ?? 0) + 1,
        status: "playing",
        position,
        effectiveAt: now,
        timeScale,
        seed: input.command.seed ?? sequence.seed,
        commandId: input.command.commandId,
        updatedAt: now,
      };
      const [row] = await tx.insert(boardPlaybackStates).values(values)
        .onConflictDoUpdate({ target: boardPlaybackStates.boardId, set: values }).returning();
      if (!row) throw new BoardServiceError(500, "failed to store playback state");
      return playbackFromRow(row);
    }

    if (!existing || existing.playbackId !== input.command.playbackId) {
      throw new BoardServiceError(409, "playback is no longer current", "PLAYBACK_CONFLICT");
    }
    const [sequence] = await tx.select({ duration: boardSequences.duration }).from(boardSequences).where(and(
      eq(boardSequences.boardId, input.boardId),
      eq(boardSequences.id, existing.sequenceId),
    )).limit(1);
    if (!sequence) throw new BoardServiceError(404, "board sequence not found", "SEQUENCE_NOT_FOUND");
    const position = normalizePlaybackPosition(
      input.command.type === "seek"
        ? input.command.position
        : currentPosition(existing, now, sequence.duration),
      sequence.duration,
    );
    const status = input.command.type === "pause" ? "paused" : input.command.type === "stop" ? "stopped" : existing.status;
    const [row] = await tx.update(boardPlaybackStates).set({
      status,
      position,
      effectiveAt: now,
      playbackRevision: existing.playbackRevision + 1,
      commandId: input.command.commandId,
      updatedAt: now,
    }).where(eq(boardPlaybackStates.boardId, input.boardId)).returning();
    if (!row) throw new BoardServiceError(500, "failed to update playback state");
    return playbackFromRow(row);
  });
  await dispatchBoardPlaybackChanged({ spaceId: input.spaceId, snapshot }).catch(() => undefined);
  return snapshot;
}

export function emptyBoardValidation(): BoardValidationResult {
  return { valid: true, diagnostics: [], peakCost: { ...ZERO_BOARD_COST } };
}
