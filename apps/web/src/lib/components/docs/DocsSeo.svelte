<script lang="ts">
import { page } from "$app/state";
import type { DocsPage } from "$lib/docs";
import { docsHref, getDocsUi } from "$lib/docs";
import {
	canonicalUrl,
	defaultOgImage,
	docsJsonLd,
	type SeoBreadcrumb,
} from "$lib/seo";

const {
	doc,
}: {
	doc: DocsPage;
} = $props();

const ui = $derived(getDocsUi(doc.locale));
const origin = $derived(page.url.origin);
const canonical = $derived(canonicalUrl(origin, doc.href));
const enHref = $derived(docsHref(doc.slug, "en"));
const zhHref = $derived(docsHref(doc.slug, "zh"));
const pageTitle = $derived(
	doc.locale === "zh"
		? `${doc.title} — Cohub 文档`
		: `${doc.title} — Cohub Docs`,
);
const ogImage = $derived(defaultOgImage(origin));
const breadcrumbs = $derived.by((): SeoBreadcrumb[] => {
	const homePath = docsHref("", doc.locale);
	const crumbs: SeoBreadcrumb[] = [{ name: ui.docsLabel, path: homePath }];
	if (doc.slug) crumbs.push({ name: doc.title, path: doc.href });
	return crumbs;
});
const jsonLd = $derived(
	docsJsonLd({
		origin,
		title: doc.title,
		description: doc.description,
		path: doc.href,
		locale: doc.locale,
		sectionTitle: doc.sectionTitle,
		breadcrumbs,
	}),
);
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<meta name="description" content={doc.description} />
	<link rel="canonical" href={canonical} />
	<link rel="alternate" hreflang="en" href={canonicalUrl(origin, enHref)} />
	<link rel="alternate" hreflang="zh-CN" href={canonicalUrl(origin, zhHref)} />
	<link
		rel="alternate"
		hreflang="x-default"
		href={canonicalUrl(origin, enHref)}
	/>
	<meta property="og:title" content={pageTitle} />
	<meta property="og:description" content={doc.description} />
	<meta property="og:url" content={canonical} />
	<meta property="og:type" content="article" />
	<meta property="og:site_name" content="Cohub" />
	<meta
		property="og:locale"
		content={doc.locale === "zh" ? "zh_CN" : "en_US"}
	/>
	<meta
		property="og:locale:alternate"
		content={doc.locale === "zh" ? "en_US" : "zh_CN"}
	/>
	<meta property="og:image" content={ogImage} />
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content={pageTitle} />
	<meta name="twitter:description" content={doc.description} />
	<meta name="twitter:image" content={ogImage} />
	{@html `<script type="application/ld+json">${jsonLd.replace(/</g, "\\u003c")}</script>`}
</svelte:head>
