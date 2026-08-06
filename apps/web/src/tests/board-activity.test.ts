import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardDocument, BoardItem } from "@neta-art/cohub/board";
import {
	type BoardAutomationActivity,
	createBoardAutomationActivity,
	mergeBoardAutomationActivity,
} from "../lib/board/board-activity.ts";

function doc(items: BoardItem[]): BoardDocument {
	return {
		kind: "cohub.board",
		version: 1,
		appearance: {
			theme: "clean",
			background: { kind: "grid" },
			grid: { visible: true, size: 32, opacity: 0.22 },
			mood: "clean",
		},
		viewport: { x: 0, y: 0, zoom: 1 },
		items,
	};
}

function textItem(id: string, x = 0, y = 0): BoardItem {
	return {
		id,
		type: "text",
		text: id,
		color: "neutral",
		fontSize: 18,
		frame: { x, y, width: 100, height: 60, rotation: 0 },
	};
}

const BOARD_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const TURN_ID = "44444444-4444-4444-8444-444444444444";
const TOOL_CALL_ID = "55555555-5555-4555-8555-555555555555";

function event(
	overrides: Partial<Parameters<typeof createBoardAutomationActivity>[1]> = {},
) {
	return {
		boardId: BOARD_ID,
		actorId: "actor-a",
		txId: "tx-1",
		operations: [],
		...overrides,
	} as Parameters<typeof createBoardAutomationActivity>[1];
}

test("web transactions produce no automation marker", () => {
	const activity = createBoardAutomationActivity(
		doc([textItem("a")]),
		event({
			operations: [
				{ type: "node.patch", payload: { nodeId: "a", patch: { x: 40 } } },
			],
			metadata: { source: { via: "web", sessionId: SESSION_ID } },
		}),
	);
	assert.equal(activity, null);
});

test("transactions without provenance produce no marker", () => {
	const activity = createBoardAutomationActivity(
		doc([textItem("a")]),
		event({
			operations: [
				{ type: "node.patch", payload: { nodeId: "a", patch: { x: 40 } } },
			],
			metadata: {},
		}),
	);
	assert.equal(activity, null);
});

test("a tool call is an agent marker even though it arrives via cli", () => {
	const activity = createBoardAutomationActivity(
		doc([textItem("a")]),
		event({
			operations: [
				{ type: "node.patch", payload: { nodeId: "a", patch: { x: 40 } } },
			],
			metadata: {
				source: {
					via: "cli",
					sessionId: SESSION_ID,
					turnId: TURN_ID,
					toolCallId: TOOL_CALL_ID,
				},
			},
		}),
	);
	assert.equal(activity?.kind, "agent");
	// Keyed on board + tool call so consecutive transactions reuse one marker
	// without leaking across boards.
	assert.equal(activity?.id, `agent:${BOARD_ID}:${TOOL_CALL_ID}`);
});

test("via-only cli provenance is a direct CLI marker", () => {
	const activity = createBoardAutomationActivity(
		doc([textItem("a")]),
		event({
			operations: [
				{ type: "node.patch", payload: { nodeId: "a", patch: { x: 40 } } },
			],
			metadata: { source: { via: "cli" } },
		}),
	);
	assert.equal(activity?.kind, "cli");
	assert.equal(activity?.id, `cli:${BOARD_ID}:actor-a`);
});

test("cli ids are scoped per board so two boards keep separate markers", () => {
	const other = "66666666-6666-4666-8666-666666666666";
	const ops = [
		{ type: "node.patch" as const, payload: { nodeId: "a", patch: { x: 40 } } },
	];
	const first = createBoardAutomationActivity(
		doc([textItem("a")]),
		event({ operations: ops, metadata: { source: { via: "cli" } } }),
	);
	const second = createBoardAutomationActivity(
		doc([textItem("a")]),
		event({
			boardId: other,
			operations: ops,
			metadata: { source: { via: "cli" } },
		}),
	);
	assert.notEqual(first?.id, second?.id);
	assert.equal(
		mergeBoardAutomationActivity(
			[first as BoardAutomationActivity],
			second as BoardAutomationActivity,
		).length,
		2,
	);
});

