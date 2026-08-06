export type DocsLocale = "en" | "zh";

export type DocsSectionId =
	| "learn"
	| "workspace"
	| "create"
	| "collaborate"
	| "extend"
	| "account"
	| "developers";

export type DocsNavItem = {
	/** Content slug shared across locales. Empty string is the docs home. */
	slug: string;
	/** Default (English) nav title; localized titles may override at render time. */
	title: string;
	section: DocsSectionId;
	/** Markdown file path relative to docs/product/<locale> (posix, no leading slash). */
	file: string;
};

export type DocsSection = {
	id: DocsSectionId;
	title: string;
	items: Array<DocsNavItem & { title: string; href: string }>;
};

export type DocsFrontmatter = {
	title: string;
	description: string;
};

export type DocsTocItem = {
	id: string;
	text: string;
	level: 2 | 3;
};

export type DocsPage = {
	locale: DocsLocale;
	slug: string;
	title: string;
	description: string;
	section: DocsSectionId;
	sectionTitle: string;
	body: string;
	html: string;
	toc: DocsTocItem[];
	prev: DocsSibling | null;
	next: DocsSibling | null;
	/** Absolute path for this page in the current locale. */
	href: string;
	/** Alternate locale path for language switching. */
	alternateHref: string;
};

export type DocsSibling = {
	slug: string;
	title: string;
	href: string;
};

export type DocsSearchEntry = {
	slug: string;
	title: string;
	description: string;
	sectionTitle: string;
	href: string;
	/** Lowercased plain text for matching. */
	text: string;
};
