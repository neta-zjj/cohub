import assert from "node:assert/strict";
import { test } from "node:test";
import type { ContentBlock } from "@cohub/protocol/core";
import { getSessionSidebarActivity } from "../lib/session-sidebar-activity";
import type { SessionGenerationState } from "../lib/stores/session-generation.svelte";

function streamingState(contentBlocks: ContentBlock[]): SessionGenerationState {
	return {
		sessionId: "session-a",
		spaceId: "space-a",
		status: "streaming",
		requestId: null,
		error: null,
		errorCode: null,
		contentBlocks,
		intermediateMessages: [],
		streamMessageId: null,
		messageOrdinal: null,
		anchorUserMessageId: null,
		truncatedStart: false,
		patchSeq: 1,
		turnId: "turn-a",
		runtimePhase: null,
		runtimePhaseAt: null,
		llmRound: null,
		runtimeProvider: null,
		runtimeModel: null,
		finalizedPreview: false,
		lastPatchAt: null,
	};
}

test("sidebar activity previews running tool partial output", () => {
	const activity = getSessionSidebarActivity(
		streamingState([
			{
				type: "tool_use",
				id: "tool-a",
				name: "bash",
				input: { command: "pnpm test" },
				_meta: {
					toolStatus: "running",
					partialResult: "first line\nsecond line",
				},
			},
		]),
	);

	assert.equal(activity.active, true);
	assert.equal(activity.phase, "result");
	assert.equal(activity.label, "bash");
	assert.equal(activity.text, "first line second line");
});

test("sidebar activity falls back to tool input before partial output", () => {
	const activity = getSessionSidebarActivity(
		streamingState([
			{
				type: "tool_use",
				id: "tool-a",
				name: "bash",
				input: { command: "pnpm test" },
				_meta: { toolStatus: "running" },
			},
		]),
	);

	assert.equal(activity.active, true);
	assert.equal(activity.phase, "tool");
	assert.equal(activity.label, "bash");
	assert.equal(activity.text, "pnpm test");
});
