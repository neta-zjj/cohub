import { getPreviewSessionPrincipal, requireValidId } from "../lib/middleware.js";
import {
  hasPreviewSessionPermission,
  PREVIEW_SESSION_TTL_SECONDS,
  verifyPreviewSessionToken,
} from "../preview-sessions.js";
import {
  resolveSpaceFileDownload,
  spaceFsJsonError,
  streamSpaceFile,
} from "../space-fs-backend.js";
import { createPreviewRouter } from "./preview-router.js";

const router = createPreviewRouter({
  getPreviewSessionPrincipal,
  hasPreviewSessionPermission,
  previewHostname: () => process.env.PREVIEW_HOSTNAME ?? "",
  previewSessionTtlSeconds: PREVIEW_SESSION_TTL_SECONDS,
  requireValidId,
  resolveSpaceFileDownload,
  spaceFsJsonError,
  streamSpaceFile,
  verifyPreviewSessionToken,
});

export default router;
