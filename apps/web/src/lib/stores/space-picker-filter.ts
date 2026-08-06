import { getCacheUserKey } from "$lib/cache/keys";

const VERSION = 1;
const PREFIX = "cohub:space-picker-filter";

export type SpaceFilterPref = "all" | "mine" | "pinned";

function isBrowser() {
	return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function storageKey() {
	return `${PREFIX}:${encodeURIComponent(getCacheUserKey())}:v${VERSION}`;
}

export function getCachedSpaceFilterPref(): SpaceFilterPref {
	if (!isBrowser()) return "all";
	try {
		const raw = localStorage.getItem(storageKey());
		if (!raw) return "all";
		if (raw === "mine" || raw === "pinned" || raw === "all") {
			return raw;
		}
		return "all";
	} catch {
		return "all";
	}
}

export function setCachedSpaceFilterPref(pref: SpaceFilterPref) {
	if (!isBrowser()) return;
	try {
		localStorage.setItem(storageKey(), pref);
	} catch {
		// localStorage may be unavailable or full; runtime state remains authoritative.
	}
}
