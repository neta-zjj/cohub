import { normalize as normalizePosix } from "node:path/posix";

/** Sandbox working directory; relative tool paths resolve against it. */
export const WORKSPACE_ROOT = "/workspace";

/** Reject absurdly long paths so a malformed input can never bloat the index. */
const MAX_PATH_LENGTH = 1024;

/**
 * Normalize a tool path input into a canonical absolute POSIX path.
 *
 * Pure and deterministic so it serves both the live extractor and the backfill
 * scan. Unlike the agent's workspace guard it never throws: a bad path yields
 * `null` and the caller simply skips it, so a stray value can never break turn
 * indexing.
 *
 * - Relative paths resolve against `cwd` (default `/workspace`), matching the
 *   sandbox tool cwd. Absolute paths (including `/tmp/...`) are kept as-is.
 * - `.`/`..`/`//` are folded; a trailing slash is dropped (root stays `/`).
 * - The filesystem is never touched (no realpath / existence check), so the
 *   result reflects the model's stated intent and stays backfillable.
 */
export const normalizeFilePath = (
  raw: string | null | undefined,
  cwd: string = WORKSPACE_ROOT,
): string | null => {
  if (raw == null) return null;
  const trimmed = raw.trim().replace(/\\/g, "/");
  if (trimmed.includes("\0")) return null;

  const base = trimmed === "" ? "." : trimmed;
  const absolute = base.startsWith("/") ? base : `${cwd.replace(/\/$/, "")}/${base}`;
  const normalized = normalizePosix(absolute);
  if (!normalized.startsWith("/")) return null;
  if (normalized.length > MAX_PATH_LENGTH) return null;

  return normalized === "/" ? "/" : normalized.replace(/\/+$/, "");
};

/**
 * Build a file target id that is globally unique across spaces. Each space has
 * its own sandbox, so `/tmp/x` in space A and space B are different files; the
 * `{spaceId}:` prefix keeps them distinct and lets reverse lookups scope by
 * space without an extra column.
 */
export const fileTargetId = (spaceId: string, path: string): string => `${spaceId}:${path}`;

/** Parse a `{spaceId}:{path}` file target id back into its parts. */
export const parseFileTargetId = (
  targetId: string,
): { spaceId: string; path: string } | null => {
  const idx = targetId.indexOf(":");
  if (idx <= 0) return null;
  return { spaceId: targetId.slice(0, idx), path: targetId.slice(idx + 1) };
};
