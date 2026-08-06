import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWorkIframeUrl, parseCohubWorkUrl } from "../lib/work-url";

test("parseCohubWorkUrl preserves launch query and hash", () => {
	assert.deepEqual(
		parseCohubWorkUrl(
			"/ada/lab/w/demo?mode=focus&tag=a&tag=b#results",
			"https://cohub.run/spaces/space-1",
		),
		{
			username: "ada",
			spaceSlug: "lab",
			workSlug: "demo",
			search: "?mode=focus&tag=a&tag=b",
			hash: "#results",
		},
	);
});

test("parseCohubWorkUrl still rejects cross-origin work URLs", () => {
	assert.equal(
		parseCohubWorkUrl(
			"https://example.com/ada/lab/w/demo?mode=focus",
			"https://cohub.run/spaces/space-1",
		),
		null,
	);
});

test("buildWorkIframeUrl merges launch state and preserves repeated values", () => {
	assert.equal(
		buildWorkIframeUrl(
			"https://works.cohub.run/site/index.html?asset=1&mode=default#overview",
			{
				search:
					"?mode=focus&tag=a&tag=b&empty=&cohub_checkout=success&cohub_order=order-1",
				hash: "#results",
			},
		),
		"https://works.cohub.run/site/index.html?asset=1&mode=focus&tag=a&tag=b&empty=#results",
	);
});

test("buildWorkIframeUrl keeps content state when no business state is supplied", () => {
	const contentUrl =
		"https://works.cohub.run/site/index.html?cohub_asset=1#overview";
	assert.equal(
		buildWorkIframeUrl(contentUrl, {
			search: "?cohub_checkout=cancel&COHUB_ORDER=order-1",
			hash: "",
		}),
		contentUrl,
	);
	assert.equal(buildWorkIframeUrl(contentUrl, null), contentUrl);
});

test("buildWorkIframeUrl leaves an invalid content URL unchanged", () => {
	assert.equal(
		buildWorkIframeUrl("5173", { search: "?mode=focus", hash: "#results" }),
		"5173",
	);
});
