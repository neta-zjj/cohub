import {
  mergeRequestSourceIntoMeta,
  parseRequestSourceFromHeaders,
  REQUEST_SOURCE_VIA_MAX_LENGTH,
  resolveRequestSourceChannel,
  stripControlChars,
  type RequestSource,
} from "@cohub/protocol/provenance";
import type { Context } from "hono";

export const getRequestSource = (c: Context): RequestSource | null =>
  parseRequestSourceFromHeaders((name) => c.req.header(name));

/** body.source > header via > fallback. Display-only, not auth. */
export const resolveSessionSourceFromRequest = (
  c: Context,
  bodySource?: string | null,
  fallback = "public_api",
): string => {
  const explicit =
    typeof bodySource === "string" ? stripControlChars(bodySource).trim() : "";
  if (explicit) return explicit.slice(0, REQUEST_SOURCE_VIA_MAX_LENGTH);
  return resolveRequestSourceChannel(getRequestSource(c), fallback);
};

/** Stamp header identity onto meta.source; drop body source. */
export const applyRequestSourceToMeta = (
  c: Context,
  meta: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null =>
  mergeRequestSourceIntoMeta(meta, getRequestSource(c));
