import { Hono } from "hono";
import type { SpaceFsChangedPayload } from "@cohub/protocol/fs";
import { ensureInternalRequest, requireValidId } from "../../lib/middleware.js";
import { dispatchSpaceFsChanged } from "../../space-events.js";

const router = new Hono();

router.post("/:spaceId/fs-changed", async (c) => {
  const forbidden = ensureInternalRequest(c);
  if (forbidden) return forbidden;

  const spaceId = c.req.param("spaceId");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);

  const payload = await c.req.json<SpaceFsChangedPayload>().catch(() => null);
  if (!payload || !Array.isArray(payload.changes)) return c.json({ message: "fs payload is required" }, 400);

  await dispatchSpaceFsChanged(spaceId, payload);
  return c.json({ ok: true });
});

export default router;
