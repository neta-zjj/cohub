/**
 * Board → image, driven by the editor's own renderers.
 *
 * The browser passes the renderer it already has; the CLI passes a headless one
 * (see `../headless`). Both go through this function, so a PNG produced on a
 * laptop and one produced in CI are the same picture.
 *
 * Deciding *what* to capture and *how large* it may be is pure geometry and
 * lives in `@neta-art/cohub/board` (`planBoardExport`, `selectBoardExportAssets`),
 * so a caller that only needs an export plan does not need PixiJS at all.
 */

import type { BoardDocument, BoardItem } from "@cohub/protocol/board-document";
import { type ICanvas, Rectangle, type Renderer, type Texture } from "pixi.js";
import type { BoardShapeColors } from "../core/palette.js";
import {
  BOARD_EXPORT_ITEM_WARN_THRESHOLD,
  type BoardExportPlan,
  type BoardExportRegion,
  normalizeBoardDocument,
  planBoardExport,
} from "../core/export-plan.js";
import {
  type BoardRenderPalette,
  defaultBoardPalette,
} from "../render/index.js";
import { createBoardExportScene } from "./scene.js";

// Re-exported for ergonomics: an export caller should not have to reach into a
// second entry just to name the region it is already passing.
export type {
  BoardExportPlan,
  BoardExportPlanInput,
  BoardExportRegion,
} from "../core/export-plan.js";
export { createBoardExportScene } from "./scene.js";
export type { BoardExportScene, BoardExportSceneInput } from "./scene.js";

/** Paper behind the content: the theme's page color, or none at all. */
export type BoardExportBackground = "paper" | "transparent" | number;

export type BoardExportOptions = {
  region?: BoardExportRegion;
  /** Output pixels per world unit. Defaults to 2. */
  scale?: number;
  /** World-space padding. Frame and rect regions default to 0, others to 32. */
  padding?: number;
  colorScheme?: "dark" | "light";
  /** Defaults to "paper" — a transparent PNG surprises people who paste it. */
  background?: BoardExportBackground;
  palette?: Partial<BoardRenderPalette>;
  colors?: BoardShapeColors;
  /** Resolved textures by preview key; unresolved keys become placeholders. */
  textures?: Map<string, Texture>;
  /** Preview-key strategy supplied by the host; defaults to still images only. */
  assetKey?: (item: BoardItem) => string | null;
  maxEdge?: number;
  maxPixels?: number;
};

export type BoardExportWarning =
  | { kind: "scale-clamped"; requested: number; applied: number }
  | { kind: "images-missing"; keys: string[] }
  | { kind: "many-items"; count: number };

export type BoardExportResult = {
  canvas: ICanvas;
  plan: BoardExportPlan;
  warnings: BoardExportWarning[];
};

function resolveBackground(
  background: BoardExportBackground | undefined,
  palette: BoardRenderPalette,
): number | null {
  if (background === "transparent") return null;
  if (typeof background === "number") return background;
  return palette.bg;
}

/**
 * Capture a board region as a canvas.
 *
 * Returns null when the region is empty — an empty selection is a no-op, not a
 * failure. The scene is always destroyed, so a throwing renderer cannot leak
 * GPU resources.
 */
export function renderBoardExport(
  renderer: Renderer,
  input: BoardDocument,
  options: BoardExportOptions = {},
): BoardExportResult | null {
  const document = normalizeBoardDocument(input);
  const plan = planBoardExport({
    document,
    region: options.region ?? { kind: "all" },
    scale: options.scale,
    padding: options.padding,
    maxEdge: options.maxEdge,
    maxPixels: options.maxPixels,
  });
  if (!plan) return null;

  const colorScheme = options.colorScheme ?? "dark";
  const palette = { ...defaultBoardPalette(colorScheme), ...options.palette };
  const scene = createBoardExportScene({
    document,
    items: plan.items,
    world: plan.world,
    scale: plan.scale,
    colorScheme,
    palette,
    colors: options.colors,
    textures: options.textures,
    assetKey: options.assetKey,
    background: resolveBackground(options.background, palette),
  });

  try {
    // The scene is already laid out in output pixels, so the frame is the plan's
    // size at resolution 1 — no second scaling step to keep in sync.
    const canvas = renderer.extract.canvas({
      target: scene.root,
      frame: new Rectangle(0, 0, plan.width, plan.height),
      resolution: 1,
      antialias: true,
      clearColor: options.background === "transparent" ? undefined : palette.bg,
    });

    const warnings: BoardExportWarning[] = [];
    if (plan.clamped) {
      warnings.push({
        kind: "scale-clamped",
        requested: plan.requestedScale,
        applied: plan.scale,
      });
    }
    if (scene.missingImageKeys.length > 0) {
      warnings.push({ kind: "images-missing", keys: scene.missingImageKeys });
    }
    if (plan.items.length > BOARD_EXPORT_ITEM_WARN_THRESHOLD) {
      warnings.push({ kind: "many-items", count: plan.items.length });
    }
    return { canvas, plan, warnings };
  } finally {
    scene.destroy();
  }
}

/** Human-readable form of a warning, shared by the CLI and the web UI. */
export function describeBoardExportWarning(warning: BoardExportWarning): string {
  switch (warning.kind) {
    case "scale-clamped":
      return `Scale reduced from ${warning.requested}x to ${warning.applied.toFixed(2)}x to stay within the size limit.`;
    case "images-missing":
      return warning.keys.length === 1
        ? "1 image could not be loaded and was drawn as a placeholder."
        : `${warning.keys.length} images could not be loaded and were drawn as placeholders.`;
    case "many-items":
      return `${warning.count} items exported; this may take a moment.`;
  }
}
