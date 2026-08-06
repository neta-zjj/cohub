import assert from "node:assert/strict";
import { test } from "node:test";
import {
	VIDEO_THUMBNAIL_MAX_EDGE,
	videoThumbnailSize,
} from "../lib/board/board-video-thumbnail.ts";

test("video thumbnails preserve aspect without upscaling", () => {
	assert.deepEqual(videoThumbnailSize(640, 360), { width: 640, height: 360 });
	assert.deepEqual(videoThumbnailSize(3840, 2160), {
		width: VIDEO_THUMBNAIL_MAX_EDGE,
		height: 540,
	});
	assert.deepEqual(videoThumbnailSize(1080, 1920), {
		width: 540,
		height: VIDEO_THUMBNAIL_MAX_EDGE,
	});
});

test("video thumbnails reject missing dimensions", () => {
	assert.throws(() => videoThumbnailSize(0, 1080), /no displayable frame/);
	assert.throws(() => videoThumbnailSize(1920, 0), /no displayable frame/);
});
