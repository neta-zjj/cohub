import type {
	BoardArrowItem,
	BoardFileItem,
	BoardFileSnapshot,
	BoardFrame,
	BoardImageItem,
	BoardItem,
	BoardItemStyle,
	BoardMediaSnapshot,
	BoardVideoItem,
} from "@neta-art/cohub/board";
import {
	computeDrawBounds,
	DEFAULT_BOARD_TOOL_STYLES,
	fileBaseName,
	filePreviewKind,
	measureBoardText,
	TEXT_FONT_SIZE,
	unknownRealType,
} from "@neta-art/cohub/board";
import { createBoardItemId } from "$lib/board/board-id";
import { getResourceTitle, inferMediaKind } from "$lib/board/board-media";

const DEFAULT_MEDIA_SIZE = { width: 320, height: 200 };
/** Fallback for video with unknown intrinsic size: the common 16:9 aspect. */
const DEFAULT_VIDEO_SIZE = { width: 320, height: 180 };
/** Offset applied when duplicating so the copy is visibly displaced. */
export const DUPLICATE_OFFSET = 24;

export const DEFAULT_BOARD_ITEM_STYLE: BoardItemStyle = {
	variant: "default",
	size: "md",
	emphasis: "normal",
	effects: [],
};

function createFrame(
	x: number,
	y: number,
	size = DEFAULT_MEDIA_SIZE,
): BoardFrame {
	return { x, y, width: size.width, height: size.height, rotation: 0 };
}

/**
 * Fit media into a max edge while preserving aspect. Falls back to the default
 * media size when intrinsic dimensions are unknown.
 */
export function mediaFrameSize(
	naturalWidth?: number | null,
	naturalHeight?: number | null,
	maxEdge = 480,
	fallback = DEFAULT_MEDIA_SIZE,
): { width: number; height: number } {
	if (
		!naturalWidth ||
		!naturalHeight ||
		!Number.isFinite(naturalWidth) ||
		!Number.isFinite(naturalHeight) ||
		naturalWidth <= 0 ||
		naturalHeight <= 0
	) {
		return { ...fallback };
	}
	const scale = Math.min(1, maxEdge / Math.max(naturalWidth, naturalHeight));
	return {
		width: Math.max(24, naturalWidth * scale),
		height: Math.max(24, naturalHeight * scale),
	};
}

function mediaSnapshot(
	path: string,
	snapshot?: BoardMediaSnapshot,
): BoardMediaSnapshot {
	return {
		title: snapshot?.title ?? getResourceTitle(path),
		mimeType: snapshot?.mimeType,
		size: snapshot?.size,
		mtimeMs: snapshot?.mtimeMs,
		naturalWidth: snapshot?.naturalWidth,
		naturalHeight: snapshot?.naturalHeight,
	};
}

export function createImageBoardItem(
	path: string,
	x: number,
	y: number,
	snapshot?: BoardMediaSnapshot,
): BoardImageItem {
	const size = mediaFrameSize(snapshot?.naturalWidth, snapshot?.naturalHeight);
	return {
		id: createBoardItemId(),
		type: "image",
		ref: { kind: "space-file", path },
		snapshot: mediaSnapshot(path, snapshot),
		frame: createFrame(x - size.width / 2, y - size.height / 2, size),
	};
}

export function createVideoBoardItem(
	path: string,
	x: number,
	y: number,
	snapshot?: BoardMediaSnapshot,
): BoardVideoItem {
	const size = mediaFrameSize(
		snapshot?.naturalWidth,
		snapshot?.naturalHeight,
		480,
		DEFAULT_VIDEO_SIZE,
	);
	return {
		id: createBoardItemId(),
		type: "video",
		ref: { kind: "space-file", path },
		snapshot: mediaSnapshot(path, {
			...snapshot,
			mimeType: snapshot?.mimeType ?? "video/*",
		}),
		frame: createFrame(x - size.width / 2, y - size.height / 2, size),
	};
}

/**
 * Card sizes for a file node. Both are free-form (the shape has no aspect lock)
 * and deliberately small: a file card is an entry point, not a document view.
 */
const DEFAULT_FILE_SIZE = { width: 260, height: 132 };
const DEFAULT_FILE_COVER_SIZE = { width: 260, height: 208 };

/**
 * Create a file card for any workspace file.
 *
 * The size depends on whether a cover will be drawn, so a card created with a
 * snapshot already in hand lands at its final geometry and never resizes under
 * the user. A snapshot is optional: without one this still yields a usable card
 * that can be enriched later.
 */
