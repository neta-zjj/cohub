import type { ChannelEnvelope } from "@cohub/protocol/realtime";
import type { WorkRecord, WorkVersionRecord } from "@neta-art/cohub";

export const WORKS_CHANGED_EVENT = "cohub:works-changed";

export type WorkVersionPublishedPayload = {
	work: WorkRecord;
	version: WorkVersionRecord;
	previousVersionId: string | null;
};

export type WorksChangedDetail = {
	spaceId: string;
	work?: WorkRecord;
	version?: WorkVersionRecord;
	deletedWorkId?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value && typeof value === "object" && !Array.isArray(value));

export function parseWorkVersionPublished(
	event: ChannelEnvelope,
): WorkVersionPublishedPayload | null {
	if (event.type !== "work.version.published" || !event.spaceId) return null;
	const work = isRecord(event.payload.work) ? event.payload.work : null;
	const version = isRecord(event.payload.version)
		? event.payload.version
		: null;
	if (
		!work ||
		!version ||
		typeof work.id !== "string" ||
		work.spaceId !== event.spaceId ||
		typeof work.latestVersion !== "number" ||
		typeof version.id !== "string" ||
		version.workId !== work.id ||
		typeof version.version !== "number"
	) {
		return null;
	}
	return {
		work: work as WorkRecord,
		version: version as WorkVersionRecord,
		previousVersionId:
			typeof event.payload.previousVersionId === "string"
				? event.payload.previousVersionId
				: null,
	};
}

function timestamp(value: string | null | undefined) {
	const parsed = Date.parse(value ?? "");
	return Number.isFinite(parsed) ? parsed : 0;
}

export function isNewerWorkSnapshot(
	current: WorkRecord | null | undefined,
	next: WorkRecord,
) {
	if (!current) return true;
	if (next.latestVersion !== current.latestVersion) {
		return next.latestVersion > current.latestVersion;
	}
	return timestamp(next.updatedAt) >= timestamp(current.updatedAt);
}

export function upsertWorkSnapshot(works: WorkRecord[], next: WorkRecord) {
	const index = works.findIndex((work) => work.id === next.id);
	if (index < 0) return [...works, next];
	if (!isNewerWorkSnapshot(works[index], next)) return works;
	const updated = [...works];
	updated[index] = next;
	return updated;
}

export function upsertWorkVersion(
	versions: WorkVersionRecord[],
	next: WorkVersionRecord,
) {
	const byId = new Map(versions.map((version) => [version.id, version]));
	byId.set(next.id, next);
	return [...byId.values()].sort((a, b) => b.version - a.version);
}

/**
 * Buffer of realtime Work mutations for replay onto an in-flight list response.
 *
 * A full list request and a realtime event can overlap, and the response is
 * built from a snapshot older than the event. Discarding the response would
 * leave only the Works the events happened to carry, so the events are instead
 * folded back on top of it.
 */
export function createWorkMutationBuffer() {
	const upserts = new Map<string, WorkRecord>();
	const deletes = new Set<string>();

	function reset() {
		upserts.clear();
		deletes.clear();
	}

	return {
		reset,
		upsert(work: WorkRecord) {
			deletes.delete(work.id);
			upserts.set(work.id, work);
		},
		remove(workId: string) {
			upserts.delete(workId);
			deletes.add(workId);
		},
		/** Apply the buffered mutations to a fetched list and drain the buffer. */
		apply(list: WorkRecord[]) {
			let next =
				deletes.size > 0 ? list.filter((work) => !deletes.has(work.id)) : list;
			for (const work of upserts.values())
				next = upsertWorkSnapshot(next, work);
			reset();
			return next;
		},
	};
}

export function dispatchWorksChanged(detail: WorksChangedDetail) {
	if (typeof window === "undefined") return;
	window.dispatchEvent(new CustomEvent(WORKS_CHANGED_EVENT, { detail }));
}
