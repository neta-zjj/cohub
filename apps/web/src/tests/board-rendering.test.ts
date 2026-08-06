import assert from "node:assert/strict";
import { test } from "node:test";
import {
	syncTextResolution,
	syncTextWrapWidth,
	textResolutionForZoom,
} from "@neta-art/cohub/board/render";
import type { Text } from "pixi.js";

test("syncTextResolution updates only when zoom crosses a bucket", () => {
	let writes = 0;
	let resolution = textResolutionForZoom(1);
	const text = {} as Text;
	Object.defineProperty(text, "resolution", {
		get: () => resolution,
		set: (value: number) => {
			resolution = value;
			writes += 1;
		},
	});
	const state = { resolution };

	syncTextResolution(text, state, 0.9);
	assert.equal(writes, 0);
	syncTextResolution(text, state, 2);
	assert.equal(writes, 1);
	assert.equal(state.resolution, textResolutionForZoom(2));
});

test("syncTextWrapWidth defers reflow until resize finishes", () => {
	const text = { style: { wordWrapWidth: 120 } } as Text;
	const state = { wrapWidth: 120 };

	syncTextWrapWidth(text, state, 240, true);
	assert.equal(text.style.wordWrapWidth, 120);
	assert.equal(state.wrapWidth, 120);

	syncTextWrapWidth(text, state, 240, false);
	assert.equal(text.style.wordWrapWidth, 240);
	assert.equal(state.wrapWidth, 240);
});
