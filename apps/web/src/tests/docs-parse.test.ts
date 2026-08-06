import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	htmlToPlainText,
	injectHeadingAnchors,
	parseDocsFrontmatter,
	slugifyHeading,
} from "../lib/docs/parse.ts";

describe("docs parse", () => {
	it("parses frontmatter title and description", () => {
		const source = `---
title: Overview
description: A short summary.
---

# Body

Hello.
`;
		const { frontmatter, body } = parseDocsFrontmatter(source);
		assert.equal(frontmatter.title, "Overview");
		assert.equal(frontmatter.description, "A short summary.");
		assert.match(body, /^# Body/);
	});

	it("slugifies headings and injects anchors", () => {
		assert.equal(slugifyHeading("Files & Sandbox"), "files-sandbox");
		assert.equal(slugifyHeading("核心概念"), "核心概念");
		assert.equal(slugifyHeading("1. 创建 Space"), "1-创建-space");
		const { html, toc } = injectHeadingAnchors(
			"<h2>Core concepts</h2><p>x</p><h3>Space</h3>",
		);
		assert.match(html, /id="core-concepts"/);
		assert.match(html, /id="space"/);
		assert.equal(toc.length, 2);
		assert.equal(toc[0]?.id, "core-concepts");
		assert.equal(toc[1]?.level, 3);
	});

	it("keeps chinese heading anchors", () => {
		const { html, toc } = injectHeadingAnchors(
			"<h2>核心概念</h2><h3>创建 Space</h3>",
		);
		assert.match(html, /id="核心概念"/);
		assert.match(html, /id="创建-space"/);
		assert.equal(toc[0]?.text, "核心概念");
	});

	it("dedupes heading ids", () => {
		const { html, toc } = injectHeadingAnchors("<h2>Save</h2><h2>Save</h2>");
		assert.match(html, /id="save"/);
		assert.match(html, /id="save-2"/);
		assert.equal(toc[1]?.id, "save-2");
	});

	it("converts html to plain text", () => {
		assert.equal(
			htmlToPlainText("<p>Hello <strong>world</strong></p>"),
			"Hello world",
		);
	});
});
