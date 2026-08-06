import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultOgImage, docsJsonLd } from "../lib/seo.ts";

describe("docs seo helpers", () => {
	it("builds TechArticle + BreadcrumbList json-ld", () => {
		const raw = docsJsonLd({
			origin: "https://cohub.run",
			title: "Quick start",
			description: "Ship the main loop.",
			path: "/docs/learn/quick-start",
			locale: "en",
			sectionTitle: "Learn",
			breadcrumbs: [
				{ name: "Docs", path: "/docs" },
				{ name: "Quick start", path: "/docs/learn/quick-start" },
			],
		});
		const data = JSON.parse(raw) as {
			"@graph": Array<Record<string, unknown>>;
		};
		assert.equal(data["@graph"].length, 2);
		assert.equal(data["@graph"][0]?.["@type"], "TechArticle");
		assert.equal(data["@graph"][0]?.headline, "Quick start");
		assert.equal(data["@graph"][0]?.inLanguage, "en");
		assert.equal(data["@graph"][1]?.["@type"], "BreadcrumbList");
	});

	it("uses zh-CN language for Chinese docs", () => {
		const raw = docsJsonLd({
			origin: "https://cohub.run",
			title: "快速开始",
			description: "走通主循环。",
			path: "/docs/zh/learn/quick-start",
			locale: "zh",
			sectionTitle: "入门",
			breadcrumbs: [
				{ name: "文档", path: "/docs/zh" },
				{ name: "快速开始", path: "/docs/zh/learn/quick-start" },
			],
		});
		const data = JSON.parse(raw) as {
			"@graph": Array<Record<string, unknown>>;
		};
		assert.equal(data["@graph"][0]?.inLanguage, "zh-CN");
	});

	it("returns absolute og image", () => {
		assert.equal(
			defaultOgImage("https://cohub.run"),
			"https://cohub.run/pwa/icon-512x512.png",
		);
	});
});
