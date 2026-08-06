/**
 * Headless board rendering for Node.
 *
 * PixiJS is a browser library, but v8 ships a Canvas2D backend
 * (`CanvasRenderer`) that needs no GPU context at all. Pointing it at
 * `@napi-rs/canvas` through Pixi's `DOMAdapter` gives Node the same renderers
 * the editor uses — so `cohub boards export` is not a second implementation of
 * how a board looks, it is the same one.
 *
 * `@napi-rs/canvas` is an optional dependency: it carries a large prebuilt Skia
 * binary and only image export needs it, so it is imported lazily and its
 * absence produces an actionable message rather than a crash at startup.
 */

import type { BoardDocument } from "@cohub/protocol/board-document";
import { BOARD_TEXT_FONT_FAMILY } from "@cohub/protocol/board-constants";
import type { Adapter, ICanvas, Renderer, Texture } from "pixi.js";
import { installBoardTextMeasurement } from "../render/text-measurement.js";
import {
  type BoardExportOptions,
  type BoardExportResult,
  renderBoardExport,
} from "../export/index.js";

export type HeadlessCanvasModule = {
  createCanvas: (width: number, height: number) => unknown;
  Image: new () => unknown;
  GlobalFonts: {
    registerFromPath: (path: string, name?: string) => unknown;
    has: (name: string) => boolean;
  };
};

export type BoardHeadlessFont = {
  /** Absolute path to a font file (woff2, ttf and otf all work). */
  path: string;
  /** Family name renderers should ask for. Defaults to the board text family. */
  family?: string;
};

export type BoardHeadlessRendererOptions = {
  /**
   * Fonts to register before the first measurement. Board text asks for
   * "Geist"; without a matching family the platform substitutes one, which
   * changes glyph shapes and text metrics.
   */
  fonts?: BoardHeadlessFont[];
  /** Override the canvas module (tests, or a pre-imported instance). */
  canvasModule?: HeadlessCanvasModule;
};

/**
 * A decoded image, opaque to callers.
 *
 * Node consumers (the CLI) should not need PixiJS in their own type surface just
 * to hand textures back to the exporter, so the concrete `Texture` stays inside
 * this module.
 */
export type BoardHeadlessTexture = { readonly __boardTexture: unique symbol };

export type BoardHeadlessRenderer = {
  renderer: Renderer;
  canvasModule: HeadlessCanvasModule;
  /** Decode image bytes into a texture the exporter accepts. */
  decodeImage: (bytes: Uint8Array, mimeType?: string) => Promise<BoardHeadlessTexture>;
  destroy: () => void;
};

/**
 * A minimal WebGL stand-in.
 *
 * `ParticleContainerPipe` builds a `GlProgram` when the renderer registers its
 * pipes, and that probes shader precision through a throwaway context — even
 * though the Canvas2D backend never draws with it. Returning a stub keeps
 * registration working; nothing here is ever used to render.
 */
const WEBGL_PROBE_STUB = {
  getShaderPrecisionFormat: () => ({ precision: 1, rangeMin: 1, rangeMax: 1 }),
  getExtension: () => null,
  getParameter: () => 0,
};

function isWebGLContext(kind: string): boolean {
  return kind.startsWith("webgl") || kind === "experimental-webgl";
}

async function loadCanvasModule(): Promise<HeadlessCanvasModule> {
  try {
    return (await import("@napi-rs/canvas")) as unknown as HeadlessCanvasModule;
  } catch (cause) {
    throw new Error(
      "Board image export needs the optional '@napi-rs/canvas' package. Install it with: npm i @napi-rs/canvas",
      { cause },
    );
  }
}

/** Node has no rAF; Pixi's scheduler only needs a callback pump. */
function installAnimationFrameShim(): () => void {
  const globals = globalThis as {
    requestAnimationFrame?: (cb: (t: number) => void) => unknown;
    cancelAnimationFrame?: (id: unknown) => void;
  };
  if (globals.requestAnimationFrame) return () => {};
  const timers = new Set<ReturnType<typeof setTimeout>>();
  globals.requestAnimationFrame = (cb) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      cb(Date.now());
    }, 16);
    // Unref so a pending frame can never keep the process alive after export.
    timer.unref?.();
    timers.add(timer);
    return timer;
  };
  globals.cancelAnimationFrame = (id) => {
    clearTimeout(id as ReturnType<typeof setTimeout>);
    timers.delete(id as ReturnType<typeof setTimeout>);
  };
  return () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    globals.requestAnimationFrame = undefined;
    globals.cancelAnimationFrame = undefined;
  };
}

/**
 * Create a Canvas2D renderer backed by Skia.
 *
 * `skipExtensionImports` is essential: it stops Pixi from auto-loading its
 * browser environment bundle, which would pull in DOM-only pipes.
 */
