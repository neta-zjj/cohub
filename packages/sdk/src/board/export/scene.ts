/**
 * Build a throwaway Pixi scene for one export.
 *
 * This drives the *same* card renderers the editor uses, which is the whole
 * point: there is no second drawing implementation to drift. Unlike the live
 * scene it is deliberately naive — no culling, no pooling, no far LOD — because
 * an export must be complete and runs once, so every optimisation the editor
 * needs here would only cost fidelity.
 */

import type { BoardDocument, BoardItem } from "@cohub/protocol/board-document";
import { Container, Graphics, type Texture } from "pixi.js";
import type { BoardShapeColors } from "../core/palette.js";
import { buildFallbackShapeColors } from "../core/palette.js";
import { imageAssetKey } from "../image-key.js";
import {
  type BoardRenderContext,
  type BoardRenderPalette,
  defaultBoardPalette,
  getBoardCardRenderer,
} from "../render/index.js";
import type { Rect } from "../geometry.js";

export type BoardExportSceneInput = {
  document: BoardDocument;
  /** Items to draw, in document (z) order. */
  items: BoardItem[];
  /** World rect being captured; content is translated so it starts at 0,0. */
  world: Rect;
  /** Output pixels per world unit. Drives text rasterisation resolution. */
  scale: number;
  colorScheme: "dark" | "light";
  palette?: Partial<BoardRenderPalette>;
  colors?: BoardShapeColors;
  /** Resolved textures by preview key. Missing keys render as placeholders. */
  textures?: Map<string, Texture>;
  /** Preview-key strategy supplied by the host; defaults to still images only. */
  assetKey?: (item: BoardItem) => string | null;
  /** Opaque paper behind the content, or null for transparency. */
  background?: number | null;
};

export type BoardExportScene = {
  /** Root to hand to the renderer; already positioned and scaled. */
  root: Container;
  /** Image keys the scene wanted but could not resolve. */
  missingImageKeys: string[];
  destroy: () => void;
};

/**
 * Render context for an export.
 *
 * Interaction state is empty by construction: nothing is selected, hovered or
 * resizing, so no editor chrome (outlines, handles) can leak into the image.
 */
function buildContext(input: BoardExportSceneInput): {
  context: BoardRenderContext;
  missing: Set<string>;
} {
  const missing = new Set<string>();
  const byId = new Map(input.document.items.map((item) => [item.id, item]));
  const textures = input.textures ?? new Map<string, Texture>();
  const context: BoardRenderContext = {
    document: input.document,
    getItem: (id) => byId.get(id) ?? null,
    selectedIds: new Set(),
    hoveredId: null,
    resizingIds: new Set(),
    palette: { ...defaultBoardPalette(input.colorScheme), ...input.palette },
    colors: input.colors ?? buildFallbackShapeColors(input.colorScheme),
    colorScheme: input.colorScheme,
    // Text rasterises against this, so passing the export scale (not the
    // editor's camera zoom) is what keeps exported glyphs crisp at any factor.
    zoom: input.scale,
    assetKey: input.assetKey ?? imageAssetKey,
    getTexture: (key) => textures.get(key) ?? null,
    hasError: (key) => {
      // An unresolved key is reported rather than retried: the exporter has
      // already had its chance to load everything it could.
      if (!textures.has(key)) missing.add(key);
      return false;
    },
    fileState: () => "ok",
    acquireTexture: () => {},
    releaseTexture: () => {},
  };
  return { context, missing };
}

export function createBoardExportScene(input: BoardExportSceneInput): BoardExportScene {
  const { context, missing } = buildContext(input);
  const root = new Container({ label: "board-export-root" });

  if (input.background != null) {
    root.addChild(
      new Graphics()
        .rect(0, 0, input.world.width * input.scale, input.world.height * input.scale)
        .fill({ color: input.background, alpha: 1 }),
    );
  }

  // One render group: the whole export is a single transform, so the camera
  // offset and scale are applied once instead of per card.
  const world = new Container({ isRenderGroup: true, label: "board-export-world" });
  world.scale.set(input.scale);
  world.position.set(-input.world.x * input.scale, -input.world.y * input.scale);
  for (const item of input.items) {
    const renderer = getBoardCardRenderer(item, context);
    world.addChild(renderer.create(item, context));
  }
  root.addChild(world);

  return {
    root,
    missingImageKeys: [...missing],
    destroy: () => root.destroy({ children: true }),
  };
}
