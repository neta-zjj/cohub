import assert from "node:assert/strict";
import { test } from "node:test";
import { BoardItemSchema } from "./src/board-document.js";

const frame = { x: 0, y: 0, width: 100, height: 40, rotation: 0 };

test("Board item schemas share the deliberate tool defaults", () => {
	const text = BoardItemSchema.parse({
		id: "text",
		type: "text",
		text: "Hello",
		frame,
	});
	assert.equal(text.type === "text" ? text.fontSize : null, 24);

	const draw = BoardItemSchema.parse({
		id: "draw",
		type: "draw",
		points: [],
		frame,
	});
	assert.equal(draw.type === "draw" ? draw.size : null, 4);

	const arrow = BoardItemSchema.parse({
		id: "arrow",
		type: "arrow",
		start: { kind: "point", x: 0, y: 0 },
		end: { kind: "point", x: 100, y: 0 },
		frame,
	});
	assert.equal(arrow.type === "arrow" ? arrow.size : null, 2.5);
});
