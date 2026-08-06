import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardItem } from "@cohub/protocol/board-document";
import { selectBoardExportAssets } from "../../src/board/core/export-assets.js";

function image(id: string, path: string): BoardItem {
  return {
    id,
    type: "image",
    ref: { kind: "space-file", path },
    frame: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
  };
}

const assetKey = (item: BoardItem) =>
  item.type === "image" ? `file:${item.ref.path}` : null;

test("export asset selection deduplicates and caps previews in document order", () => {
  const selection = selectBoardExportAssets(
    [image("a", "a.png"), image("a-copy", "a.png"), image("b", "b.png"), image("c", "c.png")],
    assetKey,
    2,
  );

  assert.deepEqual(selection.items.map((item) => item.id), ["a", "b"]);
  assert.deepEqual(selection.keys, ["file:a.png", "file:b.png"]);
  assert.deepEqual(selection.omittedKeys, ["file:c.png"]);
});

test("export asset selection tolerates invalid and zero limits", () => {
  const items = [image("a", "a.png")];
  assert.deepEqual(selectBoardExportAssets(items, assetKey, 0).omittedKeys, ["file:a.png"]);
  assert.deepEqual(selectBoardExportAssets(items, assetKey, Number.NaN).keys, ["file:a.png"]);
});
