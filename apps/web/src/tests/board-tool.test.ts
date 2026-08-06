import assert from "node:assert/strict";
import { test } from "node:test";
import {
	BOARD_HAND_TAP_SLOP,
	type BoardToolId,
	canTapSelectWithHand,
	defaultBoardTool,
	isContinuousBoardTool,
	isWithinHandTapSlop,
} from "$lib/board/board-tool";

test("mobile boards start in Hand while desktop boards start in Select", () => {
	assert.equal(defaultBoardTool(true), "hand");
	assert.equal(defaultBoardTool(false), "select");
});

test("Hand tap selection is limited to direct pointers", () => {
	assert.equal(canTapSelectWithHand("touch"), true);
	assert.equal(canTapSelectWithHand("pen"), true);
	assert.equal(canTapSelectWithHand("mouse"), false);
	assert.equal(BOARD_HAND_TAP_SLOP, 8);
	assert.equal(isWithinHandTapSlop(5, 3), true);
	assert.equal(isWithinHandTapSlop(8, 0), true);
	assert.equal(isWithinHandTapSlop(8, 1), false);
	assert.equal(isWithinHandTapSlop(Number.NaN, 0), false);
});

test("only Draw stays active after creating an item", () => {
	const tools: BoardToolId[] = [
		"select",
		"hand",
		"text",
		"geo",
		"draw",
		"arrow",
		"frame",
	];

	for (const tool of tools) {
		assert.equal(isContinuousBoardTool(tool), tool === "draw", tool);
	}
});
