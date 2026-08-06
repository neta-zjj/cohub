import type { SpaceRole } from "@cohub/db";
import { Hono } from "hono";
import { requireValidId, useAuth } from "../../lib/middleware.js";
import { getRoleForSpaceUser } from "../../permissions.js";
import { redisCommandClient } from "../../redis.js";
import {
  createSpaceInvitation,
  getInvitationSpaceLocation,
  invitationKey,
  listSpaceInvitations,
  MAX_SPACE_INVITATIONS,
} from "../../space-invitations.js";
import { getSpaceById } from "../../space-sessions.js";

const VALID_ROLES: SpaceRole[] = ["host", "builder", "guest"];
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_INVITE_USES = 10_000;

const router = new Hono();

router.post("/", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);

  const space = await getSpaceById(spaceId);
  if (!space) return c.json({ message: "space not found" }, 404);

  const actorRole = await getRoleForSpaceUser(spaceId, user.uuid);
  if (actorRole !== "host") return c.json({ message: "forbidden" }, 403);

  const body = await c.req.json<{
    role?: SpaceRole;
    ttlSeconds?: number;
    maxUses?: number;
  }>().catch(() => null);

  const role = body?.role ?? "builder";
  if (!VALID_ROLES.includes(role)) return c.json({ message: "invalid role" }, 400);

  const ttlSeconds = body?.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > MAX_TTL_SECONDS) {
    return c.json({ message: "ttlSeconds must be between 1 and 30 days" }, 400);
  }

  const maxUses = body?.maxUses ?? 0;
  if (!Number.isInteger(maxUses) || maxUses < 0 || maxUses > MAX_INVITE_USES) {
    return c.json({ message: "maxUses must be between 0 and 10000" }, 400);
  }

  const location = await getInvitationSpaceLocation(spaceId);
  if (!location) return c.json({ message: "space not found" }, 404);

  const createdAt = new Date();
  const invitation = {
    spaceId,
    spaceName: space.name,
    creatorId: user.uuid,
    role,
    maxUses,
    createdAt: createdAt.toISOString(),
    ttlSeconds,
  };
  let creation = await createSpaceInvitation(invitation);
  if (creation.status === "limit_reached") {
    await listSpaceInvitations(spaceId);
    creation = await createSpaceInvitation(invitation);
  }
  if (creation.status === "limit_reached") {
    return c.json(
      { message: `space can have at most ${MAX_SPACE_INVITATIONS} invitation links` },
      409,
    );
  }

  return c.json({
    token: creation.token,
    role,
    expiresAt: new Date(createdAt.getTime() + ttlSeconds * 1000).toISOString(),
    maxUses: maxUses || null,
    spaceId: location.spaceId,
    spaceSlug: location.spaceSlug,
    ownerUsername: location.ownerUsername,
  }, 201);
});

router.get("/", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);

  const actorRole = await getRoleForSpaceUser(spaceId, user.uuid);
  if (actorRole !== "host") return c.json({ message: "forbidden" }, 403);

  const location = await getInvitationSpaceLocation(spaceId);
  if (!location) return c.json({ message: "space not found" }, 404);

  const invitations = await listSpaceInvitations(spaceId);

  return c.json({
    items: invitations,
    spaceId: location.spaceId,
    spaceSlug: location.spaceSlug,
    ownerUsername: location.ownerUsername,
  });
});

router.delete("/:token", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;
  const spaceId = c.req.param("id");
  const token = c.req.param("token");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);

  const actorRole = await getRoleForSpaceUser(spaceId, user.uuid);
  if (actorRole !== "host") return c.json({ message: "forbidden" }, 403);

  const key = invitationKey(token);
  const exists = await redisCommandClient.exists(key);
  if (!exists) return c.json({ message: "invitation not found" }, 404);

  const data = await redisCommandClient.hgetall(key);
  if (data.space_id !== spaceId) return c.json({ message: "invitation not found" }, 404);

  await redisCommandClient.hset(key, "status", "revoked");
  return c.json({ ok: true });
});

export default router;
