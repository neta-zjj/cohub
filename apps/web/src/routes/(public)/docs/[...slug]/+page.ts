import { error } from "@sveltejs/kit";
import {
	DOCS_LOCALES,
	type DocsLocale,
	getDocsNavItems,
	loadDocsPage,
} from "$lib/docs";
import type { EntryGenerator, PageLoad } from "./$types";

export const prerender = true;

function resolveLocaleAndSlug(raw: string): {
	locale: DocsLocale;
	slug: string;
} {
	const normalized = raw.replace(/^\/+|\/+$/g, "");
	if (!normalized) return { locale: "en", slug: "" };
	if (normalized === "zh") return { locale: "zh", slug: "" };
	if (normalized.startsWith("zh/")) {
		return { locale: "zh", slug: normalized.slice("zh/".length) };
	}
	return { locale: "en", slug: normalized };
}

export const entries: EntryGenerator = () => {
	const items = getDocsNavItems();
	const result: Array<{ slug: string }> = [];

	for (const locale of DOCS_LOCALES) {
		for (const item of items) {
			// English home is handled by /docs/+page
			if (locale === "en" && !item.slug) continue;
			const slug =
				locale === "en" ? item.slug : item.slug ? `zh/${item.slug}` : "zh";
			result.push({ slug });
		}
	}

	return result;
};

export const load: PageLoad = async ({ params }) => {
	const raw = params.slug ?? "";
	const { locale, slug } = resolveLocaleAndSlug(raw);
	const doc = await loadDocsPage(slug, locale);
	if (!doc) error(404, "Docs page not found");
	return { doc };
};