export function createFileBoardItem(
	path: string,
	x: number,
	y: number,
	snapshot?: BoardFileSnapshot,
): BoardFileItem {
	const size =
		filePreviewKind(snapshot) === "cover"
			? DEFAULT_FILE_COVER_SIZE
			: DEFAULT_FILE_SIZE;
	return {
		id: createBoardItemId(),
		type: "file",
		ref: { kind: "space-file", path },
		snapshot: {
			...snapshot,
			title: snapshot?.title ?? fileBaseName(path),
		},
		frame: createFrame(x - size.width / 2, y - size.height / 2, size),
	};
}

/**
 * Create a node for a dropped space file.
 *
 * Every file is accepted. Images and videos get their dedicated media shapes;
 * everything else — text, binaries, unknown extensions — becomes a file card, so
 * dropping onto a board is never refused and simply varies in how much detail it
 * can show.
 */
export function createFileNodeForPath(
	path: string,
	x: number,
	y: number,
	snapshot?: BoardMediaSnapshot & BoardFileSnapshot,
): BoardImageItem | BoardVideoItem | BoardFileItem {
	const kind = inferMediaKind(path, snapshot?.mimeType);
	if (kind === "image") return createImageBoardItem(path, x, y, snapshot);
	if (kind === "video") return createVideoBoardItem(path, x, y, snapshot);
	return createFileBoardItem(path, x, y, snapshot);
}

/**
 * Create an image or video node from a space file path. Non-media files return
 * null.
 *
 * Prefer `createFileNodeForPath`, which never returns null; this narrower helper
 * remains for callers that specifically want media or nothing.
 */
export function createMediaBoardItem(
	path: string,
	x: number,
	y: number,
	snapshot?: BoardMediaSnapshot,
): BoardImageItem | BoardVideoItem | null {
	const kind = inferMediaKind(path, snapshot?.mimeType);
	if (kind === "image") return createImageBoardItem(path, x, y, snapshot);
	if (kind === "video") return createVideoBoardItem(path, x, y, snapshot);
	return null;
}

export function createTextBoardItem(
	text: string,
	x: number,
	y: number,
	color: string = DEFAULT_BOARD_TOOL_STYLES.text.color,
	fontSize: number = TEXT_FONT_SIZE,
): BoardItem {
	// Anchor at the caret point (top-left of the first line).
	return {
		id: createBoardItemId(),
		type: "text",
		text,
		color,
		fontSize,
		frame: createFrame(x, y, measureBoardText(text, fontSize)),
	};
}

const DEFAULT_GEO_SIZE = { width: 200, height: 140 };

export function createGeoBoardItem(
	geo: string,
	x: number,
	y: number,
	color: string = DEFAULT_BOARD_TOOL_STYLES.geo.color,
	id = createBoardItemId(),
): BoardItem {
	return {
		id,
		type: "geo",
		geo,
		text: "",
		color,
		fillOpacity: 0,
		frame: createFrame(
			x - DEFAULT_GEO_SIZE.width / 2,
			y - DEFAULT_GEO_SIZE.height / 2,
			DEFAULT_GEO_SIZE,
		),
	};
}

/**
 * Create a freehand draw item from raw world-space samples. The frame is the
 * stroke's padded bounds; points are stored relative to the frame origin so a
 * translate moves the whole stroke by patching the frame alone.
 */
export function createDrawBoardItem(
	worldPoints: Array<{ x: number; y: number; p: number }>,
	color: string,
	size: number,
	id = createBoardItemId(),
): BoardItem {
	const bounds = computeDrawBounds(worldPoints, size);
	const points = worldPoints.map((point) => ({
		x: point.x - bounds.x,
		y: point.y - bounds.y,
		p: point.p,
	}));
	return {
		id,
		type: "draw",
		points,
		color,
		size,
		frame: {
			x: bounds.x,
			y: bounds.y,
			width: bounds.width,
			height: bounds.height,
			rotation: 0,
		},
	};
}

/**
 * Create an arrow between two world points. `startBinding`/`endBinding` upgrade
 * an endpoint to a binding when the arrow was drawn from/onto a shape.
 */
export function createArrowBoardItem(
	start: { x: number; y: number },
	end: { x: number; y: number },
	color: string,
	startBinding?: BoardArrowItem["start"],
	endBinding?: BoardArrowItem["end"],
	id = createBoardItemId(),
	size: number = DEFAULT_BOARD_TOOL_STYLES.arrow.size,
): BoardItem {
	const startX = startBinding ?? { kind: "point", x: start.x, y: start.y };
	const endX = endBinding ?? { kind: "point", x: end.x, y: end.y };
	const frame = arrowFrameFromPoints(start, end);
	return {
		id,
		type: "arrow",
		start: startX,
		end: endX,
		bend: 0,
		color,
		size,
		arrowStart: false,
		arrowEnd: true,
		label: "",
		frame,
	};
}

