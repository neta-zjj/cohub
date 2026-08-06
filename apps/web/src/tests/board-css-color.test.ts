import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	BOARD_COLORS,
	boardColorCssVar,
	buildFallbackShapeColors,
	isBoardColorId,
	pickBoardColor,
	resolveBoardColor,
} from "@neta-art/cohub/board";
import {
	hexNumberToCss,
	parseCssColorToNumber,
	readCssColorNumber,
} from "$lib/board/core/css-color";

describe("board css color parsing", () => {
	it("parses hex and rgb forms", () => {
		assert.equal(parseCssColorToNumber("#ff5a1f"), 0xff5a1f);
		assert.equal(parseCssColorToNumber("#abc"), 0xaabbcc);
		assert.equal(parseCssColorToNumber("rgb(56, 189, 248)"), 0x38bdf8);
		assert.equal(parseCssColorToNumber("rgba(56 189 248 / 0.8)"), 0x38bdf8);
		assert.equal(parseCssColorToNumber("rgb(100% 0% 0%)"), 0xff0000);
		assert.equal(parseCssColorToNumber("color(srgb 0.1 0.2 0.3)"), 0x1a334d);
		assert.equal(
			parseCssColorToNumber("color(srgb 100% 0% 50% / 0.4)"),
			0xff0080,
		);
		assert.equal(parseCssColorToNumber(""), null);
		assert.equal(parseCssColorToNumber("not-a-color"), null);
	});

	it("uses the fallback when no DOM is available", () => {
		assert.equal(readCssColorNumber(null, "--test-color", 0xaabbcc), 0xaabbcc);
	});

	it("round-trips hex numbers", () => {
		assert.equal(hexNumberToCss(0xff5a1f), "#ff5a1f");
		assert.equal(hexNumberToCss(0x0), "#000000");
	});
});

describe("board shape palette tokens", () => {
	it("exposes stable CSS var names", () => {
		assert.equal(
			boardColorCssVar("brand", "stroke"),
			"--board-color-brand-stroke",
		);
		assert.equal(boardColorCssVar("blue", "fill"), "--board-color-blue-fill");
		assert.equal(boardColorCssVar("rose", "label"), "--board-color-rose-label");
		assert.equal(
			boardColorCssVar("black", "stroke"),
			"--board-color-black-stroke",
		);
		assert.equal(boardColorCssVar("white", "fill"), "--board-color-white-fill");
	});

	it("includes black and white colors", () => {
		assert.equal(isBoardColorId("black"), true);
		assert.equal(isBoardColorId("white"), true);
		assert.equal(
			BOARD_COLORS.find((color) => color.id === "black")?.label,
			"Black",
		);
		assert.equal(
			BOARD_COLORS.find((color) => color.id === "white")?.label,
			"White",
		);

		for (const mode of ["dark", "light"] as const) {
			assert.equal(resolveBoardColor("black", mode).stroke, 0x000000);
			assert.equal(resolveBoardColor("black", mode).fill, 0x000000);
			assert.equal(resolveBoardColor("white", mode).stroke, 0xffffff);
			assert.equal(resolveBoardColor("white", mode).fill, 0xffffff);
		}
	});

	it("falls back to hard-coded tables without live colors", () => {
		const dark = resolveBoardColor("blue", "dark");
		const light = resolveBoardColor("blue", "light");
		assert.equal(dark.stroke, 0x38bdf8);
		assert.equal(light.stroke, 0x2563eb);
		assert.equal(
			resolveBoardColor("unknown", "dark").stroke,
			resolveBoardColor("brand", "dark").stroke,
		);
	});

	it("prefers live shape colors when provided", () => {
		const colors = buildFallbackShapeColors("dark");
		colors.blue = { stroke: 0x112233, fill: 0x112233, label: 0xffffff };
		assert.equal(pickBoardColor(colors, "blue", "dark").stroke, 0x112233);
		assert.equal(
			pickBoardColor(colors, "missing", "dark").stroke,
			colors.brand.stroke,
		);
	});
});
