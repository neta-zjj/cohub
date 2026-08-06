/**
 * Pure planner for the node writes in a board transaction.
 *
 * The apply path used to issue a few queries *per operation* — a select, then an
 * insert or update — all while holding the board's row lock. That is fine for a
 * handful of operations and untenable for thousands, which is what a bulk edit
 * (delete a large selection, paste a large group) legitimately produces.
 *
 * So the decision-making is separated from the IO: this module folds the node
 * operations against a prefetched snapshot and returns the *final* state of every
 * touched node, which the caller writes with a couple of bulk statements. That
 * makes the expensive part a fixed number of round-trips instead of a function of
 * the operation count, and — because it is pure — makes the semantics (including
 * the inverse operations that undo depends on) testable without a database.
 *
 * Ordering is preserved by folding operations in sequence, so a transaction that
 * creates a node and then patches or deletes it behaves exactly as before.
 *
 * Cross-entity reference integrity (may this node be deleted while an effect or a
 * clip targets it? does this effect's target node exist?) is deliberately *not*
 * checked here. It belongs to `contextualValidation`, which runs first and is the
 * only place that simulates the whole transaction in order — so it alone can tell
 * that an effect created in operation 2 legitimately targets a node created in
 * operation 1, or that a node freed by an `effect.delete` is now deletable.
 * Re-checking it here against a pre-transaction snapshot would only reintroduce
 * the ordering bugs that separation exists to avoid.
 */

import type { BoardNodeInput, BoardOperation, BoardTarget } from "@cohub/protocol";
import { BoardServiceError, type NormalizedNodePatch } from "./board-ops.js";

/** The node columns this planner owns. Mirrors BoardNodeInput. */
export type PlannedNodeFields = BoardNodeInput;

/** A node row as prefetched from the database, including soft-deleted ones. */
export type ExistingNodeRow = PlannedNodeFields & {
	/** Set when the row is currently soft-deleted. */
	deleted: boolean;
};

export type PlannedNodeWrite = {
	nodeId: string;
	/** Full target state of the row. */
	fields: PlannedNodeFields;
	/** True when the row should end up soft-deleted. */
	deleted: boolean;
	/** True when no row exists yet and one must be inserted. */
	isNew: boolean;
};

export type NodePlan = {
	/** Final state per touched node, in first-touch order. */
	writes: PlannedNodeWrite[];
	/**
	 * Journal entries keyed by the operation's index in the transaction, so the
	 * caller can splice them back into the full operation order alongside the
	 * effect/sequence operations it still handles itself.
	 */
	journal: Map<number, {
		type: string;
		payload: Record<string, unknown>;
		inverse: Record<string, unknown> | null;
	}>;
};

export type NodePlanContext = {
	/** Prefetched rows for every node the transaction mentions. */
	existing: Map<string, ExistingNodeRow>;
};

/** Node ids a transaction's node operations mention, for the prefetch query. */
export function collectTouchedNodeIds(
	operations: readonly BoardOperation[],
): string[] {
	const ids = new Set<string>();
	for (const operation of operations) {
		if (operation.type === "node.create") {
			ids.add(operation.payload.node.nodeId);
			const parentId = operation.payload.node.parentId;
			if (parentId) ids.add(parentId);
			continue;
		}
		if (operation.type === "node.patch") {
			ids.add(operation.payload.nodeId);
			const parentId = (operation.payload.patch as NormalizedNodePatch).parentId;
			if (parentId) ids.add(parentId);
			continue;
		}
		if (operation.type === "node.delete") ids.add(operation.payload.nodeId);
	}
	return [...ids];
}

/** Whether an operation is one this planner handles. */
export function isNodeOperation(operation: BoardOperation): boolean {
	return (
		operation.type === "node.create" ||
		operation.type === "node.patch" ||
		operation.type === "node.delete"
	);
}

/**
 * Fold the node operations into final row states plus a journal.
 *
 * Throws the same BoardServiceError codes as the per-operation path did, so
 * client-visible behaviour is unchanged.
 */
