import { Texture } from "pixi.js";

export const VIDEO_THUMBNAIL_MAX_EDGE = 960;
const VIDEO_LOAD_TIMEOUT_MS = 15_000;
const FRAME_PRESENT_TIMEOUT_MS = 250;

export type VideoNaturalSize = { width: number; height: number };
const naturalSizeByTexture = new WeakMap<Texture, VideoNaturalSize>();

type VideoWithFrameCallback = HTMLVideoElement & {
	requestVideoFrameCallback?: (callback: () => void) => number;
	cancelVideoFrameCallback?: (handle: number) => void;
};

export function videoThumbnailSize(
	width: number,
	height: number,
	maxEdge = VIDEO_THUMBNAIL_MAX_EDGE,
): { width: number; height: number } {
	if (width <= 0 || height <= 0 || maxEdge <= 0) {
		throw new Error("Video has no displayable frame");
	}
	const scale = Math.min(1, maxEdge / Math.max(width, height));
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

function waitForFirstFrame(video: HTMLVideoElement): Promise<void> {
	if (video.readyState >= 2) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(
			() => finish(new Error("Video preview timed out")),
			VIDEO_LOAD_TIMEOUT_MS,
		);
		const onLoaded = () => finish();
		const onError = () =>
			finish(new Error("Video preview could not be decoded"));
		function finish(error?: Error) {
			clearTimeout(timeout);
			video.removeEventListener("loadeddata", onLoaded);
			video.removeEventListener("error", onError);
			if (error) reject(error);
			else resolve();
		}
		video.addEventListener("loadeddata", onLoaded, { once: true });
		video.addEventListener("error", onError, { once: true });
	});
}

function waitForPresentedFrame(video: VideoWithFrameCallback): Promise<void> {
	if (!video.requestVideoFrameCallback) {
		return new Promise((resolve) => requestAnimationFrame(() => resolve()));
	}
	return new Promise((resolve) => {
		let settled = false;
		let timeout: ReturnType<typeof setTimeout>;
		const finish = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			resolve();
		};
		const handle = video.requestVideoFrameCallback(finish);
		timeout = setTimeout(() => {
			video.cancelVideoFrameCallback?.(handle);
			finish();
		}, FRAME_PRESENT_TIMEOUT_MS);
	});
}

export function videoTextureNaturalSize(
	texture: Texture,
): VideoNaturalSize | null {
	return naturalSizeByTexture.get(texture) ?? null;
}

/** Decode one static, bounded preview frame without starting playback. */
export async function loadVideoThumbnailTexture(url: string): Promise<Texture> {
	const video = document.createElement("video") as VideoWithFrameCallback;
	video.muted = true;
	video.playsInline = true;
	video.preload = "auto";
	if (/^https?:/i.test(url)) video.crossOrigin = "anonymous";

	try {
		const ready = waitForFirstFrame(video);
		video.src = url;
		video.load();
		await ready;
		await waitForPresentedFrame(video);

		const size = videoThumbnailSize(video.videoWidth, video.videoHeight);
		const canvas = document.createElement("canvas");
		canvas.width = size.width;
		canvas.height = size.height;
		const context = canvas.getContext("2d", { alpha: false });
		if (!context) throw new Error("Canvas is not supported");
		context.drawImage(video, 0, 0, size.width, size.height);
		const texture = Texture.from(canvas);
		naturalSizeByTexture.set(texture, {
			width: video.videoWidth,
			height: video.videoHeight,
		});
		return texture;
	} finally {
		video.pause();
		video.removeAttribute("src");
		video.load();
	}
}
