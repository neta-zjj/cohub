import { z } from "zod";
import {
  BOARD_ARROW_STROKE_SIZE,
  BOARD_DRAW_STROKE_SIZE,
  BOARD_TEXT_FONT_SIZE,
  BOARD_TEXT_MAX_FONT_SIZE,
  BOARD_TEXT_MIN_FONT_SIZE,
} from "./board-constants.js";
import { BOARD_DOCUMENT_KIND, BOARD_EXTENSION } from "./board.js";

export { BOARD_DOCUMENT_KIND, BOARD_EXTENSION };

export const BoardFrameSchema = z.object({
	x: z.number().finite(),
	y: z.number().finite(),
	width: z.number().finite().positive(),
	height: z.number().finite().positive(),
	rotation: z.number().finite().default(0),
});

/**
 * The board camera. This is local UI state, not synced content: semantic ops
 * (see diffBoardDocuments) never describe the viewport, and the editor holds
 * the live camera separately from the persisted document. Here it only serves
 * as an initial camera hint when a document is first loaded.
 */
export const BoardViewportSchema = z.object({
	x: z.number().finite(),
	y: z.number().finite(),
	zoom: z.number().finite().min(0.05).max(8),
});

export const BoardAppearanceSchema = z.object({
	theme: z.string().min(1).default("clean"),
	background: z
		.object({
			kind: z
				.enum(["solid", "dots", "grid", "image", "shader", "custom"])
				.default("dots"),
			color: z.string().optional(),
			imageUrl: z.string().url().optional(),
		})
		.default({ kind: "solid" }),
	grid: z
		.object({
			visible: z.boolean().default(false),
			size: z.number().finite().min(4).default(24),
			opacity: z.number().finite().min(0).max(1).default(0.12),
		})
		.default({ visible: false, size: 24, opacity: 0.12 }),
	mood: z
		.enum(["clean", "playful", "arcane", "cyber", "natural"])
		.default("clean"),
});

/** Optional visual chrome still carried by a few older shapes. */
export const BoardItemStyleSchema = z.object({
	variant: z.string().min(1).default("default"),
	theme: z.string().min(1).optional(),
	accentColor: z.string().optional(),
	size: z.enum(["sm", "md", "lg"]).default("md"),
	emphasis: z.enum(["normal", "rare", "epic", "legendary"]).default("normal"),
	effects: z.array(z.string().min(1)).default([]),
});

export const SpaceFileRefSchema = z.object({
	kind: z.literal("space-file"),
	path: z.string().min(1),
});

export const BoardMediaSnapshotSchema = z.object({
	title: z.string().optional(),
	mimeType: z.string().optional(),
	size: z.number().finite().nonnegative().optional(),
	mtimeMs: z.number().finite().nonnegative().optional(),
	/** Intrinsic pixel size once known. */
	naturalWidth: z.number().finite().positive().optional(),
	naturalHeight: z.number().finite().positive().optional(),
});

