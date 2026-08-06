import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { boardNodes, boards } from "@cohub/db";
import {
  BOARD_EXTENSION,
  BoardCreateInputSchema,
  BoardInspectInputSchema,
  BoardPlaybackCommandSchema,
  isBoardPath,
  serializeBoardManifest,
  type BoardOperation,
} from "@cohub/protocol";
import {
  applyBoardPlaybackCommand,
  applyBoardTransaction,
  BoardServiceError,
  getBoardCapabilities,
  inspectBoard,
  normalizeBoardOperation,
  normalizeBoardTransaction,
  normalizeNodes,
  NODE_WRITE_CHUNK,
  validateBoardTransaction,
} from "../../board-service.js";
import { buildBoardCreateIdentity } from "../../board-create-idempotency.js";
import { db } from "../../db/index.js";
import { authzDenied, getOptionalAuth, requireValidId, useAuth } from "../../lib/middleware.js";
import { getRequestSource } from "../../lib/request-source.js";
import { hasPermission } from "../../permissions.js";
import {
  assertSafeRelativePath,
  createSpaceFileExclusive,
  deleteSpaceNode,
  readSpaceFile,
  SpaceFsError,
} from "../../space-fs-backend.js";
import { buildFileMutationChanges } from "../../space-fs-change.js";
import { dispatchSpaceFsChanged } from "../../space-events.js";

const router = new Hono();

type BoardManifestWrite = Awaited<ReturnType<typeof createSpaceFileExclusive>>;

async function readOwnedBoardManifest(spaceId: string, path: string, boardId: string): Promise<BoardManifestWrite | null> {
  try {
    const file = await readSpaceFile(spaceId, path);
    if (!("content" in file)) return null;
    const manifest = JSON.parse(file.content) as { boardId?: unknown };
    if (manifest.boardId !== boardId) return null;
    return {
      path,
      size: file.size,
      mtimeMs: file.mtimeMs,
      created: false,
      createdDirs: [],
      executedBy: "api",
    };
  } catch {
    return null;
  }
}

async function createOrReuseBoardManifest(
  spaceId: string,
  input: Parameters<typeof createSpaceFileExclusive>[1],
  boardId: string,
): Promise<BoardManifestWrite> {
  try {
    return await createSpaceFileExclusive(spaceId, input);
  } catch (error) {
    if (!(error instanceof SpaceFsError) || error.status !== 409) throw error;
    const owned = await readOwnedBoardManifest(spaceId, input.path, boardId);
    if (owned) return owned;
    throw error;
  }
}

/** Remove only a manifest that provably belongs to this create request. */
async function removeOrphanBoardManifest(spaceId: string, path: string, boardId: string) {
  const owned = await readOwnedBoardManifest(spaceId, path, boardId);
  if (owned) await deleteSpaceNode(spaceId, path).catch(() => undefined);
}

function errorResponse(error: unknown) {
  if (error instanceof BoardServiceError) return { status: error.status, message: error.message, code: error.code };
  if (error instanceof SpaceFsError) return { status: error.status, message: error.message, code: undefined };
  return { status: 500, message: "Board operation failed", code: undefined };
}

