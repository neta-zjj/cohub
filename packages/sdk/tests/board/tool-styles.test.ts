import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createBoardToolStyles,
	DEFAULT_BOARD_TOOL_STYLES,
	TEXT_FONT_SIZE,
	TEXT_LINE_HEIGHT,
} from "../../src/board/index.js";

test("Board tools expose deliberate per-tool defaults", () => {
	assert.equal(TEXT_FONT_SIZE, 24);
	assert.equal(TEXT_LINE_HEIGHT, 32);
	assert.deepEqual(createBoardToolStyles(), DEFAULT_BOARD_TOOL_STYLES);
	assert.equal(DEFAULT_BOARD_TOOL_STYLES.text.color, "neutral");
	assert.equal(DEFAULT_BOARD_TOOL_STYLES.frame.color, "neutral");
	assert.equal(DEFAULT_BOARD_TOOL_STYLES.geo.color, "brand");
});

test("Board tool style patches are validated and clamped", () => {
	const styles = createBoardToolStyles({
		text: { color: "rose" },
		geo: { geo: "ellipse" },
		draw: { size: 1_000 },
		arrow: { size: Number.NaN },
	});
	assert.equal(styles.text.color, "rose");
	assert.equal(styles.geo.geo, "ellipse");
	assert.equal(styles.draw.size, 64);
	assert.equal(styles.arrow.size, DEFAULT_BOARD_TOOL_STYLES.arrow.size);
});

test("each editor receives an independent mutable style map", () => {
	const first = createBoardToolStyles();
	const second = createBoardToolStyles();
	first.text.color = "rose";
	first.geo.color = "green";
	assert.equal(second.text.color, "neutral");
	assert.equal(second.geo.color, "brand");
});
