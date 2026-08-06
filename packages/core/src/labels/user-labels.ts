import { and, asc, eq, max, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { labelAssignments, labels } from "@cohub/db";
import type { LabelResourceType } from "./resource-events.js";

/**
 * User-scoped labels — the same label/assignment model as space-scoped labels,
 * but under scope_type='user' with scope_id=<userUuid>.
 *
 * The built-in "Pinned" system label (system_key='user:pinned') lets a user
 * bookmark spaces across the product. User-scoped labels are private to the
 * owner; only the viewer can see or mutate their own labels.
 */

type LabelsDb = PostgresJsDatabase<Record<string, unknown>>;

export type UserLabelAssignment = typeof labelAssignments.$inferSelect & {
  labelSystemKey: string | null;
  labelName: string;
};

export const USER_LABEL_SCOPE_TYPE = "user";
export const PINNED_LABEL_NAME = "Pinned";
export const PINNED_LABEL_SYSTEM_KEY = "user:pinned";

const MAX_LABEL_NAME_LENGTH = 80;
const RESERVED_SYSTEM_ROOT_LABELS = new Set(["pinned"]);

const hasControlCharacter = (value: string) => [...value].some((char) => {
  const code = char.charCodeAt(0);
  return code <= 0x1f || code === 0x7f;
});

export function normalizeLabelName(value: unknown): string {
  if (typeof value !== "string") throw new Error("label name must be a string");
  if (hasControlCharacter(value)) throw new Error("label name cannot contain control characters");
  const name = value.replace(/\s+/g, " ").trim();
  if (!name || name.length > MAX_LABEL_NAME_LENGTH) throw new Error(`label name must be 1-${MAX_LABEL_NAME_LENGTH} characters`);
  if (name.includes("/")) throw new Error('label name cannot contain "/"');
  return name;
}

export function slugifyLabelName(name: string) {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "label";
}

async function findUserLabelByName(db: LabelsDb, userUuid: string, name: string) {
  const [row] = await db
    .select()
    .from(labels)
    .where(and(
      eq(labels.scopeType, USER_LABEL_SCOPE_TYPE),
      eq(labels.scopeId, userUuid),
      sql`lower(${labels.name}) = lower(${name})`,
    ))
    .limit(1);
  return row ?? null;
}

async function findUserLabelBySystemKey(db: LabelsDb, userUuid: string, systemKey: string) {
  const [row] = await db
    .select()
    .from(labels)
    .where(and(
      eq(labels.scopeType, USER_LABEL_SCOPE_TYPE),
      eq(labels.scopeId, userUuid),
      eq(labels.systemKey, systemKey),
    ))
    .limit(1);
  return row ?? null;
}

async function nextUserLabelRank(db: LabelsDb, userUuid: string) {
  const [{ value } = { value: 0 }] = await db
    .select({ value: max(labels.rank) })
    .from(labels)
    .where(and(eq(labels.scopeType, USER_LABEL_SCOPE_TYPE), eq(labels.scopeId, userUuid)));
  return Number(value ?? 0) + 10;
}

/** Get-or-create the user's built-in "Pinned" system label. */
export async function ensurePinnedLabel(db: LabelsDb, userUuid: string) {
  const existing = await findUserLabelBySystemKey(db, userUuid, PINNED_LABEL_SYSTEM_KEY);
  if (existing) return existing;

  const [created] = await db.insert(labels).values({
    scopeType: USER_LABEL_SCOPE_TYPE,
    scopeId: userUuid,
    name: PINNED_LABEL_NAME,
    slug: slugifyLabelName(PINNED_LABEL_NAME),
    parentId: null,
    depth: 0,
    rank: await nextUserLabelRank(db, userUuid),
    source: "system",
    systemKey: PINNED_LABEL_SYSTEM_KEY,
    createdBy: userUuid,
  }).onConflictDoNothing().returning();
  if (created) return created;

  const raced = await findUserLabelBySystemKey(db, userUuid, PINNED_LABEL_SYSTEM_KEY);
  if (!raced) throw new Error("failed to create pinned label");
  return raced;
}

/** Resolve a label ref (name) to an existing user-scope label, or null. */
export async function resolveUserLabelRef(db: LabelsDb, userUuid: string, labelRef: string) {
  const name = normalizeLabelName(labelRef);
  if (RESERVED_SYSTEM_ROOT_LABELS.has(name.toLowerCase())) {
    return ensurePinnedLabel(db, userUuid);
  }
  return findUserLabelByName(db, userUuid, name);
}

/** Resolve or create user-scope labels by ref (name). */
export async function resolveOrCreateUserLabelRefs(db: LabelsDb, userUuid: string, labelRefs: string[]) {
  const refs = [...new Set(labelRefs.map((ref) => ref.trim()).filter(Boolean))];
  const labelIds: string[] = [];
  for (const ref of refs) {
    const name = normalizeLabelName(ref);
    if (RESERVED_SYSTEM_ROOT_LABELS.has(name.toLowerCase())) {
      labelIds.push((await ensurePinnedLabel(db, userUuid)).id);
      continue;
    }
    const existing = await findUserLabelByName(db, userUuid, name);
    if (existing) {
      labelIds.push(existing.id);
      continue;
    }
    const [created] = await db.insert(labels).values({
      scopeType: USER_LABEL_SCOPE_TYPE,
      scopeId: userUuid,
      name,
      slug: slugifyLabelName(name),
      parentId: null,
      depth: 0,
      rank: await nextUserLabelRank(db, userUuid),
      source: "user",
      createdBy: userUuid,
    }).onConflictDoNothing().returning();
    if (created) {
      labelIds.push(created.id);
    } else {
      const raced = await findUserLabelByName(db, userUuid, name);
      if (raced) labelIds.push(raced.id);
    }
  }
  return [...new Set(labelIds)];
}

/** List all labels under the user's scope. */
export async function listUserLabels(db: LabelsDb, userUuid: string) {
  return db
    .select()
    .from(labels)
    .where(and(eq(labels.scopeType, USER_LABEL_SCOPE_TYPE), eq(labels.scopeId, userUuid)))
    .orderBy(asc(labels.rank), asc(labels.name));
}

/** Get the set of spaceIds the user has pinned. */
export async function getPinnedSpaceIds(db: LabelsDb, userUuid: string): Promise<Set<string>> {
  const label = await ensurePinnedLabel(db, userUuid);
  const rows = await db
    .select({ resourceRef: labelAssignments.resourceRef })
    .from(labelAssignments)
    .where(and(
      eq(labelAssignments.scopeType, USER_LABEL_SCOPE_TYPE),
      eq(labelAssignments.scopeId, userUuid),
      eq(labelAssignments.labelId, label.id),
      eq(labelAssignments.resourceType, "space"),
    ));
  return new Set(rows.map((row) => row.resourceRef));
}

/** Attach a label to a resource (idempotent). */
export async function attachUserLabel(db: LabelsDb, userUuid: string, labelId: string, resourceType: LabelResourceType, resourceRef: string) {
  const [{ value: maxRank } = { value: 0 }] = await db
    .select({ value: max(labelAssignments.rank) })
    .from(labelAssignments)
    .where(eq(labelAssignments.labelId, labelId));
  const [assignment] = await db.insert(labelAssignments).values({
    labelId,
    scopeType: USER_LABEL_SCOPE_TYPE,
    scopeId: userUuid,
    resourceType,
    resourceRef,
    rank: Number(maxRank ?? 0) + 10,
    source: "user",
    createdBy: userUuid,
  }).onConflictDoNothing().returning();
  if (assignment) return assignment;
  const [existing] = await db
    .select()
    .from(labelAssignments)
    .where(and(
      eq(labelAssignments.labelId, labelId),
      eq(labelAssignments.resourceType, resourceType),
      eq(labelAssignments.resourceRef, resourceRef),
    ))
    .limit(1);
  return existing ?? null;
}

/** Detach a label from a resource (idempotent). */
export async function detachUserLabel(db: LabelsDb, userUuid: string, labelId: string, resourceType: LabelResourceType, resourceRef: string) {
  await db.delete(labelAssignments).where(and(
    eq(labelAssignments.labelId, labelId),
    eq(labelAssignments.scopeType, USER_LABEL_SCOPE_TYPE),
    eq(labelAssignments.scopeId, userUuid),
    eq(labelAssignments.resourceType, resourceType),
    eq(labelAssignments.resourceRef, resourceRef),
  ));
}

/** Get all label assignments for a resource under user scope, with label metadata. */
export async function getUserResourceLabelAssignments(db: LabelsDb, userUuid: string, resourceType: LabelResourceType, resourceRef: string): Promise<UserLabelAssignment[]> {
  const rows = await db
    .select({
      assignment: labelAssignments,
      labelSystemKey: labels.systemKey,
      labelName: labels.name,
    })
    .from(labelAssignments)
    .innerJoin(labels, eq(labels.id, labelAssignments.labelId))
    .where(and(
      eq(labelAssignments.scopeType, USER_LABEL_SCOPE_TYPE),
      eq(labelAssignments.scopeId, userUuid),
      eq(labelAssignments.resourceType, resourceType),
      eq(labelAssignments.resourceRef, resourceRef),
    ))
    .orderBy(sql`${labelAssignments.rank} asc nulls last`, asc(labelAssignments.createdAt), asc(labelAssignments.id));
  return rows.map((row) => ({ ...row.assignment, labelSystemKey: row.labelSystemKey, labelName: row.labelName }));
}

/** Patch a resource's user-scope labels by ref (add/remove). */
export async function patchUserResourceLabels(db: LabelsDb, userUuid: string, resourceType: LabelResourceType, resourceRef: string, input: {
  addLabelRefs?: string[];
  removeLabelRefs?: string[];
}) {
  const [addLabelIds, removeLabels] = await Promise.all([
    input.addLabelRefs?.length
      ? resolveOrCreateUserLabelRefs(db, userUuid, input.addLabelRefs)
      : Promise.resolve([]),
    input.removeLabelRefs?.length
      ? Promise.all(input.removeLabelRefs.map((ref) => resolveUserLabelRef(db, userUuid, ref)))
      : Promise.resolve([]),
  ]);

  for (const labelId of addLabelIds) {
    if (labelId) await attachUserLabel(db, userUuid, labelId, resourceType, resourceRef);
  }
  for (const label of removeLabels) {
    if (label) await detachUserLabel(db, userUuid, label.id, resourceType, resourceRef);
  }
  return getUserResourceLabelAssignments(db, userUuid, resourceType, resourceRef);
}
