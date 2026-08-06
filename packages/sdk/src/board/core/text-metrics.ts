import {
  BOARD_TEXT_FONT_FAMILY,
  BOARD_TEXT_FONT_SIZE,
  BOARD_TEXT_LINE_HEIGHT,
  BOARD_TEXT_MAX_FONT_SIZE,
  BOARD_TEXT_MIN_FONT_SIZE,
} from "@cohub/protocol/board-constants";

export const TEXT_FONT_FAMILY = BOARD_TEXT_FONT_FAMILY;
export const TEXT_FONT_SIZE = BOARD_TEXT_FONT_SIZE;
export const TEXT_LINE_HEIGHT = BOARD_TEXT_LINE_HEIGHT;
export const TEXT_MIN_FONT_SIZE = BOARD_TEXT_MIN_FONT_SIZE;
export const TEXT_MAX_FONT_SIZE = BOARD_TEXT_MAX_FONT_SIZE;

const TEXT_LINE_HEIGHT_RATIO = TEXT_LINE_HEIGHT / TEXT_FONT_SIZE;
const TEXT_MIN_WIDTH_RATIO = 16 / TEXT_FONT_SIZE;
const TEXT_HORIZONTAL_PADDING_RATIO = 2 / TEXT_FONT_SIZE;
const FALLBACK_CHARACTER_RATIO = 0.52;

type BoardTextMeasurer = (text: string, fontSize: number) => number | null;

let textMeasurer: BoardTextMeasurer | undefined;

/** Install the renderer's text measurer, or clear it for environment-free fallback metrics. */
export function setBoardTextMeasurer(measurer?: BoardTextMeasurer): void {
  textMeasurer = measurer;
}

export function clampBoardTextFontSize(fontSize: number): number {
  return Math.min(TEXT_MAX_FONT_SIZE, Math.max(TEXT_MIN_FONT_SIZE, fontSize));
}

export function boardTextLineHeight(fontSize: number): number {
  return clampBoardTextFontSize(fontSize) * TEXT_LINE_HEIGHT_RATIO;
}

/** Measure unwrapped plain text into scalable world-space bounds. */
export function measureBoardText(
  text: string,
  fontSize = TEXT_FONT_SIZE,
): { width: number; height: number } {
  const size = clampBoardTextFontSize(fontSize);
  const lines = (text || " ").split("\n");
  const minWidth = size * TEXT_MIN_WIDTH_RATIO;
  const horizontalPadding = size * TEXT_HORIZONTAL_PADDING_RATIO;
  const lineHeight = boardTextLineHeight(size);
  const characterWidth = size * FALLBACK_CHARACTER_RATIO;
  let width = minWidth;

  for (const line of lines) {
    const value = line || " ";
    const measured = textMeasurer?.(value, size);
    width = Math.max(
      width,
      (measured ?? Math.max(1, value.length) * characterWidth) + horizontalPadding,
    );
  }

  return {
    width,
    height: Math.max(lineHeight, lines.length * lineHeight),
  };
}
