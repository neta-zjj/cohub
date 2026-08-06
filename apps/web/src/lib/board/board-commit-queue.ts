import type { BoardOperation } from "@neta-art/cohub";
import type { BoardDocument } from "@neta-art/cohub/board";
import { diffBoardDocuments } from "$lib/board/board-document";

export type CommitFn = (
	document: BoardDocument,
	ops: BoardOperation[],
) => Promise<void>;

export type CommitOutcome =
	| { ok: true; ops: BoardOperation[] }
	| { ok: false; error: unknown };

/**
 * Serializes board persistence so concurrent edits never re-send each other's
 * ops or clobber newer state.
 *
 * Each `commit(snapshot)` is chained onto a single promise tail, so commits run
 * strictly one at a time. A commit diffs its immutable snapshot against the
 * last successfully committed baseline and only sends the delta; the baseline
 * advances solely on success. Because callers capture the snapshot at the moment
 * of the edit (documents are replaced, never mutated in place), a burst of edits
 * produces a clean sequence of non-overlapping transactions.
 *
 * `reset(document)` is a barrier for external (remote) updates: it replaces the
 * baseline, drops any not-yet-started commits, and bumps a generation so an
 * in-flight commit from the previous document is ignored when it settles — it
 * can no longer advance the baseline or be mistaken for the current state.
 *
 * Successfully committed snapshots are remembered so the editor can recognise
 * its own changes echoed back through the document prop and avoid reloading
 * (which would otherwise drop selection/editing state).
 */
export function createCommitQueue(onCommit: CommitFn) {
	let baseline: BoardDocument | null = null;
	let tail: Promise<void> = Promise.resolve();
	let generation = 0;
	const echoed = new Set<BoardDocument>();

	/** Barrier for external updates: new baseline, ignore in-flight results. */
	function reset(document: BoardDocument) {
		generation += 1;
		baseline = document;
		echoed.clear();
		// Deliberately keep `tail`: new commits queue behind any in-flight commit
		// so onCommit calls never overlap. Stale queued commits skip themselves via
		// the generation check in commit().
	}

	/** True if `document` is a snapshot this queue committed (an echo). */
	function isEcho(document: BoardDocument): boolean {
		if (!echoed.has(document)) return false;
		echoed.delete(document);
		return true;
	}

	function commit(snapshot: BoardDocument): Promise<CommitOutcome> {
		const gen = generation;
		const run = tail.then<CommitOutcome>(async () => {
			// Superseded by a reset before we started — skip entirely.
			if (gen !== generation || !baseline) return { ok: true, ops: [] };
			const ops = diffBoardDocuments(baseline, snapshot);
			if (ops.length === 0) return { ok: true, ops: [] };
			// Register the echo *before* invoking onCommit: the parent echoes this
			// snapshot back through the document prop while the commit is still in
			// flight, so it must already be recognisable as our own change.
			echoed.add(snapshot);
			try {
				await onCommit(snapshot, ops);
				// Superseded while in flight — do not touch the new baseline.
				if (gen !== generation) return { ok: true, ops };
				baseline = snapshot;
				if (echoed.size > 32) {
					const oldest = echoed.values().next().value;
					if (oldest && oldest !== snapshot) echoed.delete(oldest);
				}
				return { ok: true, ops };
			} catch (error) {
				echoed.delete(snapshot);
				return { ok: false, error };
			}
		});
		// Outcomes are returned, never thrown, so the chain never stalls.
		tail = run.then(() => undefined);
		return run;
	}

	return { reset, commit, isEcho };
}

export type CommitQueue = ReturnType<typeof createCommitQueue>;