export async function createBoardHeadlessRenderer(
  options: BoardHeadlessRendererOptions = {},
): Promise<BoardHeadlessRenderer> {
  const canvasModule = options.canvasModule ?? (await loadCanvasModule());
  const {
    CanvasGraphicsContextSystem,
    CanvasGraphicsPipe,
    CanvasRenderer,
    CanvasRendererTextSystem,
    CanvasTextPipe,
    CanvasTextSystem,
    DOMAdapter,
    extensions,
    GraphicsContextSystem,
    GraphicsPipe,
    ImageSource,
    Texture,
  } = await import("pixi.js");

  // Pixi's environment auto-detection would load its browser bundle here (its
  // test always passes), which registers DOM pipes and fails on `document`. So
  // `skipExtensionImports` is set below and the canvas-safe pipes for the shapes
  // boards actually draw — graphics and text — are registered explicitly. They
  // come from the package root rather than `pixi.js/graphics`, which ships no
  // type declarations.
  extensions.add(
    CanvasGraphicsPipe,
    GraphicsPipe,
    CanvasGraphicsContextSystem,
    GraphicsContextSystem,
    CanvasRendererTextSystem,
    CanvasTextSystem,
    CanvasTextPipe,
  );

  for (const font of options.fonts ?? []) {
    canvasModule.GlobalFonts.registerFromPath(font.path, font.family ?? BOARD_TEXT_FONT_FAMILY);
  }

  function createCanvas(width = 1, height = 1) {
    const canvas = canvasModule.createCanvas(
      Math.max(1, Math.ceil(width)),
      Math.max(1, Math.ceil(height)),
    ) as {
      getContext: (kind: string, ...rest: unknown[]) => unknown;
    };
    const nativeGetContext = canvas.getContext.bind(canvas);
    canvas.getContext = (kind: string, ...rest: unknown[]) =>
      isWebGLContext(String(kind)) ? WEBGL_PROBE_STUB : nativeGetContext(kind, ...rest);
    return canvas;
  }

  const adapter: Adapter = {
    createCanvas: (width, height) => createCanvas(width, height) as unknown as ICanvas,
    createImage: () => new canvasModule.Image() as never,
    getCanvasRenderingContext2D: () =>
      (createCanvas(1, 1).getContext("2d") as { constructor: unknown })
        .constructor as never,
    getWebGLRenderingContext: () => WEBGL_PROBE_STUB as never,
    getNavigator: () => ({ userAgent: "cohub-board-headless", gpu: null }),
    getBaseUrl: () => "file://",
    getFontFaceSet: () => null,
    fetch: (url, init) => fetch(url as string | URL, init),
    parseXML: () => {
      throw new Error("XML parsing is not available in headless board export.");
    },
  };
  DOMAdapter.set(adapter);
  // Route measurement through the adapter just installed; any cached context
  // belongs to the previous environment.
  installBoardTextMeasurement();

  const restoreAnimationFrame = installAnimationFrameShim();
  const renderer = new CanvasRenderer();
  await renderer.init({
    // Sized per export via the extract frame; this is just a valid initial view.
    width: 1,
    height: 1,
    backgroundAlpha: 0,
    antialias: true,
    resolution: 1,
    skipExtensionImports: true,
  });

  return {
    renderer: renderer as unknown as Renderer,
    canvasModule,
    decodeImage: async (bytes, mimeType = "image/png") => {
      const image = new canvasModule.Image() as {
        src: string;
        width: number;
        height: number;
        onload?: () => void;
        onerror?: (error: unknown) => void;
      };
      const base64 = Buffer.from(bytes).toString("base64");
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = (error) => reject(error);
        image.src = `data:${mimeType};base64,${base64}`;
      });
      // `ImageSource.test` only recognises browser image types, so the source is
      // constructed explicitly rather than through `Texture.from`.
      return new Texture({
        source: new ImageSource({
          resource: image as never,
          width: image.width,
          height: image.height,
        }),
      }) as unknown as BoardHeadlessTexture;
    },
    destroy: () => {
      renderer.destroy();
      restoreAnimationFrame();
    },
  };
}

export type BoardHeadlessExportFormat = "png" | "jpeg" | "webp";

export type BoardHeadlessExportOptions = Omit<BoardExportOptions, "textures"> & {
  /** Textures from `decodeImage`, keyed by image key. */
  textures?: Map<string, BoardHeadlessTexture>;
  format?: BoardHeadlessExportFormat;
  /** JPEG/WebP quality, 0–1. Ignored for PNG. */
  quality?: number;
};

export type BoardHeadlessExportResult = Omit<BoardExportResult, "canvas"> & {
  bytes: Uint8Array;
  format: BoardHeadlessExportFormat;
};

const MIME: Record<BoardHeadlessExportFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export function boardHeadlessMimeType(format: BoardHeadlessExportFormat): string {
  return MIME[format];
}

/** Render a document to encoded image bytes. Returns null for an empty region. */
export function exportBoardImageBytes(
  headless: BoardHeadlessRenderer,
  document: BoardDocument,
  options: BoardHeadlessExportOptions = {},
): BoardHeadlessExportResult | null {
  const { format = "png", quality = 0.92, textures, ...rest } = options;
  const result = renderBoardExport(headless.renderer, document, {
    ...rest,
    ...(textures ? { textures: textures as unknown as Map<string, Texture> } : {}),
  });
  if (!result) return null;
  const canvas = result.canvas as unknown as {
    toBuffer: (mime: string, quality?: number) => Buffer;
  };
  const bytes =
    format === "png"
      ? canvas.toBuffer(MIME.png)
      : canvas.toBuffer(MIME[format], Math.round(quality * 100));
  return { bytes: new Uint8Array(bytes), plan: result.plan, warnings: result.warnings, format };
}
