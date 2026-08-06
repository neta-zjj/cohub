import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import {
  boardCheckpoints,
  boardClips,
  boardEffects,
  boardNodes,
  boardSequences,
  boards,
} from "@cohub/db";
import {
  isBoardPath,
  parseBoardManifest,
  serializeBoardManifest,
} from "@cohub/protocol";
import { db } from "../db.js";
import { captureBoardSnapshots } from "./board-snapshot.js";

async function listBoardFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await listBoardFiles(root, path));
    else if (entry.isFile() && isBoardPath(entry.name)) paths.push(path);
  }
  return paths;
}

export async function saveBoardCheckpointSnapshots(input: { checkpointId: string; spaceId: string }) {
  const snapshots = await captureBoardSnapshots({ spaceId: input.spaceId });
  if (snapshots.length > 0) {
    await db.insert(boardCheckpoints).values(snapshots.map((snapshot) => ({
      checkpointId: input.checkpointId,
      sourceBoardId: snapshot.board.id,
      sourceSpaceId: input.spaceId,
      sourceVersion: snapshot.board.version,
      snapshot: snapshot as unknown as Record<string, unknown>,
    })));
  }
  return { count: snapshots.length };
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : [];
}

export async function restoreBoardCheckpointSnapshots(input: {
  checkpointId: string;
  targetSpaceId: string;
  workspaceDir: string;
}) {
  const snapshots = await db.select().from(boardCheckpoints).where(eq(boardCheckpoints.checkpointId, input.checkpointId));
  const snapshotBySourceId = new Map(snapshots.map((snapshot) => [snapshot.sourceBoardId, snapshot]));
  const files = await listBoardFiles(resolve(input.workspaceDir));
  const restored: Array<{ path: string; boardId: string }> = [];

  for (const absolutePath of files) {
    let manifest: ReturnType<typeof parseBoardManifest>;
    try {
      manifest = parseBoardManifest(await readFile(absolutePath, "utf8"));
    } catch {
      continue;
    }
    const source = snapshotBySourceId.get(manifest.boardId);
    if (!source) continue;
    const snapshot = source.snapshot;
    const sourceBoard = snapshot.board && typeof snapshot.board === "object" && !Array.isArray(snapshot.board)
      ? snapshot.board as Record<string, unknown>
      : {};
    const boardId = crypto.randomUUID();
    const now = new Date();
    try {
      await db.transaction(async (tx) => {
        await tx.insert(boards).values({
          id: boardId,
          spaceId: input.targetSpaceId,
          title: typeof sourceBoard.title === "string" ? sourceBoard.title : manifest.title,
          version: source.sourceVersion,
          metadata: {
            ...(sourceBoard.metadata && typeof sourceBoard.metadata === "object" ? sourceBoard.metadata as Record<string, unknown> : {}),
            restoredFrom: {
              checkpointId: input.checkpointId,
              sourceBoardId: source.sourceBoardId,
              sourceVersion: source.sourceVersion,
            },
          },
          createdAt: now,
          updatedAt: now,
        });

        const nodes = records(snapshot.nodes);
        if (nodes.length) await tx.insert(boardNodes).values(nodes.map((node, index) => ({
          boardId,
          nodeId: String(node.nodeId),
          type: String(node.type ?? "unknown"),
          parentId: typeof node.parentId === "string" ? node.parentId : null,
          orderKey: typeof node.orderKey === "string" ? node.orderKey : String(index).padStart(8, "0"),
          x: typeof node.x === "number" ? node.x : 0,
          y: typeof node.y === "number" ? node.y : 0,
          width: typeof node.width === "number" ? node.width : 240,
          height: typeof node.height === "number" ? node.height : 160,
          rotation: typeof node.rotation === "number" ? node.rotation : 0,
          refKind: typeof node.refKind === "string" ? node.refKind : null,
          refPath: typeof node.refPath === "string" ? node.refPath : null,
          refUrl: typeof node.refUrl === "string" ? node.refUrl : null,
          view: node.view && typeof node.view === "object" ? node.view as Record<string, unknown> : {},
          style: node.style && typeof node.style === "object" ? node.style as Record<string, unknown> : {},
          data: node.data && typeof node.data === "object" ? node.data as Record<string, unknown> : {},
          version: source.sourceVersion,
          createdAt: now,
          updatedAt: now,
        })));

        const effects = records(snapshot.effects);
        if (effects.length) await tx.insert(boardEffects).values(effects.map((effect) => {
          const target = effect.target && typeof effect.target === "object" && !Array.isArray(effect.target)
            ? effect.target as Record<string, unknown>
            : null;
          const targetType = typeof target?.type === "string" ? target.type : String(effect.targetType ?? "board");
          const targetId = targetType === "node" && typeof target?.nodeId === "string"
            ? target.nodeId
            : typeof effect.targetId === "string" ? effect.targetId : null;
          return {
          id: String(effect.id),
          boardId,
          targetType,
          targetId,
          kind: String(effect.kind),
          kindVersion: Number(effect.kindVersion),
          enabled: effect.enabled !== false,
          lifecycle: String(effect.lifecycle),
          timeOrigin: String(effect.timeOrigin),
          layer: String(effect.layer),
          seed: String(effect.seed),
          params: effect.params as Record<string, unknown> ?? {},
          assetRefs: records(effect.assetRefs),
          metadata: effect.metadata as Record<string, unknown> ?? {},
          revision: Number(effect.revision ?? 0),
          createdAt: now,
          updatedAt: now,
        };
        }));

        const sequences = records(snapshot.sequences);
        if (sequences.length) await tx.insert(boardSequences).values(sequences.map((sequence) => ({
          id: String(sequence.id),
          boardId,
          name: String(sequence.name),
          duration: Number(sequence.duration),
          seed: String(sequence.seed),
          restPose: sequence.restPose as Record<string, unknown> ?? {},
          metadata: sequence.metadata as Record<string, unknown> ?? {},
          revision: Number(sequence.revision ?? 0),
          createdAt: now,
          updatedAt: now,
        })));

        const clips = records(snapshot.clips);
        if (clips.length) await tx.insert(boardClips).values(clips.map((clip) => ({
          id: String(clip.id),
          boardId,
          sequenceId: String(clip.sequenceId),
          kind: String(clip.kind),
          kindVersion: Number(clip.kindVersion),
          target: clip.target as Record<string, unknown>,
          start: Number(clip.start),
          duration: Number(clip.duration),
          layer: String(clip.layer),
          fill: String(clip.fill),
          easing: String(clip.easing),
          params: clip.params as Record<string, unknown> ?? {},
          keyframes: records(clip.keyframes),
          assetRefs: records(clip.assetRefs),
          seed: String(clip.seed),
          metadata: clip.metadata as Record<string, unknown> ?? {},
        })));
      });

      const temporaryPath = `${absolutePath}.cohub-restore-${boardId}.tmp`;
      try {
        await writeFile(temporaryPath, serializeBoardManifest({ ...manifest, boardId }), { flag: "wx" });
        await rename(temporaryPath, absolutePath);
      } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
      }
      restored.push({ path: relative(resolve(input.workspaceDir), absolutePath).replaceAll("\\", "/"), boardId });
    } catch (error) {
      await db.delete(boards).where(and(eq(boards.id, boardId), eq(boards.spaceId, input.targetSpaceId))).catch(() => undefined);
      throw error;
    }
  }
  return { count: restored.length, restored };
}
