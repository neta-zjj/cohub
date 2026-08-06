/**
 * Export planning — pure geometry, no renderer.
 *
 * Every platform (browser, CLI) resolves *what* to capture and *how large* the
 * result may be through this module, so a `--scale 4` on a huge board behaves
 * identically everywhere and no caller can accidentally ask the GPU for a
 * texture it cannot allocate.
 */

import {
  type BoardDocument,
  BoardDocumentSchema,
  type BoardItem,
} from "@cohub/protocol/board-document";
import { itemBounds, type Rect, rectsIntersect, unionRects } from "../geometry.js";
import { arrowBounds, type FrameLookup } from "./bindings.js";

/** What part of the board to capture. */
export type BoardExportRegion =
  /** Everything in the document. */
  | { kind: "all" }
  /** Exactly these items, whatever else overlaps them. */
  | { kind: "items"; ids: string[] }
  /** A frame item's rect, treated as a page: its chrome is excluded. */
  | { kind: "frame"; id: string }
  /** An explicit world-space rect. */
  | { kind: "rect"; rect: Rect };

export type BoardExportPlanInput = {
  document: BoardDocument;
  region: BoardExportRegion;
  /** Output pixels per world unit. Defaults to 2 (retina-grade). */
  scale?: number;
  /** World-space breathing room around the content. Frames use 0. */
  padding?: number;
  maxEdge?: number;
  maxPixels?: number;
};

export type BoardExportPlan = {
  /** World-space rect captured, padding included. */
  world: Rect;
  /** Scale actually used, after clamping. */
  scale: number;
  /** Scale asked for, before clamping. */
  requestedScale: number;
  /** Output size in pixels. */
  width: number;
  height: number;
  /** Items to draw, in document order. */
  items: BoardItem[];
  /** True when `scale` had to be reduced to fit the size budget. */
  clamped: boolean;
};

/**
 * Normalise a document before it reaches the renderers.
 *
 * Renderers read shape fields directly and assume schema defaults have been
 * applied — a hand-built or partially-migrated document would otherwise reach
 * them with missing fields. Parsing here means every entry point (CLI, web,
 * tests) gets the same guarantee, and an invalid document fails with a schema
 * error instead of a render-time crash.
 */
export function normalizeBoardDocument(document: BoardDocument): BoardDocument {
  return BoardDocumentSchema.parse(document);
}

/**
 * Hard ceilings.
 *
 * `MAX_EDGE` stays under the 8192 texture limit that essentially every WebGL2
 * and Canvas2D backend guarantees. `MAX_PIXELS` bounds peak memory instead of
 * edge length — a 8192×8192 RGBA buffer alone is 256MB, which is enough to kill
 * a browser tab, so the total is capped well below the square of the edge.
 */
export const BOARD_EXPORT_MAX_EDGE = 8192;
export const BOARD_EXPORT_MAX_PIXELS = 32_000_000;
export const BOARD_EXPORT_DEFAULT_SCALE = 2;
export const BOARD_EXPORT_DEFAULT_PADDING = 32;
/** Above this, an export is still produced but the caller is warned. */
export const BOARD_EXPORT_ITEM_WARN_THRESHOLD = 2000;

export function boardFrameLookup(document: BoardDocument): FrameLookup {
  const frames = new Map(document.items.map((item) => [item.id, item.frame]));
  return (id) => frames.get(id);
}

/** Bounds of a single item, resolving arrow endpoints through their bindings. */
export function exportItemBounds(item: BoardItem, getFrame: FrameLookup): Rect {
  if (item.type === "arrow") return arrowBounds(item, getFrame) ?? itemBounds(item.frame);
  return itemBounds(item.frame);
}

function resolveRegion(
  document: BoardDocument,
  region: BoardExportRegion,
  getFrame: FrameLookup,
): { items: BoardItem[]; rect: Rect | null; padding: number | null } {
  switch (region.kind) {
    case "all":
      return {
        items: document.items,
        rect: unionRects(document.items.map((item) => exportItemBounds(item, getFrame))),
        padding: null,
      };
    case "items": {
      const wanted = new Set(region.ids);
      const items = document.items.filter((item) => wanted.has(item.id));
      return {
        items,
        rect: unionRects(items.map((item) => exportItemBounds(item, getFrame))),
        padding: null,
      };
    }
    case "frame": {
      const frame = document.items.find((item) => item.id === region.id);
      if (!frame) return { items: [], rect: null, padding: null };
      const rect = itemBounds(frame.frame);
      // The frame's own dashed outline and label are editor scaffolding, not
      // content — a framed export should look like a page, not a screenshot.
      const items = document.items.filter(
        (item) => item.id !== region.id && rectsIntersect(exportItemBounds(item, getFrame), rect),
      );
      return { items, rect, padding: 0 };
    }
    case "rect": {
      const rect = region.rect;
      const items = document.items.filter((item) =>
        rectsIntersect(exportItemBounds(item, getFrame), rect),
      );
      return { items, rect, padding: 0 };
    }
  }
}

/**
 * Largest scale that keeps the output inside both the edge and pixel budgets.
 *
 * There is deliberately no lower bound: a floor here would silently let a very
 * large world exceed the budgets it exists to enforce (a 1e6×1e6 region at a
 * 0.01 floor is 1e8 pixels). Callers see the reduction via `plan.clamped`.
 */
function clampScale(
  requested: number,
  world: Rect,
  maxEdge: number,
  maxPixels: number,
): number {
  const byEdge = Math.min(maxEdge / world.width, maxEdge / world.height);
  const byArea = Math.sqrt(maxPixels / (world.width * world.height));
  return Math.min(requested, byEdge, byArea);
}

/**
 * Resolve a region into a concrete capture plan, or null when there is nothing
 * to draw. Callers treat null as "empty selection", not as an error.
 */
export function planBoardExport(input: BoardExportPlanInput): BoardExportPlan | null {
  const {
    document,
    region,
    scale: requestedScale = BOARD_EXPORT_DEFAULT_SCALE,
    maxEdge = BOARD_EXPORT_MAX_EDGE,
    maxPixels = BOARD_EXPORT_MAX_PIXELS,
  } = input;
  const getFrame = boardFrameLookup(document);
  const resolved = resolveRegion(document, region, getFrame);
  if (!resolved.rect) return null;

  const padding = input.padding ?? resolved.padding ?? BOARD_EXPORT_DEFAULT_PADDING;
  const world: Rect = {
    x: resolved.rect.x - padding,
    y: resolved.rect.y - padding,
    width: Math.max(1, resolved.rect.width + padding * 2),
    height: Math.max(1, resolved.rect.height + padding * 2),
  };

  // A positive requested scale is all that is required; the budgets below decide
  // how much of it survives.
  const safeRequest = Number.isFinite(requestedScale) && requestedScale > 0 ? requestedScale : BOARD_EXPORT_DEFAULT_SCALE;
  const scale = clampScale(safeRequest, world, maxEdge, maxPixels);
  return {
    world,
    scale,
    requestedScale,
    // Floor, not round: rounding up can push a budget-limited export back over
    // the pixel ceiling it was just clamped to.
    width: Math.max(1, Math.floor(world.width * scale)),
    height: Math.max(1, Math.floor(world.height * scale)),
    items: resolved.items,
    clamped: scale < safeRequest - 1e-6,
  };
}