test("focus covers a created node that is not yet in the local document", () => {
	const activity = createBoardAutomationActivity(
		doc([]),
		event({
			operations: [
				{
					type: "node.create",
					payload: {
						node: {
							nodeId: "new",
							type: "text",
							parentId: null,
							orderKey: "00000000",
							x: 200,
							y: 120,
							width: 80,
							height: 40,
							rotation: 0,
							refKind: null,
							refPath: null,
							refUrl: null,
							view: {},
							style: {},
							data: { text: "hi", color: "neutral", fontSize: 18 },
						},
					},
				},
			],
			metadata: { source: { via: "cli" } },
		}),
	);
	assert.deepEqual(activity?.focus, {
		x: 200,
		y: 120,
		width: 80,
		height: 40,
		rotation: 0,
	});
});

test("a delete still resolves to where the node used to be", () => {
	const activity = createBoardAutomationActivity(
		doc([textItem("a", 300, 400)]),
		event({
			operations: [{ type: "node.delete", payload: { nodeId: "a" } }],
			metadata: { source: { via: "cli" } },
		}),
	);
	assert.equal(activity?.focus.x, 300);
	assert.equal(activity?.focus.y, 400);
});

test("multi-node edits focus the union of what changed", () => {
	const activity = createBoardAutomationActivity(
		doc([textItem("a", 0, 0), textItem("b", 400, 200)]),
		event({
			operations: [
				{ type: "node.patch", payload: { nodeId: "a", patch: { x: 0 } } },
				{ type: "node.patch", payload: { nodeId: "b", patch: { x: 400 } } },
			],
			metadata: { source: { via: "cli" } },
		}),
	);
	assert.equal(activity?.focus.x, 0);
	assert.equal(activity?.focus.y, 0);
	assert.equal(activity?.focus.width, 500);
	assert.equal(activity?.focus.height, 260);
});

test("operations with no spatial target produce no marker", () => {
	const activity = createBoardAutomationActivity(
		doc([textItem("a")]),
		event({
			operations: [
				{ type: "board.patch", payload: { patch: { title: "Renamed" } } },
			],
			metadata: { source: { via: "cli" } },
		}),
	);
	assert.equal(activity, null);
});

test("merging replaces the marker for the same tool call rather than stacking", () => {
	const first: BoardAutomationActivity = {
		id: `agent:${BOARD_ID}:${TOOL_CALL_ID}`,
		boardId: BOARD_ID,
		actorId: "actor-a",
		kind: "agent",
		focus: { x: 0, y: 0, width: 10, height: 10, rotation: 0 },
		source: { toolCallId: TOOL_CALL_ID },
		updatedAt: 1,
	};
	const second = { ...first, focus: { ...first.focus, x: 500 }, updatedAt: 2 };
	const merged = mergeBoardAutomationActivity([first], second);
	assert.equal(merged.length, 1);
	assert.equal(merged[0]?.focus.x, 500);
});

test("a patch moves the focus without re-applying the whole document", () => {
	// Focus must follow the patch's own geometry, not the node's stale frame.
	const activity = createBoardAutomationActivity(
		doc([textItem("a", 0, 0)]),
		event({
			operations: [
				{
					type: "node.patch",
					payload: { nodeId: "a", patch: { x: 900, y: 700 } },
				},
			],
			metadata: { source: { via: "cli" } },
		}),
	);
	assert.equal(activity?.focus.x, 900);
	assert.equal(activity?.focus.y, 700);
	// Untouched dimensions come from the existing frame.
	assert.equal(activity?.focus.width, 100);
	assert.equal(activity?.focus.height, 60);
});

test("a create-then-patch in one transaction contributes a single frame", () => {
	const activity = createBoardAutomationActivity(
		doc([]),
		event({
			operations: [
				{
					type: "node.create",
					payload: {
						node: {
							nodeId: "new",
							type: "text",
							parentId: null,
							orderKey: "00000000",
							x: 0,
							y: 0,
							width: 50,
							height: 50,
							rotation: 0,
							refKind: null,
							refPath: null,
							refUrl: null,
							view: {},
							style: {},
							data: {},
						},
					},
				},
				{ type: "node.patch", payload: { nodeId: "new", patch: { x: 300 } } },
			],
			metadata: { source: { via: "cli" } },
		}),
	);
	// One node, at its final position — not a box spanning both positions.
	assert.equal(activity?.focus.x, 300);
	assert.equal(activity?.focus.width, 50);
});
