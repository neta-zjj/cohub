import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildFileExcerpt,
	buildFileSnapshot,
	FILE_EXCERPT_MAX_CHARS,
	filePreviewKind,
	fileTypeLabel,
	formatFileSize,
	isFileSnapshotFresh,
	readCoverFromFrontmatter,
	readTitleFromFrontmatter,
	resolveCoverRef,
	resolveSpacePath,
	splitFrontmatter,
} from "@neta-art/cohub/board";

test("preview tier is derived from the facts present", () => {
	assert.equal(filePreviewKind(undefined), "blank");
	assert.equal(filePreviewKind({}), "blank");
	assert.equal(filePreviewKind({ excerpt: "hello" }), "text");
	assert.equal(filePreviewKind({ coverPath: "a/b.png" }), "cover");
	assert.equal(filePreviewKind({ coverUrl: "https://x/y.png" }), "cover");
	// A cover outranks an excerpt: it is the stronger signal.
	assert.equal(filePreviewKind({ excerpt: "hi", coverPath: "a.png" }), "cover");
});

test("type label handles extensions, dotfiles and bare names", () => {
	assert.equal(fileTypeLabel("docs/readme.md"), "MD");
	assert.equal(fileTypeLabel("a/b/data.tar.gz"), "GZ");
	assert.equal(fileTypeLabel(".npmrc"), "NPMRC");
	assert.equal(fileTypeLabel("Makefile"), "MAKEFILE");
	assert.equal(fileTypeLabel("src/"), "SRC");
});

test("file size formatting stays compact", () => {
	assert.equal(formatFileSize(0), "0 B");
	assert.equal(formatFileSize(512), "512 B");
	assert.equal(formatFileSize(2048), "2.0 KB");
	assert.equal(formatFileSize(20 * 1024), "20 KB");
	assert.equal(formatFileSize(5 * 1024 * 1024), "5.0 MB");
	assert.equal(formatFileSize(undefined), "");
});

test("frontmatter is split only when terminated", () => {
	const ok = splitFrontmatter("---\ntitle: A\n---\nbody here");
	assert.equal(ok.frontmatter, "title: A");
	assert.equal(ok.body, "body here");

	// Unterminated: treat everything as body rather than guessing.
	const bad = splitFrontmatter("---\ntitle: A\nbody");
	assert.equal(bad.frontmatter, null);
	assert.equal(bad.body, "---\ntitle: A\nbody");

	const none = splitFrontmatter("# Heading\ntext");
	assert.equal(none.frontmatter, null);
});

test("cover key precedence and nesting", () => {
	assert.equal(readCoverFromFrontmatter("image: b.png\ncover: a.png"), "a.png");
	assert.equal(readCoverFromFrontmatter("banner: c.png"), "c.png");
	assert.equal(readCoverFromFrontmatter('cover: "quoted.png"'), "quoted.png");
	// Nested keys belong to some other mapping, not the file itself.
	assert.equal(readCoverFromFrontmatter("other:\n  cover: nested.png"), null);
	assert.equal(readCoverFromFrontmatter(null), null);
});

test("title is read only from a non-empty top-level frontmatter scalar", () => {
	assert.equal(readTitleFromFrontmatter("title: A warm story"), "A warm story");
	assert.equal(readTitleFromFrontmatter('title: "Cats: Dogs"'), "Cats: Dogs");
	assert.equal(readTitleFromFrontmatter("title:\n  nested: value"), null);
	assert.equal(readTitleFromFrontmatter("meta:\n  title: Nested"), null);
});

test("https covers are allowed; insecure and opaque schemes are not", () => {
	assert.deepEqual(resolveCoverRef("a/b.md", "https://cdn.example/x.png"), {
		kind: "url",
		url: "https://cdn.example/x.png",
	});
	// Protocol-relative is read as https.
	assert.deepEqual(resolveCoverRef("a/b.md", "//cdn.example/x.png"), {
		kind: "url",
		url: "https://cdn.example/x.png",
	});
	// Plain http would downgrade the page to mixed content.
	assert.equal(resolveCoverRef("a/b.md", "http://cdn.example/x.png"), null);
	// data:/blob: would embed opaque, unbounded bytes into board data.
	assert.equal(resolveCoverRef("a/b.md", "data:image/png;base64,AAAA"), null);
	assert.equal(resolveCoverRef("a/b.md", "blob:https://x/abc"), null);
	assert.equal(resolveCoverRef("a/b.md", "   "), null);
});

