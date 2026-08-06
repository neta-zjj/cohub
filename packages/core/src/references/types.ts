import type { ReferenceKind, ReferenceResourceType } from "@cohub/db";

export type { ReferenceKind, ReferenceResourceType };

/**
 * A single reference edge observed from a source resource to a target resource.
 * Produced by the pure extractors and consumed by the writer.
 *
 * Content edges (mention / tool_call / file_*) are sourced at `turn`
 * granularity; structural edges (fork / mod) at the resource that owns the
 * event. `sourceSpaceId` / `sourceSessionId` denormalize the source ancestry so
 * one edge rolls up cleanly at turn, session, or space level.
 */
export type ReferenceInput = {
  kind: ReferenceKind;
  sourceType: ReferenceResourceType;
  sourceId: string;
  targetType: ReferenceResourceType;
  targetId: string;
  /** Source's owning space, for authorization and space-level rollups. */
  sourceSpaceId: string;
  /** Source's owning session; omit for space/checkpoint sources. */
  sourceSessionId?: string | null;
  /** Occurrences within the source. Defaults to 1. */
  count?: number;
  /**
   * How `count` is applied on conflict.
   * - `set` (default): replace stored count — for turn extract / structural edges
   *   whose value is fully determined by the source and must stay retry-safe.
   * - `increment`: add to stored count — for live cross-space HTTP hits where
   *   each successful request should raise the turn's touch count.
   */
  countMode?: "set" | "increment";
  meta?: Record<string, unknown> | null;
};
