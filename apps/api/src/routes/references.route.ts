import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import * as schema from "@cohub/db";
import { createLogger } from "@cohub/infra/logging";
import { getOptionalAuth, requireValidId, authzDenied } from "../lib/middleware.js";
import { filterSpaceIdsByPermission, hasPermission } from "../permissions.js";
import {
  aggregateReferences,
  parseDirection,
  parseGroupBy,
  parseKinds,
  parseResourceRef,
  queryReferences,
  type ResourceRef,
} from "../references.js";

const logger = createLogger({ serviceName: "cohub-api" });
const router = new Hono();

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 200;

const parseLimit = (value: string | undefined): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
};

const parseSince = (value: string | undefined): Date | null => {
  const days = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(days) || days <= 0) return null;
  const since = new Date(Date.now() - Math.min(days, 365) * 86400000);
  return since;
};

/** Resolve the space that owns a resource, for authorization. */
const resolveSpaceId = async (ref: ResourceRef): Promise<string | null> => {
  if (ref.type === "space") return ref.id;
  if (ref.type === "session") {
    const [row] = await db
      .select({ spaceId: schema.spaceSessions.spaceId })
      .from(schema.spaceSessions)
      .where(eq(schema.spaceSessions.id, ref.id))
      .limit(1);
    return row?.spaceId ?? null;
  }
  if (ref.type === "turn") {
    const [row] = await db
      .select({ spaceId: schema.spaceSessions.spaceId })
      .from(schema.sessionTurns)
      .innerJoin(schema.spaceSessions, eq(schema.sessionTurns.sessionId, schema.spaceSessions.id))
      .where(eq(schema.sessionTurns.id, ref.id))
      .limit(1);
    return row?.spaceId ?? null;
  }
  if (ref.type === "checkpoint") {
    const [row] = await db
      .select({ spaceId: schema.checkpoints.spaceId })
      .from(schema.checkpoints)
      .where(eq(schema.checkpoints.id, ref.id))
      .limit(1);
    return row?.spaceId ?? null;
  }
  return null;
};

/**
 * Entry gate for the reference index. Collaboration / file-heat data is richer
 * than a bare space page view, so require the dedicated `references.view`
 * scope (builder+ / host). Public guests stay out.
 */
const REFERENCES_PERMISSION = "references.view" as const;

/**
 * GET /api/references?source=turn:<id>&direction=both&kinds=mention,tool_call&days=30&limit=200
 * Neutral reference-edge listing for a resource. Sources: turn | session | space
 * | checkpoint. Callers render graphs, lists, rankings, or file-heat views.
 */
router.get("/", async (c) => {
  const user = getOptionalAuth(c);
  const ref = parseResourceRef(c.req.query("source") ?? c.req.query("resource"));
  if (!ref) return c.json({ message: "invalid or missing source" }, 400);
  if (!requireValidId(ref.id)) return c.json({ message: "invalid resource id" }, 400);

  const spaceId = await resolveSpaceId(ref);
  if (!spaceId) return c.json({ message: "resource not found" }, 404);
  if (!(await hasPermission(user, REFERENCES_PERMISSION, { spaceId }))) return authzDenied(c);

  const direction = parseDirection(c.req.query("direction"));
  const { kinds, invalid } = parseKinds(c.req.query("kinds"));
  if (invalid.length > 0) return c.json({ message: `invalid kinds: ${invalid.join(", ")}` }, 400);
  const since = parseSince(c.req.query("days"));
  const limit = parseLimit(c.req.query("limit"));

  // Incoming edges originate in other spaces. Authorize them in one batch with
  // the lighter space.view check ("can I know this source exists?"), not the
  // entry-gate permission — requiring references.view of every source would
  // hide public collaborators and reintroduce N-way fan-out.
  const canViewSpaces = async (spaceIds: readonly string[]): Promise<ReadonlySet<string>> => {
    const others = spaceIds.filter((id) => id !== spaceId);
    if (others.length === 0) return new Set(spaceIds.includes(spaceId) ? [spaceId] : []);
    const allowed = await filterSpaceIdsByPermission(user, "space.view", others);
    if (spaceIds.includes(spaceId)) allowed.push(spaceId);
    return new Set(allowed);
  };

  let rows: Awaited<ReturnType<typeof queryReferences>>;
  try {
    rows = await queryReferences({ ref, direction, kinds, since, limit, canViewSpaces });
  } catch (error) {
    logger.error("[references] query failed", error);
    return c.json({ message: "failed to load references" }, 500);
  }
  return c.json({ source: `${ref.type}:${ref.id}`, direction, references: rows });
});

/**
 * GET /api/references/aggregate?space=<id>&groupBy=kind&kinds=...&days=30&limit=50
 * Grouped counts for a space: distributions, influence, file heat, and trends.
 * `groupBy=target` ranks concrete target ids (e.g. hottest file paths).
 */
router.get("/aggregate", async (c) => {
  const user = getOptionalAuth(c);
  const spaceId = c.req.query("space") ?? c.req.query("spaceId");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "invalid or missing space" }, 400);
  if (!(await hasPermission(user, REFERENCES_PERMISSION, { spaceId }))) return authzDenied(c);

  const groupBy = parseGroupBy(c.req.query("groupBy"));
  const { kinds, invalid } = parseKinds(c.req.query("kinds"));
  if (invalid.length > 0) return c.json({ message: `invalid kinds: ${invalid.join(", ")}` }, 400);
  const since = parseSince(c.req.query("days"));
  const limit = parseLimit(c.req.query("limit"));

  let rows: Awaited<ReturnType<typeof aggregateReferences>>;
  try {
    rows = await aggregateReferences({ spaceId, groupBy, kinds, since, limit });
  } catch (error) {
    logger.error("[references] aggregate failed", error);
    return c.json({ message: "failed to aggregate references" }, 500);
  }
  return c.json({ space: spaceId, groupBy, groups: rows });
});

export default router;
