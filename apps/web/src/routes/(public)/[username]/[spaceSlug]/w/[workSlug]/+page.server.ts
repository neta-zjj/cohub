import { error } from "@sveltejs/kit";
import { loadPublicWorkDetail } from "$lib/server/public-api";
import { setPublicPageCache } from "$lib/server/public-cache";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({
	params,
	fetch,
	url,
	setHeaders,
}) => {
	const result = await loadPublicWorkDetail(
		{
			username: params.username,
			spaceSlug: params.spaceSlug,
			workSlug: params.workSlug,
			pathname: url.pathname,
		},
		fetch,
	);

	if (result.ok) {
		setPublicPageCache(setHeaders, {
			private: (result.detail.work.visibility ?? "public") === "space",
		});
		return {
			mode: "ready" as const,
			work: result.detail.work,
			space: result.detail.space,
			owner: result.detail.owner,
			content: result.detail.content,
			publicUrl: result.detail.publicUrl,
			pathname: url.pathname,
			origin: url.origin,
		};
	}

	// Only a definitive miss should 404 the document.
	// Auth failures, API outages, and shape issues fall back to client load so
	// already-published Works keep working (same as pre-SSR behavior).
	if (result.status === 404) {
		error(404, "Work not found");
	}

	setPublicPageCache(setHeaders, { private: true });
	return {
		mode: "client" as const,
		pathname: url.pathname,
		origin: url.origin,
		username: params.username,
		spaceSlug: params.spaceSlug,
		workSlug: params.workSlug,
	};
};
