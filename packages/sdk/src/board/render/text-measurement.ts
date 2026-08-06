/**
 * Canvas-backed text measurement.
 *
 * Measurement goes through Pixi's `DOMAdapter` rather than `document`, so the
 * browser and a headless export produce the same numbers. The core metrics
 * module owns the layout maths and only borrows this measurer, which is what
 * lets `@neta-art/cohub/board` lay text out with no PixiJS installed.
 */

import { BOARD_FONT_STACK } from "@cohub/protocol/board-constants";
import { DOMAdapter } from "pixi.js";
import { setBoardTextMeasurer } from "../core/text-metrics.js";

type MeasureContext = {
  font: string;
  measureText: (text: string) => { width: number };
};

let measureContext: MeasureContext | null | undefined;
let installed = false;

function getMeasureContext(): MeasureContext | null {
  if (measureContext !== undefined) return measureContext;
  try {
    const canvas = DOMAdapter.get().createCanvas(1, 1);
    measureContext = (canvas.getContext("2d") as MeasureContext | null) ?? null;
  } catch {
    measureContext = null;
  }
  return measureContext;
}

function measureText(text: string, fontSize: number): number | null {
  const context = getMeasureContext();
  if (!context) return null;
  context.font = `500 ${fontSize}px ${BOARD_FONT_STACK}`;
  return context.measureText(text).width;
}

/**
 * Route board text measurement through the active Pixi DOM adapter.
 *
 * Call this after swapping the adapter (see `../headless`), which drops the
 * cached measuring context. Anything that goes through `getBoardCardRenderer`
 * is already covered by `ensureBoardTextMeasurement`.
 */
export function installBoardTextMeasurement(): void {
  measureContext = undefined;
  installed = true;
  setBoardTextMeasurer(measureText);
}

/**
 * Install the canvas measurer once, unless it already is.
 *
 * The core metrics module falls back to a per-character estimate when no
 * measurer is set, which is off by ~90% for real text — wrong enough to
 * misplace every label. Rather than make that a step consumers can forget, the
 * renderer registry calls this before handing a renderer out. It cannot be an
 * import-time side effect: the package is marked side-effect free, so a bundler
 * is entitled to drop a module whose only job happens at load time.
 */
export function ensureBoardTextMeasurement(): void {
  if (installed) return;
  installBoardTextMeasurement();
}
