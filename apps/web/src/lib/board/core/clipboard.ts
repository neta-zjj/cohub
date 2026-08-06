/**
 * Board clipboard — serialise / deserialise a selection for copy-paste.
 *
 * External clipboard payloads are untrusted: size, item count, per-item schema
 * and id uniqueness are validated before anything is materialised. Failures
 * return null so the paste path can fall back cleanly.
 */

import { BOARD_CLIPBOARD_KIND, BOARD_CLIPBOARD_MIME } from "@cohub/protocol";
import {
	type ArrowEndpoint,
	type BoardItem,
	isUnknownItem,
	KNOWN_BOARD_ITEM_TYPES,
	parseBoardItemLoose,
	selectionBounds,
} from "@neta-art/cohub/board";
import { createBoardItemId } from "$lib/board/board-id";
import { DUPLICATE_OFFSET } from "$lib/board/board-items";

export { BOARD_CLIPBOARD_MIME };
export const BOARD_CLIPBOARD_VERSION = 1 as const;

/**
 * Cap at the server per-transaction op limit so a paste of new nodes always
 * fits in a single commit (avoids local success then persistent 413).
 */
export const MAX_CLIPBOARD_ITEMS = 100;
/** Reject clipboard JSON larger than this (chars). */
export const MAX_CLIPBOARD_CHARS = 256 * 1024;

export type BoardClipboardPayload = {
	kind: typeof BOARD_CLIPBOARD_KIND;
	version: typeof BOARD_CLIPBOARD_VERSION;
	items: BoardItem[];
	origin: { x: number; y: number };
};

export function encodeClipboard(
	items: BoardItem[],
): BoardClipboardPayload | null {
	if (items.length === 0) return null;
	if (items.length > MAX_CLIPBOARD_ITEMS) return null;
	const bounds = selectionBounds(items.map((item) => item.frame));
	if (!bounds) return null;
	const origin = { x: bounds.x, y: bounds.y };
	return {
		kind: BOARD_CLIPBOARD_KIND,
		version: BOARD_CLIPBOARD_VERSION,
		items: items.map((item) => shiftItem(item, -origin.x, -origin.y)),
		origin,
	};
}

/**
 * Parse and validate a clipboard payload. Returns null on any structural or
 * size failure — never throws, never returns half-validated data.
 */
export function parseClipboard(raw: unknown): BoardClipboardPayload | null {
	if (raw == null) return null;
	if (typeof raw === "string") {
		if (raw.length > MAX_CLIPBOARD_CHARS) return null;
		try {
			raw = JSON.parse(raw);
		} catch {
			return null;
		}
	}
	if (!raw || typeof raw !== "object") return null;
	const record = raw as Record<string, unknown>;
	if (record.kind !== BOARD_CLIPBOARD_KIND) return null;
	if (record.version !== BOARD_CLIPBOARD_VERSION) return null;
	if (!Array.isArray(record.items) || record.items.length === 0) return null;
	if (record.items.length > MAX_CLIPBOARD_ITEMS) return null;

	const originRaw = record.origin;
	if (!originRaw || typeof originRaw !== "object") return null;
	const ox = (originRaw as { x?: unknown }).x;
	const oy = (originRaw as { y?: unknown }).y;
	if (typeof ox !== "number" || !Number.isFinite(ox)) return null;
	if (typeof oy !== "number" || !Number.isFinite(oy)) return null;

	const items: BoardItem[] = [];
	const seenIds = new Set<string>();
	for (const entry of record.items) {
		// Reject non-objects before lenient parse (which would invent fallbacks).
		if (!entry || typeof entry !== "object") return null;
		const entryRecord = entry as Record<string, unknown>;
		if (typeof entryRecord.id !== "string" || !entryRecord.id) return null;
		if (typeof entryRecord.type !== "string" || !entryRecord.type) return null;
		if (seenIds.has(entryRecord.id)) return null;
		seenIds.add(entryRecord.id);

		const item = parseBoardItemLoose(entry);
		// Malformed known types degrade to unknown — reject those for clipboard.
		// Intentional forward-compat unknowns (real type outside this client's set)
		// are allowed when they still carry a stable id and type string.
		if (isUnknownItem(item)) {
			const real = item.raw.type;
			if (typeof real !== "string" || !real || real === "unknown") return null;
			if (item.id === "unknown") return null;
			// A known type that failed schema validation is not pasteable content.
			if ((KNOWN_BOARD_ITEM_TYPES as readonly string[]).includes(real))
				return null;
		}
		if (
			!Number.isFinite(item.frame.width) ||
			!Number.isFinite(item.frame.height)
		)
			return null;
		items.push(item);
	}
	if (items.length === 0) return null;

	return {
		kind: BOARD_CLIPBOARD_KIND,
		version: BOARD_CLIPBOARD_VERSION,
		items,
		origin: { x: ox, y: oy },
	};
}

/**
 * Materialise clipboard items: fresh ids, world offset, bindings remapped when
 * the target is also being pasted.
 */
export function materializeClipboard(
	payload: BoardClipboardPayload,
	at: { x: number; y: number },
): BoardItem[] {
	const idMap = new Map<string, string>();
	for (const item of payload.items) idMap.set(item.id, createBoardItemId());
	return payload.items.map((item) => {
		const nextId = idMap.get(item.id) ?? createBoardItemId();
		const shifted = shiftItem(item, at.x, at.y);
		if (shifted.type === "arrow") {
			return {
				...shifted,
				id: nextId,
				locked: false,
				start: remapEndpoint(shifted.start, idMap),
				end: remapEndpoint(shifted.end, idMap),
			};
		}
		return { ...shifted, id: nextId, locked: false };
	});
}

export function defaultPasteOffset(count = 1) {
	return { x: DUPLICATE_OFFSET * count, y: DUPLICATE_OFFSET * count };
}

function shiftItem(item: BoardItem, dx: number, dy: number): BoardItem {
	const frame = { ...item.frame, x: item.frame.x + dx, y: item.frame.y + dy };
	if (item.type === "arrow") {
		return {
			...item,
			frame,
			start: shiftEndpoint(item.start, dx, dy),
			end: shiftEndpoint(item.end, dx, dy),
		};
	}
	return { ...item, frame };
}

function shiftEndpoint(
	endpoint: ArrowEndpoint,
	dx: number,
	dy: number,
): ArrowEndpoint {
	if (endpoint.kind === "point")
		return { kind: "point", x: endpoint.x + dx, y: endpoint.y + dy };
	return endpoint;
}

function remapEndpoint(
	endpoint: ArrowEndpoint,
	idMap: Map<string, string>,
): ArrowEndpoint {
	if (endpoint.kind === "point") return endpoint;
	const mapped = idMap.get(endpoint.target);
	if (!mapped) return endpoint;
	return { ...endpoint, target: mapped };
}
