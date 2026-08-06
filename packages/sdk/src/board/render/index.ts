/**
 * PixiJS rendering for boards.
 *
 * The card renderers, the theme backgrounds and the text machinery that needs a
 * real canvas all live behind this entry, so `@neta-art/cohub/board` can stay a
 * pure model that runs without PixiJS. The browser editor and the headless
 * exporter both drive these renderers, which is what keeps an exported image
 * identical to what the editor draws.
 */

export * from "./palette.js";
export * from "./renderers/board-renderer-registry.js";
export * from "./text-measurement.js";
export * from "./text-resolution.js";
export * from "./themes/board-theme-registry.js";
