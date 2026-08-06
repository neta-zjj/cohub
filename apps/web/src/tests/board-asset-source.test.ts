import assert from "node:assert/strict";
import test from "node:test";
import type { WorkBoardAsset } from "@neta-art/cohub";
import { createWorkBoardAssetSource } from "$lib/board/board-asset-source";

const MANIFEST_URL = "https://cdn.example/w/space/slug/abc123/board.json";

const source = (assets: WorkBoardAsset[]) =>
	createWorkBoardAssetSource({ manifestUrl: MANIFEST_URL, assets });

test("a captured asset resolves against the artifact prefix", async () => {
	const resolver = source([
		{
			sourcePath: "media/hero.png",
			status: "captured",
			artifactPath: "assets/deadbeef.png",
			mimeType: "image/png",
			sizeBytes: 10,
			sha256: "deadbeef",
		},
	]);
	assert.equal(
		await resolver.resolveFileUrl("media/hero.png"),
		"https://cdn.example/w/space/slug/abc123/assets/deadbeef.png",
	);
});

test("uncaptured and unknown references resolve to null", async () => {
	const resolver = source([
		{ sourcePath: "media/gone.png", status: "missing" },
		{
			sourcePath: "media/big.mov",
			status: "rejected",
			reason: "asset_too_large",
		},
	]);
	// A viewer of a published Board has no access to the origin Space, so an
	// asset that was not captured must not fall back to a workspace path.
	assert.equal(await resolver.resolveFileUrl("media/gone.png"), null);
	assert.equal(await resolver.resolveFileUrl("media/big.mov"), null);
	assert.equal(
		await resolver.resolveFileUrl("media/never-referenced.png"),
		null,
	);
});