test("relative covers resolve against the file's directory", () => {
	assert.deepEqual(resolveCoverRef("docs/guide/a.md", "./cover.png"), {
		kind: "path",
		path: "docs/guide/cover.png",
	});
	assert.deepEqual(resolveCoverRef("docs/guide/a.md", "../assets/c.png"), {
		kind: "path",
		path: "docs/assets/c.png",
	});
	// A leading slash means space root, not filesystem root.
	assert.deepEqual(resolveCoverRef("docs/guide/a.md", "/top.png"), {
		kind: "path",
		path: "top.png",
	});
});

test("path resolution cannot escape the space root", () => {
	assert.equal(
		resolveSpacePath("a/b.md", "../../../../etc/passwd"),
		"etc/passwd",
	);
	assert.equal(resolveSpacePath("a/b.md", "./x/./y.png"), "a/x/y.png");
});

test("excerpt flattens markdown decoration", () => {
	const source = [
		"# Title",
		"",
		"Some **bold** and `code` text with a [link](https://x).",
		"",
		"```js",
		"const noise = 1;",
		"```",
		"",
		"> quoted line",
		"- bullet one",
	].join("\n");
	const excerpt = buildFileExcerpt(source);
	assert.ok(excerpt.startsWith("Title"));
	assert.ok(excerpt.includes("bold and code text with a link."));
	assert.ok(!excerpt.includes("const noise"), "fenced code is dropped");
	assert.ok(!excerpt.includes(">"), "quote markers are stripped");
});

test("excerpt drops images but keeps link text", () => {
	const excerpt = buildFileExcerpt("![alt text](a.png) real content");
	assert.ok(!excerpt.includes("alt text"));
	assert.ok(excerpt.includes("real content"));
});

test("excerpt is capped and cut at a word boundary", () => {
	const source = `${"word ".repeat(400)}end`;
	const excerpt = buildFileExcerpt(source);
	assert.ok(excerpt.length <= FILE_EXCERPT_MAX_CHARS + 1, "within the cap");
	assert.ok(excerpt.endsWith("…"));
	assert.ok(!excerpt.endsWith("wor…"), "not cut mid-token");
});

test("snapshot builds from metadata alone when content is absent", () => {
	const snapshot = buildFileSnapshot({
		path: "data/blob.bin",
		mimeType: "application/octet-stream",
		size: 1234,
		mtimeMs: 99,
	});
	assert.equal(snapshot.title, "blob.bin");
	assert.equal(snapshot.size, 1234);
	assert.equal(snapshot.excerpt, undefined);
	assert.equal(filePreviewKind(snapshot), "blank");
});

test("snapshot extracts title, cover and excerpt from markdown", () => {
	const snapshot = buildFileSnapshot({
		path: "docs/post.md",
		title: "post.md",
		content:
			"---\ntitle: Cats and Dogs\ncover: ./hero.png\n---\nThe body text.",
		mimeType: "text/markdown",
		size: 40,
		mtimeMs: 7,
	});
	assert.equal(snapshot.title, "Cats and Dogs");
	assert.equal(snapshot.coverPath, "docs/hero.png");
	assert.equal(snapshot.excerpt, "The body text.");
	// Frontmatter must not leak into the excerpt.
	assert.ok(!snapshot.excerpt?.includes("cover"));
	assert.equal(filePreviewKind(snapshot), "cover");
});

test("snapshot freshness is keyed on mtime and size", () => {
	const snapshot = { mtimeMs: 10, size: 100 };
	assert.equal(isFileSnapshotFresh(snapshot, { mtimeMs: 10, size: 100 }), true);
	assert.equal(
		isFileSnapshotFresh(snapshot, { mtimeMs: 11, size: 100 }),
		false,
	);
	assert.equal(
		isFileSnapshotFresh(snapshot, { mtimeMs: 10, size: 101 }),
		false,
	);
	// Unknown mtime cannot prove freshness.
	assert.equal(isFileSnapshotFresh(snapshot, {}), false);
	assert.equal(isFileSnapshotFresh(undefined, { mtimeMs: 10 }), false);
});
