/**
 * Board → image in the browser.
 *
 * The heavy lifting is shared with the CLI (`@neta-art/cohub/board/export`):
 * both build a scene from the same card renderers and extract a canvas. What is
 * web-specific lives here — reusing the live renderer and its already-resolved
 * theme colors and loaded textures, then turning the canvas into a download or
 * a clipboard image.
 */

import type {
	BoardDocument,
	BoardItem,
	BoardShapeColors,
} from "@neta-art/cohub/board";
import {
	type BoardExportRegion,
	planBoardExport,
	selectBoardExportAssets,
} from "@neta-art/cohub/board";
import {
	type BoardExportOptions,
	type BoardExportWarning,
	describeBoardExportWarning,
	renderBoardExport,
} from "@neta-art/cohub/board/export";
import type { BoardRenderPalette } from "@neta-art/cohub/board/render";
import type { Renderer, Texture } from "pixi.js";

export type BoardImageFormat = "png" | "jpeg" | "webp";

const MIME: Record<BoardImageFormat, string> = {
	png: "image/png",
	jpeg: "image/jpeg",
	webp: "image/webp",
};

const EXTENSION: Record<BoardImageFormat, string> = {
	png: "png",
	jpeg: "jpg",
	webp: "webp",
};

/**
 * What the live stage lends the exporter.
 *
 * Reusing the mounted renderer avoids standing up a second WebGL context (which
 * on some devices means losing the first one), and reusing the stage's resolved
 * theme means an export picks up a space's `theme.css` exactly as the screen
 * does. Everything is a getter so nothing outlives the stage.
 */
export type BoardStageExportBridge = {
	renderer: () => Renderer | null;
	assetKey: (item: BoardItem) => string | null;
	theme: () => {
		palette: BoardRenderPalette;
		colors: BoardShapeColors;
		colorScheme: "dark" | "light";
	};
	/**
	 * Loads every media preview in `items`, then runs `use` while those textures are still
	 * referenced. Scoped rather than returning a map so a texture cannot be evicted
	 * between loading and drawing.
	 */
	withTextures: <T>(
		items: BoardItem[],
		use: (textures: Map<string, Texture>) => T | Promise<T>,
	) => Promise<T>;
};

export type BoardImageExportResult = {
	blob: Blob;
	width: number;
	height: number;
	scale: number;
	format: BoardImageFormat;
	warnings: string[];
};

function canvasToBlob(
	canvas: HTMLCanvasElement | OffscreenCanvas,
	mimeType: string,
	quality?: number,
): Promise<Blob | null> {
	if ("convertToBlob" in canvas) {
		return canvas.convertToBlob({ type: mimeType, quality }).catch(() => null);
	}
	return new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
}

function describe(warnings: BoardExportWarning[]): string[] {
	return warnings.map(describeBoardExportWarning);
}

/**
 * Render a region of the board to an image blob.
 *
 * Returns null when the region is empty, so callers can treat "nothing
 * selected" as a no-op instead of an error. Media previews outside the viewport
 * are fetched first: the editor only keeps nearby textures resident, and an
 * export that quietly dropped them would be worse than a slow one.
 */
export async function exportBoardImage(
	bridge: BoardStageExportBridge,
	document: BoardDocument,
	options: Omit<BoardExportOptions, "textures"> & {
		format?: BoardImageFormat;
		quality?: number;
	} = {},
): Promise<BoardImageExportResult | null> {
	const renderer = bridge.renderer();
	if (!renderer) throw new Error("The board is not ready to export yet.");
	const { format = "png", quality = 0.92, ...exportOptions } = options;

	const region: BoardExportRegion = exportOptions.region ?? { kind: "all" };
	const plan = planBoardExport({ ...exportOptions, document, region });
	if (!plan) return null;

	const theme = bridge.theme();
	const assets = selectBoardExportAssets(plan.items, bridge.assetKey);
	const omittedKeys = new Set(assets.omittedKeys);
	const cappedAssetKey = (item: BoardItem) => {
		const key = bridge.assetKey(item);
		return key && omittedKeys.has(key) ? null : key;
	};
	// Draw *and* encode inside the texture scope: releasing a reference can evict
	// immediately, and the canvas is only read when it becomes a blob.
	return bridge.withTextures(assets.items, async (textures) => {
		const result = renderBoardExport(renderer, document, {
			palette: theme.palette,
			colors: theme.colors,
			colorScheme: theme.colorScheme,
			...exportOptions,
			region,
			textures,
			assetKey: cappedAssetKey,
		});
		if (!result) return null;

		const canvas = result.canvas as unknown as HTMLCanvasElement;
		const blob = await canvasToBlob(
			canvas,
			MIME[format],
			format === "png" ? undefined : quality,
		);
		if (!blob) throw new Error("This browser could not encode the export.");
		const warnings = describe(result.warnings);
		if (assets.omittedKeys.length > 0) {
			warnings.push(
				`${assets.omittedKeys.length} previews were drawn as placeholders to stay within the export texture limit.`,
			);
		}
		return {
			blob,
			width: result.plan.width,
			height: result.plan.height,
			scale: result.plan.scale,
			format,
			warnings,
		};
	});
}

/** Filename for an export, with a sortable timestamp so repeats do not collide. */
export function boardExportFilename(
	title: string | null | undefined,
	format: BoardImageFormat,
	suffix?: string,
): string {
	const base = (title || "board")
		.replace(/\.board$/i, "")
		.replace(/[^\w\u4e00-\u9fff-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
	const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
	return `${base || "board"}${suffix ? `-${suffix}` : ""}-${stamp}.${EXTENSION[format]}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	anchor.rel = "noopener";
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	// Revoke on the next task: revoking synchronously can cancel the download in
	// some browsers.
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Copy an image to the clipboard.
 *
 * Only PNG is universally accepted by `ClipboardItem`, so callers should pass a
 * PNG blob. Safari requires the `ClipboardItem` to be constructed with a promise
 * inside the same user gesture, hence the two attempts.
 */
export async function copyImageToClipboard(blob: Blob): Promise<void> {
	if (!("clipboard" in navigator) || !("write" in navigator.clipboard)) {
		throw new Error("This browser cannot copy images to the clipboard.");
	}
	const ClipboardItemCtor = globalThis.ClipboardItem;
	if (!ClipboardItemCtor) {
		throw new Error("This browser cannot copy images to the clipboard.");
	}
	try {
		await navigator.clipboard.write([
			new ClipboardItemCtor({ [blob.type]: blob }),
		]);
	} catch {
		await navigator.clipboard.write([
			new ClipboardItemCtor({ [blob.type]: Promise.resolve(blob) }),
		]);
	}
}
