import type { BoardItem } from "@cohub/protocol/board-document";

/** Bound source textures independently from the final output bitmap budget. */
export const BOARD_EXPORT_MAX_TEXTURES = 64;

export type BoardExportAssetSelection = {
  /** One representative item for each selected preview key. */
  items: BoardItem[];
  keys: string[];
  omittedKeys: string[];
};

/** Select a stable, document-ordered set of unique preview assets to load. */
export function selectBoardExportAssets(
  items: BoardItem[],
  assetKey: (item: BoardItem) => string | null,
  maxTextures = BOARD_EXPORT_MAX_TEXTURES,
): BoardExportAssetSelection {
  const limit = Number.isSafeInteger(maxTextures)
    ? Math.max(0, maxTextures)
    : BOARD_EXPORT_MAX_TEXTURES;
  const selected = new Map<string, BoardItem>();
  const omitted = new Set<string>();

  for (const item of items) {
    const key = assetKey(item);
    if (!key || selected.has(key) || omitted.has(key)) continue;
    if (selected.size < limit) selected.set(key, item);
    else omitted.add(key);
  }

  return {
    items: [...selected.values()],
    keys: [...selected.keys()],
    omittedKeys: [...omitted],
  };
}
