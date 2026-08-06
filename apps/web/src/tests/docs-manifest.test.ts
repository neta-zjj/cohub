import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	alternateDocsHref,
	docsHref,
	findDocsNavItem,
	getDocsNavItems,
	getDocsNavTitle,
	getDocsSections,
	parseDocsPath,
} from "../lib/docs/manifest.ts";

describe("docs manifest", () => {
	it("keeps a continuous prev/next order", () => {
		const items = getDocsNavItems();
		assert.ok(items.length >= 8);
		assert.equal(items[0]?.slug, "");
		assert.equal(docsHref(""), "/docs");
		assert.equal(docsHref("learn/quick-start"), "/docs/learn/quick-start");
		assert.equal(docsHref("", "zh"), "/docs/zh");
		assert.equal(
			docsHref("learn/quick-start", "zh"),
			"/docs/zh/learn/quick-start",
		);
	});

	it("only returns sections that have pages", () => {
		const sections = getDocsSections("en");
		assert.ok(sections.every((section) => section.items.length > 0));
		assert.ok(sections.some((section) => section.id === "learn"));
		assert.ok(sections.some((section) => section.id === "developers"));
		assert.ok(!sections.some((section) => section.id === "account"));
	});

	it("localizes section and nav titles", () => {
		const zh = getDocsSections("zh");
		assert.equal(zh[0]?.title, "入门");
		assert.equal(getDocsNavTitle("learn/quick-start", "zh"), "快速开始");
		assert.equal(zh[0]?.items[0]?.href, "/docs/zh");
	});

	it("finds nav items by slug", () => {
		assert.equal(findDocsNavItem("workspace/chats")?.title, "Chats");
		assert.equal(findDocsNavItem("/workspace/chats/")?.title, "Chats");
		assert.equal(findDocsNavItem("missing"), null);
	});

	it("parses locale paths", () => {
		assert.deepEqual(parseDocsPath("/docs"), { locale: "en", slug: "" });
		assert.deepEqual(parseDocsPath("/docs/zh"), { locale: "zh", slug: "" });
		assert.deepEqual(parseDocsPath("/docs/learn/quick-start"), {
			locale: "en",
			slug: "learn/quick-start",
		});
		assert.deepEqual(parseDocsPath("/docs/zh/workspace/chats"), {
			locale: "zh",
			slug: "workspace/chats",
		});
		assert.equal(
			alternateDocsHref("workspace/chats", "en"),
			"/docs/zh/workspace/chats",
		);
		assert.equal(
			alternateDocsHref("workspace/chats", "zh"),
			"/docs/workspace/chats",
		);
	});
});