router.post("/", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "file.edit", { spaceId }))) return authzDenied(c);

  const rawBody = await c.req.json<unknown>().catch(() => null);
  const parsedBody = BoardCreateInputSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return c.json({ message: parsedBody.error.issues[0]?.message ?? "invalid Board input" }, 400);
  }
  const body = parsedBody.data;
  let path: string;
  try {
    path = assertSafeRelativePath(body.path);
  } catch (error) {
    const response = errorResponse(error);
    return c.json({ message: response.message, code: response.code }, response.status as never);
  }
  if (!isBoardPath(path)) return c.json({ message: `path must end with ${BOARD_EXTENSION}` }, 400);
  const title = (body.title?.trim() || path.split("/").at(-1) || "Board").slice(0, 255);
  let nodes: ReturnType<typeof normalizeNodes>;
  let operations: BoardOperation[];
  try {
    nodes = normalizeNodes(body.nodes ?? []);
    operations = [
      ...(body.metadata
        ? [{ type: "board.patch", payload: { patch: { metadata: body.metadata } } } satisfies BoardOperation]
        : []),
      ...(body.effects ?? []).map((effect): BoardOperation => ({ type: "effect.upsert", payload: { effect } })),
      ...(body.sequences ?? []).map(({ sequence, clips }): BoardOperation => ({ type: "sequence.upsert", payload: { sequence, clips } })),
    ].map(normalizeBoardOperation);
  } catch (error) {
    const response = errorResponse(error);
    return c.json({ message: response.message, code: response.code }, response.status as never);
  }

  const identity = buildBoardCreateIdentity({
    spaceId,
    mutationId: body.mutationId,
    payload: { path, title, nodes, operations },
  });
  const boardId = identity?.boardId ?? crypto.randomUUID();
  const transactionId = identity?.transactionId ?? crypto.randomUUID();
  const applyInitialOperations = () => applyBoardTransaction({
    spaceId,
    actorId: user.uuid,
    requestSource: getRequestSource(c),
    transaction: { txId: transactionId, boardId, baseVersion: 0, operations },
  });

  if (identity) {
    try {
      const existing = await inspectBoard(spaceId, boardId);
      return c.json(operations.length > 0 && existing.board.version === 0
        ? await applyInitialOperations()
        : existing);
    } catch (error) {
      if (!(error instanceof BoardServiceError) || error.code !== "BOARD_NOT_FOUND") {
        const response = errorResponse(error);
        return c.json({ message: response.message, code: response.code }, response.status as never);
      }
    }
  }

  let written: BoardManifestWrite | null = null;
  try {
    written = await createOrReuseBoardManifest(spaceId, {
      path,
      content: serializeBoardManifest({ kind: "cohub.board.manifest", version: 1, boardId, title }),
      encoding: "utf-8",
      mutationId: body.mutationId,
    }, boardId);
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.insert(boards).values({ id: boardId, spaceId, title, version: 0, metadata: {}, createdAt: now, updatedAt: now });
      // Chunked: a node row binds ~18 parameters, so a single statement for a
      // large board would exceed Postgres's per-statement parameter limit long
      // before reaching MAX_BOARD_NODES.
      for (let offset = 0; offset < nodes.length; offset += NODE_WRITE_CHUNK) {
        const chunk = nodes.slice(offset, offset + NODE_WRITE_CHUNK);
        await tx.insert(boardNodes).values(chunk.map((node, index) => ({
          ...node,
          boardId,
          // Padded to a fixed width so the keys sort lexicographically, which is
          // how the client reads document order back.
          orderKey: node.orderKey ?? String(offset + index).padStart(8, "0"),
          version: 0,
          createdAt: now,
          updatedAt: now,
        })));
      }
    });

    const result = operations.length
      ? await applyInitialOperations()
      : await inspectBoard(spaceId, boardId);

    // Board rows are the authoritative state: publish after the transaction
    // commits so clients retry their load on this event, even when the sandbox
    // watcher already emitted the manifest create earlier. Hooks are only
    // skipped on the sandbox path where the watcher already fired them; a
    // direct PVC fallback has no watcher event, so hooks must fire here.
    await dispatchSpaceFsChanged(spaceId, {
      source: "api-fs",
      mutationId: body.mutationId,
      changes: buildFileMutationChanges(written),
    }, written.executedBy === "sandbox" ? { skipHooks: true } : undefined).catch(() => undefined);
    return c.json(result);
  } catch (error) {
    await db.delete(boards).where(and(eq(boards.id, boardId), eq(boards.spaceId, spaceId))).catch(() => undefined);
    if (written) {
      await deleteSpaceNode(spaceId, written.path).catch(() => undefined);
    } else {
      void removeOrphanBoardManifest(spaceId, path, boardId);
    }
    const response = errorResponse(error);
    return c.json({ message: response.message, code: response.code }, response.status as never);
  }
});

