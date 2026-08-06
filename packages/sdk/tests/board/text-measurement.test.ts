import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { BoardItem } from "@cohub/protocol/board-document";
import { measureBoardText } from "../../src/board/core/text-metrics.js";
import type { BoardRenderContext } from "../../src/board/render/index.js";

/**
 * The model measures text through an injected measurer, falling back to a
 * per-character estimate when none is installed. That fallback is off by ~90%
 * for real text, so anything that draws must be routed through the canvas
 * measurer — and a consumer of `@neta-art/cohub/board/render` must not have to
 * know that. This pins the invariant: touching the renderer factory is enough.
 *
 * Module state is per file under `node:test`, so this file must observe the
 * pre-install fallback before importing the registry.
 */

let canvas: typeof import("@napi-rs/canvas") | null = null;
try {
  canvas = await import("@napi-rs/canvas");
} catch {
  canvas = null;
}

describe("board text measurement", { skip: canvas ? false : "@napi-rs/canvas is not installed" }, () => {
  test("getBoardCardRenderer installs the canvas measurer", async () => {
    const canvasModule = canvas as NonNullable<typeof canvas>;
    const { DOMAdapter } = await import("pixi.js");
    DOMAdapter.set({
      createCanvas: (width = 1, height = 1) =>
        canvasModule.createCanvas(Math.max(1, width), Math.max(1, height)) as never,
      createImage: () => new canvasModule.Image() as never,
      getCanvasRenderingContext2D: () =>
        (canvasModule.createCanvas(1, 1).getContext("2d") as { constructor: unknown })
          .constructor as never,
      getWebGLRenderingContext: () => ({}) as never,
      getNavigator: () => ({ userAgent: "cohub-test", gpu: null }),
      getBaseUrl: () => "file://",
      getFontFaceSet: () => null,
      fetch: (url, init) => fetch(url as string | URL, init),
      parseXML: () => {
        throw new Error("not available");
      },
    });

    // A canvas is reachable, but nothing has routed measurement through it yet.
    const fallback = measureBoardText("测试文本", 16).width;

    // Exactly what a consumer does: import the renderer factory and use it.
    const { getBoardCardRenderer } = await import("../../src/board/render/index.js");
    const item = {
      id: "t1",
      type: "text",
      text: "测试文本",
      fontSize: 16,
      color: "brand",
      frame: { x: 0, y: 0, width: 100, height: 40, rotation: 0 },
    } as BoardItem;
    getBoardCardRenderer(item, { zoom: 1 } as BoardRenderContext);

    const measured = measureBoardText("测试文本", 16).width;
    assert.notEqual(
      measured,
      fallback,
      "expected the canvas measurer to replace the fallback estimate",
    );
    // CJK glyphs are about one em wide, so the estimate undershoots badly.
    assert.ok(
      measured > fallback,
      `expected canvas width ${measured} to exceed the estimate ${fallback}`,
    );
  });
});
