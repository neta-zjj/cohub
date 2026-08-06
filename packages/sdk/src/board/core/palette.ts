/**
 * Board color palette — a small, named set of shape colors shared by text,
 * geo, draw and arrow shapes. Colors are stored by id in shape props (never
 * raw hex), so themes and space `.cohub/theme.css` can remap them via CSS
 * tokens while persisted data stays compact and forward-compatible.
 *
 * Concrete values are resolved from CSS variables at render time:
 *   --board-color-{id}-stroke | -fill | -label
 * with hard-coded light/dark tables as offline / export fallbacks.
 */

export type BoardColorId =
	| "brand"
	| "neutral"
	| "black"
	| "white"
	| "blue"
	| "green"
	| "amber"
	| "violet"
	| "rose";

export type BoardColorValue = {
	/** Stroke / accent color (sRGB hex). */
	stroke: number;
	/** Translucent fill used behind shapes (sRGB hex). */
	fill: number;
	/** Readable label color on top of the fill. */
	label: number;
};

export type BoardColorEntry = {
	id: BoardColorId;
	label: string;
	dark: BoardColorValue;
	light: BoardColorValue;
};

/**
 * Label color fallbacks mirror `--board-color-*-label`, which every theme maps
 * to `--text-primary`: labels sit on a *translucent* fill over the page, not on
 * a saturated swatch, so a tinted label would be dark-on-dark. Keeping these in
 * step with `theme.css` is what makes a headless export match the screen.
 */
const LABEL_DARK = 0xf4f4f4;
const LABEL_LIGHT = 0x18181b;

export const BOARD_COLORS: readonly BoardColorEntry[] = [
	{
		id: "brand",
		label: "Brand",
		dark: { stroke: 0xff5a1f, fill: 0xff5a1f, label: LABEL_DARK },
		light: { stroke: 0xe8450e, fill: 0xe8450e, label: LABEL_LIGHT },
	},
	{
		id: "neutral",
		label: "Neutral",
		dark: { stroke: 0x9aa0a6, fill: 0x9aa0a6, label: LABEL_DARK },
		light: { stroke: 0x5f6368, fill: 0x5f6368, label: LABEL_LIGHT },
	},
	{
		id: "black",
		label: "Black",
		dark: { stroke: 0x000000, fill: 0x000000, label: LABEL_DARK },
		light: { stroke: 0x000000, fill: 0x000000, label: LABEL_LIGHT },
	},
	{
		id: "white",
		label: "White",
		dark: { stroke: 0xffffff, fill: 0xffffff, label: LABEL_DARK },
		light: { stroke: 0xffffff, fill: 0xffffff, label: LABEL_LIGHT },
	},
	{
		id: "blue",
		label: "Blue",
		dark: { stroke: 0x38bdf8, fill: 0x38bdf8, label: LABEL_DARK },
		light: { stroke: 0x2563eb, fill: 0x2563eb, label: LABEL_LIGHT },
	},
	{
		id: "green",
		label: "Green",
		dark: { stroke: 0x34d399, fill: 0x34d399, label: LABEL_DARK },
		light: { stroke: 0x16a34a, fill: 0x16a34a, label: LABEL_LIGHT },
	},
	{
		id: "amber",
		label: "Amber",
		dark: { stroke: 0xf59e0b, fill: 0xf59e0b, label: LABEL_DARK },
		light: { stroke: 0xd97706, fill: 0xd97706, label: LABEL_LIGHT },
	},
	{
		id: "violet",
		label: "Violet",
		dark: { stroke: 0xa78bfa, fill: 0xa78bfa, label: LABEL_DARK },
		light: { stroke: 0x7c3aed, fill: 0x7c3aed, label: LABEL_LIGHT },
	},
	{
		id: "rose",
		label: "Rose",
		dark: { stroke: 0xfb7185, fill: 0xfb7185, label: LABEL_DARK },
		light: { stroke: 0xe11d48, fill: 0xe11d48, label: LABEL_LIGHT },
	},
] as const;

export const DEFAULT_BOARD_COLOR: BoardColorId = "brand";

const COLOR_INDEX: ReadonlyMap<BoardColorId, BoardColorEntry> = new Map(
	BOARD_COLORS.map((entry) => [entry.id, entry]),
);

export function isBoardColorId(value: unknown): value is BoardColorId {
	return typeof value === "string" && COLOR_INDEX.has(value as BoardColorId);
}

export function boardColorCssVar(
	id: BoardColorId,
	part: keyof BoardColorValue,
): string {
	return `--board-color-${id}-${part}`;
}

/** Resolve a color id to concrete values for a color mode. Unknown → brand. */
export function resolveBoardColor(
	id: unknown,
	mode: "dark" | "light",
): BoardColorValue {
	const entry =
		(isBoardColorId(id) ? COLOR_INDEX.get(id) : undefined) ??
		COLOR_INDEX.get(DEFAULT_BOARD_COLOR);
	// COLOR_INDEX always has the default, so this is non-null.
	return (entry as BoardColorEntry)[mode];
}

export type BoardShapeColors = Record<BoardColorId, BoardColorValue>;

/** Build a full shape-color table from hard-coded fallbacks (export / SSR). */
export function buildFallbackShapeColors(
	mode: "dark" | "light",
): BoardShapeColors {
	const out = {} as BoardShapeColors;
	for (const entry of BOARD_COLORS) {
		out[entry.id] = entry[mode];
	}
	return out;
}

/**
 * Pick a concrete color from a live shape-color table, falling back to the
 * default brand entry when the id is unknown.
 */
export function pickBoardColor(
	colors: BoardShapeColors | null | undefined,
	id: unknown,
	mode: "dark" | "light" = "dark",
): BoardColorValue {
	if (colors && isBoardColorId(id) && colors[id]) return colors[id];
	if (colors) return colors[DEFAULT_BOARD_COLOR];
	return resolveBoardColor(id, mode);
}
