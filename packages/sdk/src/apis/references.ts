import type { Fetch, HttpTransport } from "../transport.js";
import type {
  ReferenceAggregateGroupBy,
  ReferenceAggregateResponse,
  ReferenceDirection,
  ReferenceKind,
  ReferenceQueryableType,
  ReferenceQueryResponse,
} from "../types.js";

export type ReferenceResourceSelector =
  | `${ReferenceQueryableType}:${string}`
  | { type: ReferenceQueryableType; id: string };

const toSelector = (ref: ReferenceResourceSelector): string =>
  typeof ref === "string" ? ref : `${ref.type}:${ref.id}`;

/**
 * Neutral access to the resource reference index. `query` lists references
 * touching a resource; `aggregate` returns grouped counts for a space. Callers
 * assemble collaboration graphs, lineage views, rankings, or trends from the
 * returned data.
 */
export class ReferencesApi {
  constructor(private readonly transport: HttpTransport) {}

  query(
    input: {
      source: ReferenceResourceSelector;
      direction?: ReferenceDirection;
      kinds?: ReferenceKind[];
      days?: number;
      limit?: number;
    },
    customFetch?: Fetch,
  ) {
    const params = new URLSearchParams({ source: toSelector(input.source) });
    if (input.direction) params.set("direction", input.direction);
    if (input.kinds && input.kinds.length > 0) params.set("kinds", input.kinds.join(","));
    if (input.days !== undefined) params.set("days", String(input.days));
    if (input.limit !== undefined) params.set("limit", String(input.limit));
    return this.transport.request<ReferenceQueryResponse>(
      `/api/references?${params.toString()}`,
      { fetch: customFetch },
    );
  }

  aggregate(
    input: {
      spaceId: string;
      groupBy?: ReferenceAggregateGroupBy;
      kinds?: ReferenceKind[];
      days?: number;
      limit?: number;
    },
    customFetch?: Fetch,
  ) {
    const params = new URLSearchParams({ space: input.spaceId });
    if (input.groupBy) params.set("groupBy", input.groupBy);
    if (input.kinds && input.kinds.length > 0) params.set("kinds", input.kinds.join(","));
    if (input.days !== undefined) params.set("days", String(input.days));
    if (input.limit !== undefined) params.set("limit", String(input.limit));
    return this.transport.request<ReferenceAggregateResponse>(
      `/api/references/aggregate?${params.toString()}`,
      { fetch: customFetch },
    );
  }
}