router.get("/:boardId", async (c) => {
  const user = getOptionalAuth(c);
  const spaceId = c.req.param("id");
  const boardId = c.req.param("boardId");
  if (!spaceId || !boardId || !requireValidId(spaceId) || !requireValidId(boardId)) return c.json({ message: "board not found" }, 404);
  if (!(await hasPermission(user, "file.view", { spaceId }))) return authzDenied(c);
  let viewport: unknown;
  const viewportParam = c.req.query("viewport");
  if (viewportParam) {
    try {
      viewport = JSON.parse(viewportParam);
    } catch {
      return c.json({ message: "viewport must be valid JSON" }, 400);
    }
  }
  const include = c.req.queries("include") ?? [];
  const parsedInput = BoardInspectInputSchema.safeParse({
    include: include.length > 0 ? include : undefined,
    viewport,
  });
  if (!parsedInput.success) return c.json({ message: parsedInput.error.issues[0]?.message ?? "invalid inspect input" }, 400);
  try {
    return c.json(await inspectBoard(spaceId, boardId, parsedInput.data));
  } catch (error) {
    const response = errorResponse(error);
    return c.json({ message: response.message, code: response.code }, response.status as never);
  }
});

router.get("/:boardId/capabilities", async (c) => {
  const user = getOptionalAuth(c);
  const spaceId = c.req.param("id");
  const boardId = c.req.param("boardId");
  if (!spaceId || !boardId || !requireValidId(spaceId) || !requireValidId(boardId)) return c.json({ message: "board not found" }, 404);
  if (!(await hasPermission(user, "file.view", { spaceId }))) return authzDenied(c);
  try {
    return c.json(await getBoardCapabilities(spaceId, boardId));
  } catch (error) {
    const response = errorResponse(error);
    return c.json({ message: response.message, code: response.code }, response.status as never);
  }
});

router.post("/:boardId/validate", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;
  const spaceId = c.req.param("id");
  const boardId = c.req.param("boardId");
  if (!spaceId || !boardId || !requireValidId(spaceId) || !requireValidId(boardId)) return c.json({ message: "board not found" }, 404);
  if (!(await hasPermission(user, "file.edit", { spaceId }))) return authzDenied(c);
  const body = await c.req.json<unknown>().catch(() => null);
  try {
    const transaction = normalizeBoardTransaction(body);
    if (transaction.boardId !== boardId) throw new BoardServiceError(400, "transaction boardId does not match route");
    return c.json(await validateBoardTransaction({ spaceId, value: transaction }));
  } catch (error) {
    const response = errorResponse(error);
    return c.json({ message: response.message, code: response.code }, response.status as never);
  }
});

router.post("/:boardId/transactions", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;
  const spaceId = c.req.param("id");
  const boardId = c.req.param("boardId");
  if (!spaceId || !boardId || !requireValidId(spaceId) || !requireValidId(boardId)) return c.json({ message: "board not found" }, 404);
  if (!(await hasPermission(user, "file.edit", { spaceId }))) return authzDenied(c);
  const body = await c.req.json<unknown>().catch(() => null);
  try {
    const transaction = normalizeBoardTransaction(body);
    if (transaction.boardId !== boardId) throw new BoardServiceError(400, "transaction boardId does not match route");
    return c.json(await applyBoardTransaction({
      spaceId,
      actorId: user.uuid,
      requestSource: getRequestSource(c),
      transaction,
    }));
  } catch (error) {
    const response = errorResponse(error);
    return c.json({ message: response.message, code: response.code }, response.status as never);
  }
});

router.post("/:boardId/playback", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;
  const spaceId = c.req.param("id");
  const boardId = c.req.param("boardId");
  if (!spaceId || !boardId || !requireValidId(spaceId) || !requireValidId(boardId)) return c.json({ message: "board not found" }, 404);
  if (!(await hasPermission(user, "file.edit", { spaceId }))) return authzDenied(c);
  const body = await c.req.json<unknown>().catch(() => null);
  const parsed = BoardPlaybackCommandSchema.safeParse(body);
  if (!parsed.success) return c.json({ message: parsed.error.issues[0]?.message ?? "invalid playback command" }, 400);
  try {
    return c.json(await applyBoardPlaybackCommand({ spaceId, boardId, command: parsed.data }));
  } catch (error) {
    const response = errorResponse(error);
    return c.json({ message: response.message, code: response.code }, response.status as never);
  }
});

export default router;
