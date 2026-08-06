import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSpaceConfig } from "../lib/space-config-parse.ts";

function bg(background: unknown) {
	const cfg = parseSpaceConfig(
		JSON.stringify({ version: 1, ui: { newChat: { background } } }),
	);
	return cfg?.ui?.newChat?.background;
}

test("keeps https url backgrounds as external url", () => {
	const result = bg({ type: "html", url: "https://example.com/board.html" });
	assert.deepEqual(result?.source, {
		kind: "url",
		url: "https://example.com/board.html",
	});
});

test("keeps web-app-absolute path as external url, not a space path", () => {
	const result = bg({ type: "html", url: "/onboarding/new-chat/index.html" });
	assert.deepEqual(result?.source, {
		kind: "url",
		url: "/onboarding/new-chat/index.html",
	});
});

test("keeps image backgrounds constrained to url sources", () => {
	const result = bg({ type: "image", url: "https://example.com/bg.png" });
	assert.equal(result?.type, "image");
	assert.deepEqual(result?.source, {
		kind: "url",
		url: "https://example.com/bg.png",
	});
});

test("treats a relative html path as a space-local file", () => {
	const result = bg({ type: "html", url: "onboarding/index.html" });
	assert.equal(result?.type, "html");
	assert.deepEqual(result?.source, {
		kind: "space",
		path: "onboarding/index.html",
	});
});

test("normalizes a leading ./ on space paths", () => {
	const result = bg({ type: "html", url: "./onboarding/index.html" });
	assert.deepEqual(result?.source, {
		kind: "space",
		path: "onboarding/index.html",
	});
});

test("rejects path traversal in space paths", () => {
	assert.equal(bg({ type: "html", url: "../secrets/index.html" }), undefined);
	assert.equal(bg({ type: "html", url: "onboarding/../../x.html" }), undefined);
});

test("does not treat relative paths as space files for image/video", () => {
	// image/video need an external url; a bare relative path is not valid.
	assert.equal(bg({ type: "image", url: "assets/bg.png" }), undefined);
	assert.equal(bg({ type: "video", url: "assets/bg.mp4" }), undefined);
});

test("rejects protocol-relative and unknown-scheme urls", () => {
	assert.equal(bg({ type: "html", url: "//evil.example.com/x" }), undefined);
	assert.equal(bg({ type: "html", url: "ftp://example.com/x" }), undefined);
	assert.equal(bg({ type: "html", url: "http://example.com/x" }), undefined);
});

test("disabled background is ignored", () => {
	assert.equal(
		bg({ type: "html", url: "onboarding/index.html", enabled: false }),
		undefined,
	);
});
