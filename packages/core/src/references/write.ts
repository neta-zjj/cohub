import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { resourceReferences } from "@cohub/db";
import type { ReferenceInput } from "./types.js";

export type ReferenceDb = PostgresJsDatabase<Record<string, unknown>>;

type CountMode = "set" | "increment";
type MergedReference = ReferenceInput & { count: number; countMode: CountMode };

const identityKey = (
  ref: Pick<ReferenceInput, "kind" | "sourceType" | "sourceId" | "targetType" | "targetId">,
) => [ref.kind, ref.sourceType, ref.sourceId, ref.targetType, ref.targetId].join("\u0000");

/**
 * Collapse duplicate identities within a single write batch.
 * Set and increment modes never merge into each other — mixed modes for the
 * same identity stay separate so a SET cannot be upgraded to INCREMENT (or
 * vice versa) by accident.
 */
const mergeByIdentity = (references: readonly ReferenceInput[]): MergedReference[] => {
  const byKey = new Map<string, MergedReference>();
  for (const ref of references) {
    const mode: CountMode = ref.countMode === "increment" ? "increment" : "set";
    const key = `${identityKey(ref)}\u0000${mode}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += ref.count ?? 1;
      existing.meta = ref.meta ?? existing.meta;
      // First-write wins for ancestry within a homogeneous batch.
      continue;
    }
    byKey.set(key, {
      ...ref,
      count: ref.count ?? 1,
      countMode: mode,
    });
  }
  return [...byKey.values()];
};

const toValues = (refs: readonly MergedReference[]) =>
  refs.map((ref) => ({
    kind: ref.kind,
    sourceType: ref.sourceType,
    sourceId: ref.sourceId,
    targetType: ref.targetType,
    targetId: ref.targetId,
    sourceSpaceId: ref.sourceSpaceId,
    sourceSessionId: ref.sourceSessionId ?? null,
    count: ref.count,
    meta: ref.meta ?? null,
  }));

const CONFLICT_TARGET = [
  resourceReferences.kind,
  resourceReferences.sourceType,
  resourceReferences.sourceId,
  resourceReferences.targetType,
  resourceReferences.targetId,
] as const;

/**
 * Persist references. Two count modes:
 *
 * - **set** (default): on conflict replace count. Used by turn extractors and
 *   structural events so retries and backfill re-runs converge to the same row.
 * - **increment**: on conflict add to count. Used by live cross-space HTTP
 *   edges so multiple successful requests in one turn accumulate.
 *
 * Modes are written in separate statements (set first, then increment) so a
 * mixed batch cannot corrupt either semantics.
 */
export const writeReferences = async (
  db: ReferenceDb,
  references: readonly ReferenceInput[],
): Promise<void> => {
  if (references.length === 0) return;
  const now = new Date();
  const merged = mergeByIdentity(references);
  const setRefs = merged.filter((ref) => ref.countMode === "set");
  const incrementRefs = merged.filter((ref) => ref.countMode === "increment");

  if (setRefs.length > 0) {
    await db
      .insert(resourceReferences)
      .values(toValues(setRefs))
      .onConflictDoUpdate({
        target: [...CONFLICT_TARGET],
        set: {
          sourceSpaceId: sql`excluded.source_space_id`,
          sourceSessionId: sql`excluded.source_session_id`,
          count: sql`excluded.count`,
          meta: sql`excluded.meta`,
          updatedAt: now,
        },
      });
  }

  if (incrementRefs.length > 0) {
    await db
      .insert(resourceReferences)
      .values(toValues(incrementRefs))
      .onConflictDoUpdate({
        target: [...CONFLICT_TARGET],
        set: {
          sourceSpaceId: sql`excluded.source_space_id`,
          sourceSessionId: sql`excluded.source_session_id`,
          count: sql`${resourceReferences.count} + excluded.count`,
          meta: sql`excluded.meta`,
          updatedAt: now,
        },
      });
  }
};

/**
 * Remove a structural reference when its underlying relationship is severed
 * (e.g. a mod is unmounted). Keeps the index consistent with source tables so
 * stale relationships do not linger in stats.
 */
export const deleteReference = async (
  db: ReferenceDb,
  identity: {
    kind: ReferenceInput["kind"];
    sourceType: ReferenceInput["sourceType"];
    sourceId: string;
    targetType: ReferenceInput["targetType"];
    targetId: string;
  },
): Promise<void> => {
  await db
    .delete(resourceReferences)
    .where(
      and(
        eq(resourceReferences.kind, identity.kind),
        eq(resourceReferences.sourceType, identity.sourceType),
        eq(resourceReferences.sourceId, identity.sourceId),
        eq(resourceReferences.targetType, identity.targetType),
        eq(resourceReferences.targetId, identity.targetId),
      ),
    );
};
