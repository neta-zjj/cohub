export type WorkLaunchState = {
	search: string;
	hash: string;
};

export type CohubWorkUrl = WorkLaunchState & {
	username: string;
	spaceSlug: string;
	workSlug: string;
};

function isReservedWorkParam(name: string) {
	return name.toLowerCase().startsWith("cohub_");
}

export function buildWorkIframeUrl(
	contentUrl: string,
	launchState: WorkLaunchState | null | undefined,
) {
	if (!launchState) return contentUrl;

	const launchParams = Array.from(
		new URLSearchParams(launchState.search).entries(),
	).filter(([name]) => !isReservedWorkParam(name));
	if (launchParams.length === 0 && !launchState.hash) return contentUrl;

	let url: URL;
	try {
		url = new URL(contentUrl);
	} catch {
		return contentUrl;
	}

	for (const name of new Set(launchParams.map(([name]) => name))) {
		url.searchParams.delete(name);
	}
	for (const [name, value] of launchParams) {
		url.searchParams.append(name, value);
	}
	if (launchState.hash) url.hash = launchState.hash;
	return url.href;
}

function isSameCohubOrigin(url: URL, base: URL) {
	return url.origin === base.origin;
}

export function parseCohubWorkUrl(
	value: string,
	baseHref: string,
): CohubWorkUrl | null {
	let url: URL;
	let base: URL;
	try {
		base = new URL(baseHref);
		url = new URL(value, base);
	} catch {
		return null;
	}
	if (!isSameCohubOrigin(url, base)) return null;
	const segments = url.pathname.split("/").filter(Boolean);
	if (segments.length !== 4 || segments[2] !== "w") return null;
	const [username, spaceSlug, , workSlug] = segments;
	if (!username || !spaceSlug || !workSlug) return null;
	try {
		return {
			username: decodeURIComponent(username),
			spaceSlug: decodeURIComponent(spaceSlug),
			workSlug: decodeURIComponent(workSlug),
			search: url.search,
			hash: url.hash,
		};
	} catch {
		return null;
	}
}
