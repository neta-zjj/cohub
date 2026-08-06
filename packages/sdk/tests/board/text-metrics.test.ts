import assert from "node:assert/strict";
import { test } from "node:test";
import {
	boardTextLineHeight,
	measureBoardText,
	TEXT_FONT_SIZE,
} from "../../src/board/core/text-metrics.js";

/**
 * The inline editor resizes a text frame from these metrics on every keystroke,
 * so growth has to be monotonic in both axes and stable for empty input.
 */

test("width tracks the longest line", () => {
	const short = measureBoardText("ab").width;
	const long = measureBoardText("ab abcdefghij").width;
	assert.ok(long > short);
	// A trailing shorter line must not shrink the box below the longest line.
	assert.equal(measureBoardText("ab abcdefghij\nab").width, long);
});

test("height grows one line height per newline", () => {
	const lineHeight = boardTextLineHeight(TEXT_FONT_SIZE);
	assert.equal(measureBoardText("one").height, lineHeight);
	assert.equal(measureBoardText("one\ntwo").height, lineHeight * 2);
	// Blank lines still occupy a line, so the caret never leaves the frame.
	assert.equal(measureBoardText("one\n\nthree").height, lineHeight * 3);
});

test("empty input keeps a caret-sized frame", () => {
	const empty = measureBoardText("");
	assert.ok(empty.width > 0);
	assert.equal(empty.height, boardTextLineHeight(TEXT_FONT_SIZE));
});
