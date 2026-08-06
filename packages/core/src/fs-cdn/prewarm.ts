import { BOARD_EXTENSION, BOARD_MIME_TYPE } from "@cohub/protocol";
import type { SpaceFsChange } from "@cohub/protocol/fs";
import { shouldUseFsCdnCache } from "./policy.js";
import type { FsCdnWarmFileJob, FsCdnWarmReason } from "./types.js";

export type FsCdnFileMeta = {
  spaceId: string;
  path: string;
  name: string;
  size: number;
  mimeType: string | null;
  mtimeMs: number;
};

export const mimeByExt: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".json": "application/json",
  ".jsonl": "application/x-ndjson",
  [BOARD_EXTENSION]: BOARD_MIME_TYPE,
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".cjs": "text/javascript",
  ".ts": "text/typescript",
  ".tsx": "text/tsx",
  ".jsx": "text/jsx",
  ".svelte": "text/x-svelte",
  ".css": "text/css",
  ".scss": "text/x-scss",
  ".html": "text/html",
  ".xml": "application/xml",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".toml": "application/toml",
  ".ini": "text/plain",
  ".env": "text/plain",
  ".sh": "text/x-shellscript",
  ".bash": "text/x-shellscript",
  ".py": "text/x-python",
  ".go": "text/x-go",
  ".rs": "text/x-rust",
  ".java": "text/x-java-source",
  ".c": "text/x-c",
  ".h": "text/x-c",
  ".cpp": "text/x-c++src",
  ".hpp": "text/x-c++hdr",
  ".sql": "application/sql",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
};

export function getFsMimeType(path: string) {
  const basename = path.split("/").pop()?.toLowerCase() ?? "";
  if (basename === "dockerfile") return "text/x-dockerfile";
  if (basename === "makefile") return "text/x-makefile";
  // Dotfiles are text config by convention (.npmrc, .gitignore, .env…).
  if (basename.startsWith(".")) return "text/plain";
  const dotIndex = basename.lastIndexOf(".");
  const ext = dotIndex >= 0 ? basename.slice(dotIndex) : "";
  return mimeByExt[ext] ?? null;
}

export function createFsCdnWarmJobsForChanges(input: {
  spaceId: string;
  changes: SpaceFsChange[];
  reason?: FsCdnWarmReason;
  now?: number;
}) {
  const requestedAt = input.now ?? Date.now();
  const reason = input.reason ?? "fs_changed";
  const jobs: FsCdnWarmFileJob[] = [];

  for (const change of input.changes) {
    if ((change.kind !== "create" && change.kind !== "modify") || change.nodeType !== "file") continue;
    if (!change.path || change.size == null || change.mtimeMs == null) continue;
    const mimeType = getFsMimeType(change.path);
    if (!shouldUseFsCdnCache({ path: change.path, mimeType, size: change.size })) continue;
    jobs.push({
      spaceId: input.spaceId,
      path: change.path,
      size: change.size,
      mtimeMs: change.mtimeMs,
      mimeType,
      requestedAt,
      reason,
    });
  }

  return jobs;
}
