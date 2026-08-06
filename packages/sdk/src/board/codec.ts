/**
 * Board node ⇄ document decoding.
 *
 * Server nodes are the wire form; a `BoardDocument` is what the renderers and
 * the editor work with. Decoding lives here rather than in the web app because
 * the CLI exporter needs the exact same translation — an exported board must be
 * the same board the editor shows, down to how an unknown shape is preserved.
 *
 * Encoding (document → operations) stays in the editor: it is bound up with
 * diffing and undo, which only the interactive client performs.
 */

import type {
  BoardAppearance,
  BoardArrowItem,
  BoardDocument,
  BoardDrawItem,
  BoardItem,
  BoardMediaSnapshot,
} from "@cohub/protocol/board-document";
import {
  BOARD_DOCUMENT_KIND,
  BoardAppearanceSchema,
  BoardDocumentSchema,
  BoardFileSnapshotSchema,
  UNKNOWN_BOARD_ITEM_TYPE,
} from "@cohub/protocol/board-document";
import type { BoardNodeInput, BoardNodeRecord, BoardRecord } from "@cohub/protocol";
import { clampBoardTextFontSize, TEXT_FONT_SIZE } from "./core/text-metrics.js";

/**
 * Re-exported so consumers can go from a `.board` file to a document without
 * depending on the private protocol package directly.
 */
export {
  InvalidBoardFileError,
  isBoardPath,
  parseBoardManifest,
  serializeBoardManifest,
} from "@cohub/protocol";
export type { BoardManifest, BoardNodeRecord, BoardRecord } from "@cohub/protocol";

export const DEFAULT_BOARD_APPEARANCE: BoardAppearance = BoardAppearanceSchema.parse({
  theme: "clean",
  background: { kind: "solid" },
  grid: { visible: false, size: 24, opacity: 0.12 },
  mood: "clean",
});

export const ITEM_BASE_KEYS = [
	"id",
	"type",
	"frame",
	"locked",
	"style",
	"metadata",
] as const;

/**
 * Original wire data follows an item through immutable object spreads while
 * remaining invisible to JSON serialization. Codecs can then patch only the
 * fields this client understands instead of rebuilding and truncating a node.
 */
export const BOARD_NODE_SOURCE = Symbol("board-node-source");
export type WireBackedBoardItem = BoardItem & {
	[BOARD_NODE_SOURCE]?: BoardNodeInput;
};

export function nodeInputFromRecord(node: BoardNodeRecord): BoardNodeInput {
	return {
		nodeId: node.nodeId,
		type: node.type,
		parentId: node.parentId ?? null,
		orderKey: node.orderKey ?? null,
		x: node.x,
		y: node.y,
		width: node.width,
		height: node.height,
		rotation: node.rotation,
		refKind: node.refKind ?? null,
		refPath: node.refPath ?? null,
		refUrl: node.refUrl ?? null,
		view: node.view ?? {},
		style: node.style ?? {},
		data: node.data ?? {},
	};
}

