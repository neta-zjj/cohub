import {
	buildWorkPwaMeta as buildSharedWorkPwaMeta,
	type WorkPageDetail,
} from "$lib/work-page-meta";

export type WorkPwaDetail = WorkPageDetail;

const PUBLIC_WORK_SEGMENT = "w";

export type PublicWorkPath = {
	username: string;
	spaceSlug: string;
	workSlug: string;
	pathname: string;
};

export function parsePublicWorkPath(pathname: string): PublicWorkPath | null {
	const segments = pathname.split("/").filter(Boolean);
	if (segments.length !== 4 || segments[2] !== PUBLIC_WORK_SEGMENT) return null;
	const [username, spaceSlug, , workSlug] = segments;
	if (!username || !spaceSlug || !workSlug) return null;
	return { username, spaceSlug, workSlug, pathname: `/${segments.join("/")}` };
}

export function resolvePublicWorkStartUrl(requestUrl: URL) {
	const rawStartUrl = requestUrl.searchParams.get("start_url");
	if (!rawStartUrl) return { startUrl: "/", path: null };

	let parsed: URL;
	try {
		parsed = new URL(rawStartUrl, requestUrl.origin);
	} catch {
		return { startUrl: "/", path: null };
	}
	if (parsed.origin !== requestUrl.origin) return { startUrl: "/", path: null };

	const path = parsePublicWorkPath(parsed.pathname);
	if (!path) return { startUrl: "/", path: null };

	return { startUrl: path.pathname, path };
}

export function buildWorkPwaMeta(detail: WorkPwaDetail | null) {
	return buildSharedWorkPwaMeta(detail);
}
