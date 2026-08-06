import type { Handle } from "@sveltejs/kit";
import {
	isPublicSharePath,
	PUBLIC_NOT_FOUND_CACHE_CONTROL,
} from "$lib/server/public-cache";

function isPublicWorkPath(pathname: string): boolean {
	const segments = pathname.split("/").filter(Boolean);
	return segments.length === 4 && segments[2] === "w";
}

function resolveHtmlLang(pathname: string, html: string): string {
	if (pathname.startsWith("/docs/zh")) return "zh-CN";
	if (isPublicWorkPath(pathname)) {
		const match =
			html.match(
				/<meta\b[^>]*\bname=["']cohub-work-lang["'][^>]*\bcontent=["']([^"']+)["'][^>]*>/i,
			) ??
			html.match(
				/<meta\b[^>]*\bcontent=["']([^"']+)["'][^>]*\bname=["']cohub-work-lang["'][^>]*>/i,
			);
		const workLang = match?.[1]?.trim();
		if (workLang && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(workLang)) {
			return workLang;
		}
	}
	return "en";
}

/** Set <html lang> for prerendered / SSR HTML (client SPA nav is handled in docs layout). */
export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event, {
		transformPageChunk: ({ html }) => {
			const lang = resolveHtmlLang(event.url.pathname, html);
			return html.replace(/<html lang="[^"]*">/, `<html lang="${lang}">`);
		},
	});

	// error() paths drop load setHeaders(); apply a short public 404 cache here.
	if (
		response.status === 404 &&
		isPublicSharePath(event.url.pathname) &&
		!response.headers.has("cache-control")
	) {
		response.headers.set("cache-control", PUBLIC_NOT_FOUND_CACHE_CONTROL);
	}

	return response;
};
