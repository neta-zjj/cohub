export type BoardRenderCost = {
  particles: number;
  vertices: number;
  dynamicVertices: number;
  drawCalls: number;
  filterPasses: number;
  renderTexturePixels: number;
  textureBytes: number;
  bufferBytes: number;
  simulationSteps: number;
};

export type BoardCapability = {
  kind: "preset" | "clip" | "effect" | "shader";
  id: string;
  version: number;
  digest?: string;
  renderers?: Array<"webgpu" | "webgl">;
  fallbackId?: string;
  schema?: Record<string, unknown>;
};

export const DEFAULT_BOARD_RENDER_LIMITS: BoardRenderCost = {
  particles: 20_000,
  vertices: 500_000,
  dynamicVertices: 150_000,
  drawCalls: 400,
  filterPasses: 24,
  renderTexturePixels: 16_777_216,
  textureBytes: 512 * 1024 * 1024,
  bufferBytes: 256 * 1024 * 1024,
  simulationSteps: 100_000,
};

export const BOARD_BUILTIN_CLIP_KINDS = [
  "motion.keyframes",
  "motion.path",
  "draw.reveal",
  "draw.handwrite",
  "text.reveal",
  "effects.particles",
  "effects.trail",
  "effects.impact",
  "effects.flash",
  "effects.color",
  "camera.pan",
  "camera.zoom",
  "camera.shake",
] as const;

export const BOARD_BUILTIN_EFFECT_KINDS = [
  "effects.pulse",
  "effects.float",
] as const;

/**
 * World-space typography for board text.
 *
 * These live here rather than beside the renderer because the document schema
 * constrains persisted font sizes with them, and the schema must not depend on
 * anything that draws.
 */
export const BOARD_TEXT_FONT_FAMILY = "Geist";
export const BOARD_TEXT_FONT_SIZE = 24;
export const BOARD_TEXT_LINE_HEIGHT = 32;
export const BOARD_TEXT_MIN_FONT_SIZE = 2;
export const BOARD_TEXT_MAX_FONT_SIZE = 512;
export const BOARD_DRAW_STROKE_SIZE = 4;
export const BOARD_ARROW_STROKE_SIZE = 2.5;

/**
 * Font stacks used by every board renderer.
 *
 * A bare "Geist" would render CJK (and anything else outside the Latin subset)
 * as missing-glyph boxes, because the shipped webfont is Latin-only. The stack
 * mirrors the web `--font-sans` / `--font-mono` tokens and adds the common CJK
 * families, so both the browser and a headless export fall back to a real face
 * instead of tofu.
 */
export const BOARD_FONT_STACK =
  '"Geist", system-ui, -apple-system, "Noto Sans CJK SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
export const BOARD_MONO_FONT_STACK =
  '"Geist Mono", "Fira Code", ui-monospace, "Noto Sans Mono CJK SC", monospace';

export const BOARD_BUILTIN_CAPABILITIES: BoardCapability[] = [
  ...BOARD_BUILTIN_CLIP_KINDS.map((id) => ({
    kind: "clip" as const,
    id,
    version: 1,
    renderers: ["webgpu", "webgl"] as Array<"webgpu" | "webgl">,
  })),
  ...BOARD_BUILTIN_EFFECT_KINDS.map((id) => ({
    kind: "effect" as const,
    id,
    version: 1,
    renderers: ["webgpu", "webgl"] as Array<"webgpu" | "webgl">,
  })),
];
