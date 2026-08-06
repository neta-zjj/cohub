import type { SpaceRecord } from "@neta-art/cohub";
import { createLocalListCache } from "$lib/stores/create-local-list-cache";
import { cacheSpaceRecordsSoon } from "$lib/stores/space-record-cache";

const SPACE_LIST_SCOPE = "all";

function dedupeSpaces(spaces: SpaceRecord[]) {
	const byId = new Map<string, SpaceRecord>();
	for (const space of spaces) {
		const normalized = { ...space, isPinned: space.isPinned ?? false };
		if (!byId.has(space.id)) {
			byId.set(space.id, normalized);
			continue;
		}
		byId.set(space.id, { ...byId.get(space.id), ...normalized });
	}
	return Array.from(byId.values());
}

const cache = createLocalListCache<SpaceRecord>({
	storagePrefix: "cohub:space-list",
	cacheVersion: 1,
	updatedEventName: "cohub:space-list-updated",
	ttlMs: 60_000,
	normalize: dedupeSpaces,
});

export function getCachedSpaceList(): SpaceRecord[] | null {
	return cache.getCached(SPACE_LIST_SCOPE);
}

export function getCachedSpaceListMeta() {
	return cache.getCachedMeta(SPACE_LIST_SCOPE);
}

export function setCachedSpaceList(spaces: SpaceRecord[]): SpaceRecord[] {
	const next = cache.setCached(SPACE_LIST_SCOPE, spaces);
	cacheSpaceRecordsSoon(next);
	return next;
}

export function patchCachedSpaceList(
	updater: (spaces: SpaceRecord[]) => SpaceRecord[],
): SpaceRecord[] {
	const next = cache.patchCached(SPACE_LIST_SCOPE, updater);
	cacheSpaceRecordsSoon(next);
	return next;
}

export function clearCachedSpaceList() {
	cache.clearCached(SPACE_LIST_SCOPE);
}

export function clearAllCachedSpaceLists() {
	cache.clearAllForCurrentUser();
}

export function onSpaceListCacheUpdated(
	handler: (event: { spaces: SpaceRecord[] }) => void,
) {
	return cache.onUpdated(({ data }) => {
		handler({ spaces: data });
	});
}

export async function fetchSpaceListWithCache(
	fetcher: () => Promise<SpaceRecord[]>,
	options?: { force?: boolean },
): Promise<SpaceRecord[]> {
	const spaces = await cache.fetchWithCache(SPACE_LIST_SCOPE, fetcher, options);
	cacheSpaceRecordsSoon(spaces);
	return spaces;
}
