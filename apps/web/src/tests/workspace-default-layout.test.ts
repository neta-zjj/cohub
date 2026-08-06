import assert from "node:assert/strict";
import { test } from "node:test";
import {
	parseWorkspaceDefaultLayout,
	resolveDefaultLayoutGeometry,
} from "../lib/features/space/modules/workspace-default-layout.ts";

test("parses sidebar / column / tree enums, ignoring unknown values", () => {
	assert.deepEqual(
		parseWorkspaceDefaultLayout({
			leftSidebar: "collapsed",
			filesColumn: "visible",
			fileTree: "collapsed",
		}),
		{
			leftSidebar: "collapsed",
			filesColumn: "visible",
			fileTree: "collapsed",
		},
	);
	assert.equal(
		parseWorkspaceDefaultLayout({ leftSidebar: "sideways" }),
		undefined,
	);
});

test("normalizes file preview path and accepts board", () => {
	assert.deepEqual(
		parseWorkspaceDefaultLayout({
			preview: { kind: "file", path: "./docs/a.md" },
		}),
		{ preview: { kind: "file", key: "docs/a.md" } },
	);
	assert.deepEqual(
		parseWorkspaceDefaultLayout({
			preview: { kind: "board", path: "/board.board" },
		}),
		{ preview: { kind: "board", key: "board.board" } },
	);
});

test("accepts trusted numeric ports, rejects injection", () => {
	assert.deepEqual(
		parseWorkspaceDefaultLayout({ preview: { kind: "port", port: 5173 } }),
		{
			preview: { kind: "port", key: "5173" },
		},
	);
	assert.equal(
		parseWorkspaceDefaultLayout({ preview: { kind: "port", port: "80@evil" } }),
		undefined,
	);
});

test("keeps presentation only for known modes", () => {
	assert.deepEqual(
		parseWorkspaceDefaultLayout({ presentation: "fullscreen" }),
		{
			presentation: "fullscreen",
		},
	);
	assert.equal(
		parseWorkspaceDefaultLayout({ presentation: "zoom" }),
		undefined,
	);
});

test("returns undefined for empty / non-object input", () => {
	assert.equal(parseWorkspaceDefaultLayout(undefined), undefined);
	assert.equal(parseWorkspaceDefaultLayout({}), undefined);
	assert.equal(parseWorkspaceDefaultLayout("nope"), undefined);
});

test("drops an invalid preview but keeps valid sibling fields", () => {
	assert.deepEqual(
		parseWorkspaceDefaultLayout({
			leftSidebar: "collapsed",
			preview: { kind: "port", port: "not-a-port" },
		}),
		{ leftSidebar: "collapsed" },
	);
});

test("geometry maps enums and presentation modes", () => {
	assert.deepEqual(
		resolveDefaultLayoutGeometry(
			{
				leftSidebar: "collapsed",
				fileTree: "collapsed",
				preview: { kind: "file", key: "README.md" },
				presentation: "fullscreen",
			},
			false,
		),
		{
			leftSidebarCollapsed: true,
			rightSidebarCollapsed: true,
			filesColumnHidden: false,
			presentation: "immersive",
			openPreview: true,
		},
	);
});

test("presentation falls back to default without a preview", () => {
	const geo = resolveDefaultLayoutGeometry({ presentation: "focus" }, false);
	assert.equal(geo.presentation, "default");
	assert.equal(geo.openPreview, false);
});

test("explicit route preview wins over filesColumn: hidden", () => {
	// No config preview, but the URL carries ?preview= — the Files column that
	// renders the preview must stay visible.
	const geo = resolveDefaultLayoutGeometry({ filesColumn: "hidden" }, true);
	assert.equal(geo.filesColumnHidden, false);
	assert.equal(geo.openPreview, false);
});

test("filesColumn: hidden applies only when nothing needs previewing", () => {
	const geo = resolveDefaultLayoutGeometry({ filesColumn: "hidden" }, false);
	assert.equal(geo.filesColumnHidden, true);
});

test("route preview enables config presentation even without config preview", () => {
	const geo = resolveDefaultLayoutGeometry(
		{ presentation: "fullscreen", filesColumn: "hidden" },
		true,
	);
	assert.equal(geo.presentation, "immersive");
	assert.equal(geo.filesColumnHidden, false);
	assert.equal(geo.openPreview, false);
});
