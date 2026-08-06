import assert from "node:assert/strict";
import test from "node:test";
import type { ChannelEnvelope } from "@cohub/protocol/realtime";
import type { WorkRecord, WorkVersionRecord } from "@neta-art/cohub";
import {
	createWorkMutationBuffer,
	parseWorkVersionPublished,
	upsertWorkSnapshot,
	upsertWorkVersion,
} from "$lib/features/work/work-realtime";

const work = (latestVersion: number, updatedAt: string): WorkRecord => ({
	id: "work-1",
	spaceId: "space-1",
	userUuid: "user-1",
	slug: "demo",
	status: "published",
	visibility: "public",
	targetType: "file",
	targetRef: "index.html",
	assetKey: "asset",
	currentVersionId: `version-${latestVersion}`,
	latestVersion,
	publishedAt: updatedAt,
	workScopes: [],
	allowedViewerScopes: [],
	meta: null,
	createdAt: updatedAt,
	updatedAt,
});

const version = (value: number): WorkVersionRecord => ({
	id: `version-${value}`,
	workId: "work-1",
	version: value,
	targetType: "file",
	targetRef: "index.html",
	assetKey: "asset",
	contentKind: "web",
	artifact: null,
	meta: null,
	createdAt: "2026-07-20T00:00:00.000Z",
});

test("parseWorkVersionPublished validates the work relationship", () => {
	const event = {
		id: "event-1",
		timestamp: Date.now(),
		domain: "space",
		type: "work.version.published",
		spaceId: "space-1",
		payload: {
			work: work(2, "2026-07-20T00:00:00.000Z"),
			version: version(2),
			previousVersionId: "version-1",
		},
	} as ChannelEnvelope;
	assert.deepEqual(parseWorkVersionPublished(event), {
		work: event.payload.work,
		version: event.payload.version,
		previousVersionId: "version-1",
	});

	const invalid = {
		...event,
		payload: { ...event.payload, version: { ...version(2), workId: "other" } },
	};
	assert.equal(parseWorkVersionPublished(invalid), null);
});

test("upsertWorkSnapshot ignores older and stale same-version snapshots", () => {
	const current = work(3, "2026-07-20T03:00:00.000Z");
	assert.equal(
		upsertWorkSnapshot([current], work(2, "2026-07-20T04:00:00.000Z"))[0],
		current,
	);
	assert.equal(
		upsertWorkSnapshot([current], work(3, "2026-07-20T02:00:00.000Z"))[0],
		current,
	);
	assert.equal(
		upsertWorkSnapshot([current], work(4, "2026-07-20T01:00:00.000Z"))[0]
			?.latestVersion,
		4,
	);
});

test("upsertWorkVersion deduplicates and keeps newest versions first", () => {
	assert.deepEqual(
		upsertWorkVersion([version(1), version(2)], version(2)).map(
			(item) => item.version,
		),
		[2, 1],
	);
});

test("work mutation buffer replays realtime changes onto a stale list", () => {
	const buffer = createWorkMutationBuffer();
	const other: WorkRecord = {
		...work(1, "2026-07-20T00:00:00.000Z"),
		id: "work-2",
	};
	const published = work(5, "2026-07-20T05:00:00.000Z");

	// A publish lands while the full list request is still in flight.
	buffer.upsert(published);
	const merged = buffer.apply([work(4, "2026-07-20T04:00:00.000Z"), other]);

	// The event wins for its own Work, and the Space's other Works survive.
	assert.deepEqual(
		merged.map((item) => [item.id, item.latestVersion]),
		[
			["work-1", 5],
			["work-2", 1],
		],
	);
	// Draining leaves nothing to replay onto the next response.
	assert.deepEqual(buffer.apply([other]), [other]);
});

test("work mutation buffer keeps deletes and last write per work", () => {
	const buffer = createWorkMutationBuffer();
	buffer.upsert(work(2, "2026-07-20T02:00:00.000Z"));
	buffer.remove("work-1");
	assert.deepEqual(buffer.apply([work(1, "2026-07-20T01:00:00.000Z")]), []);

	buffer.remove("work-1");
	buffer.upsert(work(3, "2026-07-20T03:00:00.000Z"));
	assert.deepEqual(
		buffer.apply([]).map((item) => item.latestVersion),
		[3],
	);
});