export function sourceForItem(item: BoardItem): BoardNodeInput | undefined {
	return (item as WireBackedBoardItem)[BOARD_NODE_SOURCE];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function frameFromNode(node: BoardNodeRecord): BoardItem["frame"] {
	return {
		x: node.x,
		y: node.y,
		width: node.width,
		height: node.height,
		rotation: node.rotation,
	};
}

function lockedFromData(data: Record<string, unknown>): boolean | undefined {
	return data.locked === true ? true : undefined;
}

function styleFromNode(node: BoardNodeRecord): BoardItem["style"] {
	return Object.keys(node.style ?? {}).length
		? (node.style as BoardItem["style"])
		: undefined;
}

function spaceFilePathFromNode(node: BoardNodeRecord): string | null {
	if (node.refKind === "space_file" && node.refPath) return node.refPath;
	if (typeof node.refPath === "string" && node.refPath) return node.refPath;
	return null;
}

function boardNodeToItemValue(node: BoardNodeRecord): BoardItem {
	const frame = frameFromNode(node);
	const style = styleFromNode(node);
	const data = (node.data ?? {}) as Record<string, unknown>;
	const locked = lockedFromData(data);
	switch (node.type) {
		case "text":
			return {
				id: node.nodeId,
				type: "text",
				text: typeof data.text === "string" ? data.text : "",
				color: typeof data.color === "string" ? data.color : "neutral",
				fontSize: clampBoardTextFontSize(
					typeof data.fontSize === "number" ? data.fontSize : TEXT_FONT_SIZE,
				),
				frame,
				...(locked ? { locked } : {}),
				style,
			};
		case "geo":
			return {
				id: node.nodeId,
				type: "geo",
				geo: typeof data.geo === "string" ? data.geo : "rectangle",
				text: typeof data.text === "string" ? data.text : "",
				color: typeof data.color === "string" ? data.color : "brand",
				fillOpacity:
					typeof data.fillOpacity === "number" ? data.fillOpacity : 0,
				frame,
				...(locked ? { locked } : {}),
				style,
			};
		case "draw":
			return {
				id: node.nodeId,
				type: "draw",
				points: Array.isArray(data.points)
					? (data.points as BoardDrawItem["points"])
					: [],
				color: typeof data.color === "string" ? data.color : "brand",
				size: typeof data.size === "number" ? data.size : 4,
				frame,
				...(locked ? { locked } : {}),
				style,
			};
		case "arrow":
			return {
				id: node.nodeId,
				type: "arrow",
				start: (data.start ?? {
					kind: "point",
					x: 0,
					y: 0,
				}) as BoardArrowItem["start"],
				end: (data.end ?? {
					kind: "point",
					x: 0,
					y: 0,
				}) as BoardArrowItem["end"],
				bend: typeof data.bend === "number" ? data.bend : 0,
				color: typeof data.color === "string" ? data.color : "brand",
				size: typeof data.size === "number" ? data.size : 2.5,
				arrowStart: Boolean(data.arrowStart),
				arrowEnd: data.arrowEnd === undefined ? true : Boolean(data.arrowEnd),
				label: typeof data.label === "string" ? data.label : "",
				frame,
				...(locked ? { locked } : {}),
				style,
			};
		case "frame":
			return {
				id: node.nodeId,
				type: "frame",
				label: typeof data.label === "string" ? data.label : "Frame",
				color: typeof data.color === "string" ? data.color : "neutral",
				frame,
				...(locked ? { locked } : {}),
				style,
			};
		case "image": {
			const path = spaceFilePathFromNode(node) ?? "missing";
			return {
				id: node.nodeId,
				type: "image",
				ref: { kind: "space-file", path },
				snapshot: node.view as BoardMediaSnapshot,
				...(data.crop && typeof data.crop === "object"
					? {
							crop: data.crop as {
								x: number;
								y: number;
								w: number;
								h: number;
							},
						}
					: {}),
				frame,
				...(locked ? { locked } : {}),
				style,
			};
		}
		case "video": {
			const path = spaceFilePathFromNode(node) ?? "missing";
			return {
				id: node.nodeId,
				type: "video",
				ref: { kind: "space-file", path },
				snapshot: node.view as BoardMediaSnapshot,
				frame,
				...(locked ? { locked } : {}),
				style,
			};
		}
		case "file": {
			const path = spaceFilePathFromNode(node) ?? "missing";
			// Display facts live in `view` alongside image/video snapshots; they are a
			// cache of the referenced file, so a malformed one degrades to a blank
			// card rather than failing the node.
			const parsed = BoardFileSnapshotSchema.safeParse(node.view ?? {});
			return {
				id: node.nodeId,
				type: "file",
				ref: { kind: "space-file", path },
				...(parsed.success ? { snapshot: parsed.data } : {}),
				frame,
				...(locked ? { locked } : {}),
				style,
			};
		}
		default: {
			// Unknown shape type: preserve the node's opaque fields verbatim so a
			// newer client's shape survives a round-trip through this client. The
			// item discriminant is the reserved "unknown" literal; the real type and
			// custom fields live in `raw`.
			const raw: Record<string, unknown> = {
				...data,
				id: node.nodeId,
				type: node.type,
				frame,
			};
			if (style) raw.style = style;
			if (locked) raw.locked = true;
			return {
				id: node.nodeId,
				type: UNKNOWN_BOARD_ITEM_TYPE,
				frame,
				...(locked ? { locked } : {}),
				style,
				raw,
			};
		}
	}
}

export function boardNodeToItem(node: BoardNodeRecord): BoardItem {
	const item = boardNodeToItemValue(node);
	const metadata = isRecord(node.data?.metadata)
		? node.data.metadata
		: undefined;
	return {
		...item,
		...(metadata ? { metadata } : {}),
		[BOARD_NODE_SOURCE]: nodeInputFromRecord(node),
	} as unknown as BoardItem;
}

export function boardBootstrapToDocument(input: {
	board: BoardRecord;
	nodes: BoardNodeRecord[];
}): BoardDocument {
	const appearance = BoardAppearanceSchema.safeParse(
		input.board.metadata.appearance,
	);
	const document = BoardDocumentSchema.parse({
		kind: BOARD_DOCUMENT_KIND,
		version: 1,
		appearance: appearance.success ? appearance.data : DEFAULT_BOARD_APPEARANCE,
		viewport: { x: 0, y: 0, zoom: 1 },
		items: input.nodes.map(boardNodeToItem),
	});
	const sources = new Map(
		input.nodes.map((node) => [node.nodeId, nodeInputFromRecord(node)]),
	);
	return {
		...document,
		items: document.items.map((item) => ({
			...item,
			[BOARD_NODE_SOURCE]: sources.get(item.id),
		})) as BoardItem[],
	};
}
