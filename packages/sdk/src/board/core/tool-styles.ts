import {
	BOARD_ARROW_STROKE_SIZE,
	BOARD_DRAW_STROKE_SIZE,
} from "@cohub/protocol/board-constants";
import {
	type BoardColorId,
	isBoardColorId,
} from "./palette.js";
import { type GeoKind, isGeoKind } from "./shape-types.js";

export const BOARD_STROKE_MIN_SIZE = 1;
export const BOARD_STROKE_MAX_SIZE = 64;

export type BoardToolStyleMap = {
	text: { color: BoardColorId };
	geo: { color: BoardColorId; geo: GeoKind };
	draw: { color: BoardColorId; size: number };
	arrow: { color: BoardColorId; size: number };
	frame: { color: BoardColorId };
};

export type BoardStyledToolId = keyof BoardToolStyleMap;
export type BoardToolStylePatch = {
	[K in BoardStyledToolId]?: Partial<BoardToolStyleMap[K]>;
};

export const DEFAULT_BOARD_TOOL_STYLES = {
	text: { color: "neutral" },
	geo: { color: "brand", geo: "rectangle" },
	draw: { color: "brand", size: BOARD_DRAW_STROKE_SIZE },
	arrow: { color: "brand", size: BOARD_ARROW_STROKE_SIZE },
	frame: { color: "neutral" },
} as const satisfies BoardToolStyleMap;

function finiteOr(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function clampBoardStrokeSize(size: number): number {
	return Math.min(
		BOARD_STROKE_MAX_SIZE,
		Math.max(BOARD_STROKE_MIN_SIZE, size),
	);
}

/** Return a mutable, validated style map for an editor or another Board client. */
export function createBoardToolStyles(
	patch: BoardToolStylePatch = {},
): BoardToolStyleMap {
	const drawSize = clampBoardStrokeSize(
		finiteOr(patch.draw?.size, DEFAULT_BOARD_TOOL_STYLES.draw.size),
	);
	const arrowSize = clampBoardStrokeSize(
		finiteOr(patch.arrow?.size, DEFAULT_BOARD_TOOL_STYLES.arrow.size),
	);
	return {
		text: {
			color: isBoardColorId(patch.text?.color)
				? patch.text.color
				: DEFAULT_BOARD_TOOL_STYLES.text.color,
		},
		geo: {
			color: isBoardColorId(patch.geo?.color)
				? patch.geo.color
				: DEFAULT_BOARD_TOOL_STYLES.geo.color,
			geo: isGeoKind(patch.geo?.geo)
				? patch.geo.geo
				: DEFAULT_BOARD_TOOL_STYLES.geo.geo,
		},
		draw: {
			color: isBoardColorId(patch.draw?.color)
				? patch.draw.color
				: DEFAULT_BOARD_TOOL_STYLES.draw.color,
			size: drawSize,
		},
		arrow: {
			color: isBoardColorId(patch.arrow?.color)
				? patch.arrow.color
				: DEFAULT_BOARD_TOOL_STYLES.arrow.color,
			size: arrowSize,
		},
		frame: {
			color: isBoardColorId(patch.frame?.color)
				? patch.frame.color
				: DEFAULT_BOARD_TOOL_STYLES.frame.color,
		},
	};
}
