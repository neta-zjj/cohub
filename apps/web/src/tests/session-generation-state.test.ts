import assert from "node:assert/strict";
import { test } from "node:test";
import {
	emptyGenerationStreamResiduals,
	generationTurnChanged,
	removeGenerationStatesForSpace,
	resolveGenerationProgressResiduals,
	resolveGenerationStreamResiduals,
} from "../lib/stores/session-generation-state.ts";

const residuals = {
	contentBlocks: ["old answer"],
	intermediateMessages: ["old process"],
	streamMessageId: "turn:t1:assistant:1",
	messageOrdinal: 1,
	truncatedStart: true,
	patchSeq: 3,
	finalizedPreview: true,
};

test("turn changes require two distinct concrete ids", () => {
	assert.equal(generationTurnChanged("t1", "t2"), true);
	assert.equal(generationTurnChanged("t1", "t1"), false);
	assert.equal(generationTurnChanged(null, "t2"), false);
	assert.equal(generationTurnChanged("t1", null), false);
});

test("new turns clear every live stream residual", () => {
	assert.deepEqual(
		resolveGenerationStreamResiduals(residuals, true),
		emptyGenerationStreamResiduals(),
	);
	assert.deepEqual(
		resolveGenerationStreamResiduals(residuals, false),
		residuals,
	);
});

test("progress preserves same-turn residuals and resets omitted cross-turn fields", () => {
	const current = {
		intermediateMessages: residuals.intermediateMessages,
		streamMessageId: residuals.streamMessageId,
		messageOrdinal: residuals.messageOrdinal,
		truncatedStart: residuals.truncatedStart,
		patchSeq: residuals.patchSeq,
	};

	assert.deepEqual(
		resolveGenerationProgressResiduals(current, {}, false),
		current,
	);
	assert.deepEqual(resolveGenerationProgressResiduals(current, {}, true), {
		intermediateMessages: [],
		streamMessageId: null,
		messageOrdinal: null,
		truncatedStart: false,
		patchSeq: 0,
	});
	assert.deepEqual(
		resolveGenerationProgressResiduals(
			current,
			{ intermediateMessages: ["new process"], patchSeq: 1 },
			true,
		),
		{
			intermediateMessages: ["new process"],
			streamMessageId: null,
			messageOrdinal: null,
			truncatedStart: false,
			patchSeq: 1,
		},
	);
});

test("space reset partitions matching sessions without touching other spaces", () => {
	const states = {
		"session-a": { spaceId: "space-a", turnId: "turn-a" },
		"session-b": { spaceId: "space-b", turnId: "turn-b" },
		"session-c": { spaceId: "space-a", turnId: "turn-c" },
	};

	const result = removeGenerationStatesForSpace(states, "space-a");

	assert.deepEqual(result.removedSessionIds, ["session-a", "session-c"]);
	assert.deepEqual(result.remaining, {
		"session-b": { spaceId: "space-b", turnId: "turn-b" },
	});
});

test("space reset preserves the original state for an empty space id", () => {
	const states = {
		"session-a": { spaceId: "space-a", turnId: "turn-a" },
	};
	for (const spaceId of [null, undefined, ""] as const) {
		const result = removeGenerationStatesForSpace(states, spaceId);
		assert.equal(result.remaining, states);
		assert.deepEqual(result.removedSessionIds, []);
	}
});