const DEFAULT_FRAME_SIZE = { width: 480, height: 320 };

export function createFrameBoardItem(
	x: number,
	y: number,
	color: string = DEFAULT_BOARD_TOOL_STYLES.frame.color,
	label = "Frame",
	id = createBoardItemId(),
): BoardItem {
	return {
		id,
		type: "frame",
		label,
		color,
		frame: createFrame(
			x - DEFAULT_FRAME_SIZE.width / 2,
			y - DEFAULT_FRAME_SIZE.height / 2,
			DEFAULT_FRAME_SIZE,
		),
	};
}

function arrowFrameFromPoints(
	start: { x: number; y: number },
	end: { x: number; y: number },
): BoardFrame {
	const pad = 16;
	const x = Math.min(start.x, end.x) - pad;
	const y = Math.min(start.y, end.y) - pad;
	return {
		x,
		y,
		width: Math.max(1, Math.abs(end.x - start.x) + pad * 2),
		height: Math.max(1, Math.abs(end.y - start.y) + pad * 2),
		rotation: 0,
	};
}

/**
 * Create a copy of an item with a fresh id. Pass `offset` (defaults to
 * DUPLICATE_OFFSET) to displace the copy; pass 0 for an in-place clone used by
 * Alt-drag (the subsequent drag provides the visual offset).
 */
export function duplicateBoardItem(
	item: BoardItem,
	offset = DUPLICATE_OFFSET,
): BoardItem {
	const frame: BoardFrame = {
		...item.frame,
		x: item.frame.x + offset,
		y: item.frame.y + offset,
	};
	// An arrow's geometry lives in its endpoints, so offset its free endpoints
	// too (bindings stay attached); the editor recomputes an exact frame afterwards.
	if (item.type === "arrow") {
		const move = (
			endpoint: BoardArrowItem["start"],
		): BoardArrowItem["start"] =>
			endpoint.kind === "point"
				? {
						kind: "point",
						x: endpoint.x + offset,
						y: endpoint.y + offset,
					}
				: endpoint;
		return {
			...structuredClone(item),
			id: createBoardItemId(),
			locked: false,
			start: move(item.start),
			end: move(item.end),
			frame,
		};
	}
	return {
		...structuredClone(item),
		id: createBoardItemId(),
		locked: false,
		frame,
	};
}

export function patchItemFrame(
	items: BoardItem[],
	id: string,
	frame: BoardFrame,
) {
	return items.map((item) => (item.id === id ? { ...item, frame } : item));
}

/** Apply a frame patch to many items at once, keyed by id. */
export function patchItemFrames(
	items: BoardItem[],
	frames: Map<string, BoardFrame>,
) {
	if (frames.size === 0) return items;
	return items.map((item) => {
		const frame = frames.get(item.id);
		return frame ? { ...item, frame } : item;
	});
}

export function removeBoardItem(items: BoardItem[], id: string) {
	return items.filter((item) => item.id !== id);
}

export function removeBoardItems(items: BoardItem[], ids: Set<string>) {
	if (ids.size === 0) return items;
	return items.filter((item) => !ids.has(item.id));
}

// ─── Labels ─────────────────────────────────────────────────────────

export function titleForBoardItem(item: BoardItem): string {
	switch (item.type) {
		case "text":
			return item.text.split("\n")[0] || "Text";
		case "geo":
			return item.text.split("\n")[0] || item.geo;
		case "draw":
			return "Drawing";
		case "arrow":
			return item.label || "Arrow";
		case "frame":
			return item.label || "Frame";
		case "image":
		case "video":
			return item.snapshot?.title ?? getResourceTitle(item.ref.path);
		case "file":
			return item.snapshot?.title ?? fileBaseName(item.ref.path);
		default:
			return unknownRealType(item);
	}
}

export function subtitleForBoardItem(item: BoardItem): string {
	switch (item.type) {
		case "text":
			return "Text";
		case "geo":
			return item.geo;
		case "draw":
			return "Drawing";
		case "arrow":
			return "Arrow";
		case "frame":
			return "Frame";
		case "image":
			return "Image";
		case "video":
			return "Video";
		case "file":
			return "File";
		default:
			return unknownRealType(item);
	}
}