const BoardItemBaseSchema = z.object({
	id: z.string().min(1),
	frame: BoardFrameSchema,
	/** When true the shape cannot be moved, resized, or deleted. */
	locked: z.boolean().optional(),
	style: BoardItemStyleSchema.optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

/** Freestanding text — no card chrome; its frame always follows the glyphs. */
export const BoardTextItemSchema = BoardItemBaseSchema.extend({
	type: z.literal("text"),
	text: z.string().default(""),
	color: z.string().min(1).default("neutral"),
	fontSize: z
		.number()
		.finite()
		.min(BOARD_TEXT_MIN_FONT_SIZE)
		.max(BOARD_TEXT_MAX_FONT_SIZE)
		.default(BOARD_TEXT_FONT_SIZE),
});

export const BoardGeoItemSchema = BoardItemBaseSchema.extend({
	type: z.literal("geo"),
	geo: z.string().min(1).default("rectangle"),
	text: z.string().default(""),
	color: z.string().min(1).default("brand"),
	fillOpacity: z.number().finite().min(0).max(1).default(0),
});

/** A raw freehand sample. Pressure defaults to 0.5 (mouse) when absent. */
export const DrawPointSchema = z.object({
	x: z.number().finite(),
	y: z.number().finite(),
	p: z.number().finite().min(0).max(1).default(0.5),
});

export const BoardDrawItemSchema = BoardItemBaseSchema.extend({
	type: z.literal("draw"),
	points: z.array(DrawPointSchema).default([]),
	color: z.string().min(1).default("brand"),
	size: z.number().finite().positive().default(BOARD_DRAW_STROKE_SIZE),
});

/** An arrow endpoint: a free point or a binding to another shape. */
export const ArrowEndpointSchema = z.union([
	z.object({
		kind: z.literal("point"),
		x: z.number().finite(),
		y: z.number().finite(),
	}),
	z.object({
		kind: z.literal("binding"),
		target: z.string().min(1),
		nx: z.number().finite().default(0.5),
		ny: z.number().finite().default(0.5),
		precise: z.boolean().default(true),
	}),
]);

export const BoardArrowItemSchema = BoardItemBaseSchema.extend({
	type: z.literal("arrow"),
	start: ArrowEndpointSchema,
	end: ArrowEndpointSchema,
	bend: z.number().finite().default(0),
	color: z.string().min(1).default("brand"),
	size: z.number().finite().positive().default(BOARD_ARROW_STROKE_SIZE),
	arrowStart: z.boolean().default(false),
	arrowEnd: z.boolean().default(true),
	label: z.string().default(""),
});

/** A frame container for organising shapes. */
export const BoardFrameItemSchema = BoardItemBaseSchema.extend({
	type: z.literal("frame"),
	label: z.string().default("Frame"),
	color: z.string().min(1).default("neutral"),
});

/** Image node — space file only, natural aspect, no chrome. */
export const BoardImageItemSchema = BoardItemBaseSchema.extend({
	type: z.literal("image"),
	ref: SpaceFileRefSchema,
	snapshot: BoardMediaSnapshotSchema.optional(),
	/** Optional normalized crop in source image space (0..1). */
	crop: z
		.object({
			x: z.number().finite().min(0).max(1).default(0),
			y: z.number().finite().min(0).max(1).default(0),
			w: z.number().finite().min(0).max(1).default(1),
			h: z.number().finite().min(0).max(1).default(1),
		})
		.optional(),
});

/** Video node — space file only. Playback state is local UI, never synced. */
export const BoardVideoItemSchema = BoardItemBaseSchema.extend({
	type: z.literal("video"),
	ref: SpaceFileRefSchema,
	snapshot: BoardMediaSnapshotSchema.optional(),
});

/**
 * Cached display facts for a file card.
 *
 * Purely derived from the referenced file and versioned by `mtimeMs`, so it is a
 * cache and never a second source of truth: the workspace file remains
 * authoritative, and a stale snapshot is detectable rather than silently wrong.
 * It is stored so that opening a board renders complete cards immediately, with
 * no per-node file read on the first paint.
 */
export const BoardFileSnapshotSchema = z.object({
	title: z.string().optional(),
	mimeType: z.string().optional(),
	size: z.number().finite().nonnegative().optional(),
	mtimeMs: z.number().finite().nonnegative().optional(),
	/** Cleaned leading prose. Capped when written (see FILE_EXCERPT_MAX_CHARS). */
	excerpt: z.string().optional(),
	/** Cover image inside the space, already resolved to a workspace path. */
	coverPath: z.string().optional(),
	/** Cover image at an absolute https URL, as declared by the file itself. */
	coverUrl: z.string().optional(),
});

/**
 * File node — a thumbnail entry point to any workspace file.
 *
 * This is the fallback for every dropped file that is not natively an image or
 * video, including binaries and unknown extensions: a board should never refuse
 * a file, only present it with less detail. Presentation tiers are derived from
 * the snapshot (see filePreviewKind), not stored, so there is no display state
 * to drift from the facts.
 */
export const BoardFileItemSchema = BoardItemBaseSchema.extend({
	type: z.literal("file"),
	ref: SpaceFileRefSchema,
	snapshot: BoardFileSnapshotSchema.optional(),
});

/**
 * The set of shape types this client understands natively. Anything else is
 * preserved verbatim as an unknown item (see BoardUnknownItem) so documents
 * authored by newer clients round-trip losslessly — data is never dropped or
 * silently downgraded just because this client predates a shape type.
 */
export const KNOWN_BOARD_ITEM_TYPES = [
	"image",
	"video",
	"file",
	"text",
	"geo",
	"draw",
	"arrow",
	"frame",
] as const;

export type KnownBoardItemType = (typeof KNOWN_BOARD_ITEM_TYPES)[number];

/**
 * A forward-compatible carrier for shape types this client does not recognise.
 * Its discriminant is the literal `"unknown"` so the item union still narrows
 * cleanly on `type`. The real type string and every original field are preserved
 * verbatim in `raw`.
 */
export const UNKNOWN_BOARD_ITEM_TYPE = "unknown" as const;

export type BoardUnknownItem = {
	id: string;
	type: typeof UNKNOWN_BOARD_ITEM_TYPE;
	frame: z.infer<typeof BoardFrameSchema>;
	locked?: boolean;
	style?: z.infer<typeof BoardItemStyleSchema>;
	metadata?: Record<string, unknown>;
	/** Verbatim original item record (carries the real `type`). */
	raw: Record<string, unknown>;
};

/** The real (preserved) type string of an unknown item. */
export function unknownRealType(item: BoardUnknownItem): string {
	const real = item.raw.type;
	return typeof real === "string" && real ? real : "unknown";
}

export const BoardItemSchema = z
	.any()
	.transform((raw): BoardItem => parseBoardItemLoose(raw));

/**
 * Parse a single item leniently: known types are validated and normalised;
 * anything else becomes a lossless unknown item. Never throws on shape data —
 * a malformed known item degrades to unknown rather than failing the document.
 */
export function parseBoardItemLoose(raw: unknown): BoardItem {
	if (!raw || typeof raw !== "object") {
		return makeUnknownItem(raw);
	}
	const record = raw as Record<string, unknown>;
	const type = record.type;
	switch (type) {
		case "image": {
			const parsed = BoardImageItemSchema.safeParse(raw);
			return parsed.success ? parsed.data : makeUnknownItem(raw);
		}
		case "video": {
			const parsed = BoardVideoItemSchema.safeParse(raw);
			return parsed.success ? parsed.data : makeUnknownItem(raw);
		}
		case "file": {
			const parsed = BoardFileItemSchema.safeParse(raw);
			return parsed.success ? parsed.data : makeUnknownItem(raw);
		}
		case "text": {
			const parsed = BoardTextItemSchema.safeParse(raw);
			return parsed.success ? parsed.data : makeUnknownItem(raw);
		}
		case "geo": {
			const parsed = BoardGeoItemSchema.safeParse(raw);
			return parsed.success ? parsed.data : makeUnknownItem(raw);
		}
		case "draw": {
			const parsed = BoardDrawItemSchema.safeParse(raw);
			return parsed.success ? parsed.data : makeUnknownItem(raw);
		}
		case "arrow": {
			const parsed = BoardArrowItemSchema.safeParse(raw);
			return parsed.success ? parsed.data : makeUnknownItem(raw);
		}
		case "frame": {
			const parsed = BoardFrameItemSchema.safeParse(raw);
			return parsed.success ? parsed.data : makeUnknownItem(raw);
		}
		default:
			return makeUnknownItem(raw);
	}
}

function makeUnknownItem(raw: unknown): BoardUnknownItem {
	const record =
		raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	const frameParsed = BoardFrameSchema.safeParse(record.frame);
	const styleParsed = BoardItemStyleSchema.safeParse(record.style);
	return {
		id: typeof record.id === "string" && record.id ? record.id : "unknown",
		type: UNKNOWN_BOARD_ITEM_TYPE,
		frame: frameParsed.success
			? frameParsed.data
			: { x: 0, y: 0, width: 120, height: 80, rotation: 0 },
		...(record.locked === true ? { locked: true } : {}),
		...(styleParsed.success && record.style ? { style: styleParsed.data } : {}),
		...(record.metadata && typeof record.metadata === "object"
			? { metadata: record.metadata as Record<string, unknown> }
			: {}),
		raw: record,
	};
}

export const BoardDocumentSchema = z.object({
	kind: z.literal(BOARD_DOCUMENT_KIND),
	version: z.literal(1),
	appearance: BoardAppearanceSchema.default({
		theme: "clean",
		background: { kind: "solid" },
		grid: { visible: false, size: 24, opacity: 0.12 },
		mood: "clean",
	}),
	viewport: BoardViewportSchema,
	items: z.array(BoardItemSchema),
});

export type BoardFrame = z.infer<typeof BoardFrameSchema>;
export type BoardViewport = z.infer<typeof BoardViewportSchema>;
export type BoardAppearance = z.infer<typeof BoardAppearanceSchema>;
export type BoardItemStyle = z.infer<typeof BoardItemStyleSchema>;
export type SpaceFileRef = z.infer<typeof SpaceFileRefSchema>;
export type BoardMediaSnapshot = z.infer<typeof BoardMediaSnapshotSchema>;
export type BoardTextItem = z.infer<typeof BoardTextItemSchema>;
export type BoardGeoItem = z.infer<typeof BoardGeoItemSchema>;
export type DrawPoint = z.infer<typeof DrawPointSchema>;
export type BoardDrawItem = z.infer<typeof BoardDrawItemSchema>;
export type ArrowEndpoint = z.infer<typeof ArrowEndpointSchema>;
export type BoardArrowItem = z.infer<typeof BoardArrowItemSchema>;
export type BoardFrameItem = z.infer<typeof BoardFrameItemSchema>;
export type BoardImageItem = z.infer<typeof BoardImageItemSchema>;
export type BoardVideoItem = z.infer<typeof BoardVideoItemSchema>;
export type BoardFileSnapshot = z.infer<typeof BoardFileSnapshotSchema>;
export type BoardFileItem = z.infer<typeof BoardFileItemSchema>;
/** Known (natively handled) item variants. */
export type BoardKnownItem =
	| BoardImageItem
	| BoardVideoItem
	| BoardFileItem
	| BoardTextItem
	| BoardGeoItem
	| BoardDrawItem
	| BoardArrowItem
	| BoardFrameItem;
/** Any item, including forward-compatible unknown types. */
export type BoardItem = BoardKnownItem | BoardUnknownItem;
export type BoardDocument = z.infer<typeof BoardDocumentSchema>;

export function isUnknownItem(item: BoardItem): item is BoardUnknownItem {
	return item.type === UNKNOWN_BOARD_ITEM_TYPE;
}

export function isMediaItem(
	item: BoardItem,
): item is BoardImageItem | BoardVideoItem {
	return item.type === "image" || item.type === "video";
}

/** Whether an item references a workspace file (image, video or file card). */
export function isFileBackedItem(
	item: BoardItem,
): item is BoardImageItem | BoardVideoItem | BoardFileItem {
	return item.type === "image" || item.type === "video" || item.type === "file";
}
