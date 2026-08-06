import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BoardAppearance } from "@neta-art/cohub/board";
import {
	type BoardThemeBackground,
	resolveBoardBackground,
} from "$lib/board/board-theme-background";

const themeBackground: BoardThemeBackground = {
	url: "https://neta.art/studio/board.webp",
	tileWidth: 1422,
	tileHeight: 1000,
};

function appearance(
	background: BoardAppearance["background"],
): BoardAppearance {
	return {
		theme: "clean",
		background,
		grid: { visible: false, size: 24, opacity: 0.12 },
		mood: "clean",
	};
}

describe("Board theme background precedence", () => {
	it("uses the theme backdrop for an untouched solid Board", () => {
		assert.deepEqual(
			resolveBoardBackground(appearance({ kind: "solid" }), themeBackground),
			themeBackground,
		);
	});

	it("keeps an explicitly declared image", () => {
		assert.deepEqual(
			resolveBoardBackground(
				appearance({
					kind: "image",
					imageUrl: "https://example.com/custom.webp",
				}),
				themeBackground,
			),
			{
				url: "https://example.com/custom.webp",
				tileWidth: null,
				tileHeight: null,
			},
		);
	});

	it("does not override explicit solid, grid, or dot backgrounds", () => {
		assert.equal(
			resolveBoardBackground(
				appearance({ kind: "solid", color: "#111111" }),
				themeBackground,
			),
			null,
		);
		assert.equal(
			resolveBoardBackground(appearance({ kind: "grid" }), themeBackground),
			null,
		);
		assert.equal(
			resolveBoardBackground(appearance({ kind: "dots" }), themeBackground),
			null,
		);
	});
});
