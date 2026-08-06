import { isRoleHigherThan } from "@cohub/core/permissions";
import { spaceMembers } from "@cohub/db";
import type { SpaceRole } from "@cohub/db";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index.js";
import { useAuth } from "../lib/middleware.js";
import { redisCommandClient } from "../redis.js";
import {
  getInvitationSpaceLocation,
  invitationKey,
  releaseInvitationUse,
  reserveInvitationUse,
} from "../space-invitations.js";

const VALID_ROLES: SpaceRole[] = ["host", "builder", "guest"];
const LOWER_ROLES: Record<SpaceRole, SpaceRole[]> = {
  host: ["builder", "guest"],
  builder: ["guest"],
  guest: [],
};

const router = new Hono();

async function grantInvitedRole(
  spaceId: string,
  userId: string,
  role: SpaceRole,
): Promise<{ role: SpaceRole; changed: boolean }> {
  return db.transaction(async (tx) => {
    const lowerRoles = LOWER_ROLES[role];
    const tryUpgrade = async () => {
      if (lowerRoles.length === 0) return null;
      const [updated] = await tx
        .update(spaceMembers)
        .set({ role, updatedBy: userId, updatedAt: new Date() })
        .where(and(
          eq(spaceMembers.spaceId, spaceId),
          eq(spaceMembers.userId, userId),
          inArray(spaceMembers.role, lowerRoles),
        ))
        .returning({ role: spaceMembers.role });
      return updated ?? null;
    };

    const upgraded = await tryUpgrade();
    if (upgraded) return { role: upgraded.role, changed: true };

    const [inserted] = await tx
      .insert(spaceMembers)
      .values({
        spaceId,
        userId,
        role,
        createdBy: userId,
        updatedBy: userId,
      })
      .onConflictDoNothing({
        target: [spaceMembers.spaceId, spaceMembers.userId],
      })
      .returning({ role: spaceMembers.role });
    if (inserted) return { role: inserted.role, changed: true };

    const upgradedAfterConflict = await tryUpgrade();
    if (upgradedAfterConflict) {
      return { role: upgradedAfterConflict.role, changed: true };
    }

    const [current] = await tx
      .select({ role: spaceMembers.role })
      .from(spaceMembers)
      .where(and(
        eq(spaceMembers.spaceId, spaceId),
        eq(spaceMembers.userId, userId),
      ))
      .limit(1);
    if (!current) throw new Error("failed to apply invitation membership");
    return { role: current.role, changed: false };
  });
}

router.get("/:token", async (c) => {
  const token = c.req.param("token");
  const key = invitationKey(token);

  const exists = await redisCommandClient.exists(key);
  if (!exists) return c.json({ message: "invitation expired or not found" }, 410);

  const data = await redisCommandClient.hgetall(key);
  if (data.status === "revoked") {
    return c.json({ message: "invitation has been revoked" }, 410);
  }

  const maxUses = Number.parseInt(data.max_uses ?? "0", 10);
  const useCount = Number.parseInt(data.use_count ?? "0", 10);
  if (data.status === "exhausted" || (maxUses > 0 && useCount >= maxUses)) {
    return c.json({ message: "invitation has reached its usage limit" }, 410);
  }

  const spaceId = data.space_id;
  const role = data.role as SpaceRole | undefined;
  if (!spaceId || !role || !VALID_ROLES.includes(role)) {
    return c.json({ message: "invitation expired or not found" }, 410);
  }

  const location = await getInvitationSpaceLocation(spaceId);
  if (!location) return c.json({ message: "invitation space no longer exists" }, 410);

  const ttl = await redisCommandClient.ttl(key);
  return c.json({
    token,
    spaceId: location.spaceId,
    spaceName: location.spaceName,
    spaceSlug: location.spaceSlug,
    ownerUsername: location.ownerUsername,
    role,
    expiresInSeconds: ttl > 0 ? ttl : null,
  });
});

router.post("/:token/accept", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;

  const token = c.req.param("token");
  const key = invitationKey(token);
  const exists = await redisCommandClient.exists(key);
  if (!exists) return c.json({ message: "invitation expired or not found" }, 410);

  const data = await redisCommandClient.hgetall(key);
  if (data.status === "revoked") {
    return c.json({ message: "invitation has been revoked" }, 410);
  }

  const maxUses = Number.parseInt(data.max_uses ?? "0", 10);
  const useCount = Number.parseInt(data.use_count ?? "0", 10);
  if (data.status === "exhausted" || (maxUses > 0 && useCount >= maxUses)) {
    return c.json({ message: "invitation has reached its usage limit" }, 410);
  }

  const spaceId = data.space_id;
  const role = data.role as SpaceRole | undefined;
  if (!spaceId || !role || !VALID_ROLES.includes(role)) {
    return c.json({ message: "invitation expired or not found" }, 410);
  }

  const location = await getInvitationSpaceLocation(spaceId);
  if (!location) return c.json({ message: "invitation space no longer exists" }, 410);

  const [existing] = await db
    .select({ role: spaceMembers.role })
    .from(spaceMembers)
    .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, user.uuid)))
    .limit(1);

  if (existing && !isRoleHigherThan(role, existing.role)) {
    return c.json({
      ok: true,
      spaceId: location.spaceId,
      spaceName: location.spaceName,
      spaceSlug: location.spaceSlug,
      ownerUsername: location.ownerUsername,
      role: existing.role,
    });
  }

  const reservation = await reserveInvitationUse(token);
  if (reservation === "missing") {
    return c.json({ message: "invitation expired or not found" }, 410);
  }
  if (reservation === "revoked") {
    return c.json({ message: "invitation has been revoked" }, 410);
  }
  if (reservation === "exhausted") {
    return c.json({ message: "invitation has reached its usage limit" }, 410);
  }

  let membership: { role: SpaceRole; changed: boolean };
  try {
    membership = await grantInvitedRole(spaceId, user.uuid, role);
  } catch (error) {
    await releaseInvitationUse(token).catch(() => undefined);
    throw error;
  }
  if (!membership.changed) await releaseInvitationUse(token);

  return c.json({
    ok: true,
    spaceId: location.spaceId,
    spaceName: location.spaceName,
    spaceSlug: location.spaceSlug,
    ownerUsername: location.ownerUsername,
    role: membership.role,
  });
});

export default router;
