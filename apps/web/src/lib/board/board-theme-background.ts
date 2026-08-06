import type { BoardAppearance } from "@neta-art/cohub/board";

export type BoardThemeBackground = {
	url: string;
	tileWidth: number | null;
	tileHeight: number | null;
};

export function resolveBoardBackground(
	appearance: BoardAppearance,
	themeBackground: BoardThemeBackground | null,
): BoardThemeBackground | null {
	const declared = appearance.background;
	if (declared.kind === "image" && declared.imageUrl) {
		return { url: declared.imageUrl, tileWidth: null, tileHeight: null };
	}
	// Theme imagery only fills the untouched clean background. Explicit Board
	// appearance always wins and is never rewritten.
	if (declared.kind !== "solid" || declared.color) return null;
	return themeBackground;
}
