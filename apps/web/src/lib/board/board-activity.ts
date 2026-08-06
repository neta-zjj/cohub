import type { BoardOperation, RequestSource } from "@neta-art/cohub";
import type { BoardDocument, BoardFrame } from "@neta-art/cohub/board";
import { selectionBounds } from "@neta-art/cohub/board";

export const BOARD_AUTOMATION_ACTIVITY_MS = 2_500;
const MAX_ACTIVITIES = 12;

export type BoardCollaboratorProfile = {
	userId: string;
	displayName: string;
	avatarUrl: string | null;
};

export type BoardAutomationActivity = {
	id: string;
	boardId: string;
	actorId: string;
	kind: "cli" | "agent";
	focus: BoardFrame;
	source: RequestSource;
	updatedAt: number;
};

type ActivityEvent = {
	boardId: string;
	actorId: string;
	txId: string;
	operations: BoardOperation[];
	metadata?: Record<string, unknown> | null;
	timestamp?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requestSource(metadata: Record<string, unknown> | null | undefined) {
	const value = metadata?.source;
	if (!isRecord(value)) return null;
	const source: RequestSource = {};
	if (typeof value.spaceId === "string") source.spaceId = value.spaceId;
	if (typeof value.sessionId === "string") source.sessionId = value.sessionId;
	if (typeof value.turnId === "string") source.turnId = value.turnId;
	if (typeof value.toolCallId === "string")
		source.toolCallId = value.toolCallId;
	if (typeof value.via === "string") source.via = value.via;
	return Object.keys(source).length > 0 ? source : null;
}

function automationKind(source: RequestSource): "cli" | "agent" | null {
	// A tool call means an agent ran it; via alone only names the channel.
	if (source.toolCallId) return "agent";
	return source.via === "cli" ? "cli" : null;
}

const GEOMETRY_KEYS = ["x", "y", "width", "height", "rotation"] as const;

/** Geometry fields a node patch actually carries, ignoring everything else. */
function patchGeometry(patch: Record<string, unknown>): Partial<BoardFrame> {
	const out: Partial<BoardFrame> = {};
	for (const key of GEOMETRY_KEYS) {
		const value = patch[key];
		if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
	}
	return out;
}

/**
 * Frames of the nodes a transaction touched.
 *
 * Deliberately does *not* apply the operations to the document: the marker only
 * needs a few frames, while a full apply re-derives every node for each patch
 * (O(ops × items)) — which a bulk `boards apply` would pay twice, once here and
 * once on the real sync path. Reading the document once and folding the ops'
 * own geometry over it is O(items + ops).
 */
function touchedFrames(
	document: BoardDocument,
	operations: BoardOperation[],
): BoardFrame[] {
	const existing = new Map(document.items.map((item) => [item.id, item.frame]));
	// Keyed by node so a create-then-patch in one transaction contributes once,
	// at its final position.
	const resolved = new Map<string, BoardFrame>();
	const base = (nodeId: string) => resolved.get(nodeId) ?? existing.get(nodeId);

	for (const operation of operations) {
		if (operation.type === "node.create") {
			const node = operation.payload.node;
			resolved.set(node.nodeId, {
				x: node.x,
				y: node.y,
				width: node.width,
				height: node.height,
				rotation: node.rotation,
			});
			continue;
		}
		if (operation.type === "node.patch") {
			const current = base(operation.payload.nodeId);
			// A patch for a node we do not have cannot be placed; the rest of the
			// transaction still resolves.
			if (!current) continue;
			resolved.set(operation.payload.nodeId, {
				...current,
				...patchGeometry(operation.payload.patch as Record<string, unknown>),
			});
			continue;
		}
		// A delete points at where the node used to be.
		const nodeIds =
			operation.type === "node.delete"
				? [operation.payload.nodeId]
				: operation.type === "effect.upsert"
					? operation.payload.effect.target.type === "node"
						? [operation.payload.effect.target.nodeId]
						: []
					: operation.type === "sequence.upsert"
						? operation.payload.clips.flatMap((clip) =>
								clip.target.type === "node" ? [clip.target.nodeId] : [],
							)
						: [];
		for (const nodeId of nodeIds) {
			const current = base(nodeId);
			if (current) resolved.set(nodeId, current);
		}
	}
	return [...resolved.values()];
}

export function createBoardAutomationActivity(
	document: BoardDocument,
	event: ActivityEvent,
): BoardAutomationActivity | null {
	const source = requestSource(event.metadata);
	if (!source) return null;
	const kind = automationKind(source);
	if (!kind) return null;

	const focus = selectionBounds(touchedFrames(document, event.operations));
	if (!focus) return null;

	// Ids are scoped per board: the same actor running the CLI against two boards
	// is two markers, not one that jumps between them.
	const id =
		kind === "agent" && source.toolCallId
			? `agent:${event.boardId}:${source.toolCallId}`
			: `cli:${event.boardId}:${event.actorId}`;
	return {
		id,
		boardId: event.boardId,
		actorId: event.actorId,
		kind,
		focus: { ...focus, rotation: 0 },
		source,
		updatedAt: event.timestamp ?? Date.now(),
	};
}

export function mergeBoardAutomationActivity(
	activities: BoardAutomationActivity[],
	activity: BoardAutomationActivity,
): BoardAutomationActivity[] {
	return [activity, ...activities.filter((item) => item.id !== activity.id)]
		.sort((left, right) => right.updatedAt - left.updatedAt)
		.slice(0, MAX_ACTIVITIES);
}