export function planNodeWrites(
	operations: readonly BoardOperation[],
	context: NodePlanContext,
): NodePlan {
	// Live view of every touched node, updated as operations fold in, so a
	// create-then-patch in one transaction sees its own earlier write.
	const live = new Map<string, { fields: PlannedNodeFields; deleted: boolean }>();
	const isNew = new Map<string, boolean>();
	const order: string[] = [];
	const touched = new Set<string>();
	const journal: NodePlan["journal"] = new Map();

	const touch = (nodeId: string) => {
		if (touched.has(nodeId)) return;
		touched.add(nodeId);
		order.push(nodeId);
	};

	const currentOf = (nodeId: string) => {
		const staged = live.get(nodeId);
		if (staged) return staged;
		const row = context.existing.get(nodeId);
		if (!row) return null;
		const { deleted, ...fields } = row;
		return { fields: fields as PlannedNodeFields, deleted };
	};

	const assertTargetExists = (target: BoardTarget) => {
		if (target.type !== "node") return;
		const current = currentOf(target.nodeId);
		if (!current || current.deleted) {
			throw new BoardServiceError(
				400,
				`target node does not exist: ${target.nodeId}`,
				"INVALID_REFERENCE",
			);
		}
	};

	for (const [opIndex, operation] of operations.entries()) {
		if (operation.type === "node.create") {
			const node = operation.payload.node;
			const current = currentOf(node.nodeId);
			if (current && !current.deleted) {
				throw new BoardServiceError(
					409,
					`node already exists: ${node.nodeId}`,
					"NODE_EXISTS",
				);
			}
			if (node.parentId)
				assertTargetExists({ type: "node", nodeId: node.parentId });
			// A soft-deleted row is revived in place rather than re-inserted.
			live.set(node.nodeId, { fields: node, deleted: false });
			if (!isNew.has(node.nodeId))
				isNew.set(node.nodeId, !context.existing.has(node.nodeId));
			touch(node.nodeId);
			journal.set(opIndex, {
				type: operation.type,
				payload: operation.payload as unknown as Record<string, unknown>,
				inverse: { type: "node.delete", payload: { nodeId: node.nodeId } },
			});
			continue;
		}

		if (operation.type === "node.patch") {
			const nodeId = operation.payload.nodeId;
			const current = currentOf(nodeId);
			if (!current || current.deleted) {
				throw new BoardServiceError(404, "board node not found", "NODE_NOT_FOUND");
			}
			const patch = operation.payload.patch as NormalizedNodePatch;
			if (patch.parentId)
				assertTargetExists({ type: "node", nodeId: patch.parentId });
			const previousFields = current.fields;
			const inversePatch: Record<string, unknown> = {};
			for (const key of Object.keys(patch)) {
				inversePatch[key] = previousFields[key as keyof PlannedNodeFields];
			}
			live.set(nodeId, {
				fields: { ...previousFields, ...patch, nodeId },
				deleted: false,
			});
			if (!isNew.has(nodeId)) isNew.set(nodeId, !context.existing.has(nodeId));
			touch(nodeId);
			journal.set(opIndex, {
				type: operation.type,
				payload: operation.payload as unknown as Record<string, unknown>,
				inverse: { type: "node.patch", payload: { nodeId, patch: inversePatch } },
			});
			continue;
		}

		if (operation.type !== "node.delete") continue;

		const nodeId = operation.payload.nodeId;
		const current = currentOf(nodeId);
		if (!current || current.deleted) {
			throw new BoardServiceError(404, "board node not found", "NODE_NOT_FOUND");
		}
		live.set(nodeId, { fields: current.fields, deleted: true });
		if (!isNew.has(nodeId)) isNew.set(nodeId, !context.existing.has(nodeId));
		touch(nodeId);
		journal.set(opIndex, {
			type: operation.type,
			payload: operation.payload as unknown as Record<string, unknown>,
			// The inverse restores the row as it was before the delete.
			inverse: { type: "node.create", payload: { node: current.fields } },
		});
	}

	const writes: PlannedNodeWrite[] = [];
	for (const nodeId of order) {
		const staged = live.get(nodeId);
		if (!staged) continue;
		writes.push({
			nodeId,
			fields: staged.fields,
			deleted: staged.deleted,
			isNew: isNew.get(nodeId) ?? false,
		});
	}
	return { writes, journal };
}
