/**
 * Renderer-independent shape primitives.
 *
 * Everything here is pure geometry / data — no Pixi, no Svelte, no DOM. This is
 * the foundation that shapes, tools, snapping, bindings, the server and tests
 * all share, so a shape's behaviour is defined once and never coupled to how it
 * is drawn. The Pixi layer consumes these; it never defines them.
 */

import type { Rect, WorldPoint } from "../geometry.js";
import type { BoardFrame } from "@cohub/protocol/board-document";

// ─── Shape geometry ─────────────────────────────────────────────────

/**
 * A shape's geometry, expressed in the shape's local space (origin at the
 * frame's top-left, unrotated). Hit testing and handles are derived from this,
 * so a shape only declares its outline once.
 */
export type ShapeGeometry = {
	/** Axis-aligned bounds in local space (usually the full frame). */
	bounds: Rect;
	/**
	 * Exact point containment test in *world* space. Receives the shape frame so
	 * it can account for rotation. Defaults to the rotated-rect test when absent.
	 */
	containsWorldPoint?: (frame: BoardFrame, point: WorldPoint) => boolean;
};

// ─── Handles ────────────────────────────────────────────────────────

export type ShapeHandleId = string;

export type ShapeHandle = {
	id: ShapeHandleId;
	/** Position in the shape's local (unrotated, frame-origin) space. */
	x: number;
	y: number;
	/** Visual + hit radius hint in screen px; the stage scales by zoom. */
	radius?: number;
};

/** Result of dragging a handle: a patched frame and/or shape props. */
export type HandleDragResult = {
	frame?: BoardFrame;
	props?: Record<string, unknown>;
};

// ─── Capabilities ───────────────────────────────────────────────────

/**
 * What a shape supports. The editor, selection toolbar and tools read these so
 * behaviour is data-driven: adding a shape never requires editing the editor.
 */
export type ShapeCapabilities = {
	/** Can be moved by dragging. */
	canMove: boolean;
	/** Shows resize handles. */
	canResize: boolean;
	/**
	 * Resize always preserves the shape's aspect ratio, regardless of Shift.
	 * True for shapes whose content has a single intrinsic scale (text font size,
	 * media pixels, stroke geometry) — distorting the frame would either letterbox
	 * the content or have no representation in the data model.
	 */
	aspectLocked: boolean;
	/** Shows the rotation handle. */
	canRotate: boolean;
	/** Supports double-click inline editing. */
	canEdit: boolean;
	/** Can be a binding target for arrows. */
	canBind: boolean;
	/** Participates in snapping as a target. */
	canSnap: boolean;
	/** Can be locked against accidental edits. */
	canLock: boolean;
};

/**
 * Effective resize behaviour derived from the backwards-compatible capability
 * flags. Consumers should use this mode instead of repeating the flag matrix.
 */
export type ShapeResizeMode = "none" | "uniform" | "free";

export function resizeModeForCapabilities(
	capabilities: ShapeCapabilities,
): ShapeResizeMode {
	if (!capabilities.canResize) return "none";
	return capabilities.aspectLocked ? "uniform" : "free";
}

export const FULL_CAPABILITIES: ShapeCapabilities = {
	canMove: true,
	canResize: true,
	aspectLocked: false,
	canRotate: true,
	canEdit: false,
	canBind: true,
	canSnap: true,
	canLock: true,
};

// ─── Draw shape ─────────────────────────────────────────────────────

/**
 * A single raw input sample of a freehand stroke. We persist the *raw* samples
 * (not just a simplified path) so strokes can be re-smoothed, re-simplified or
 * re-rendered at any LOD later without losing information — data first.
 */
export type DrawPoint = {
	x: number;
	y: number;
	/** Pen pressure 0..1; 0.5 when unavailable (mouse). */
	p: number;
};

export type DrawShapeProps = {
	/** Raw samples in the shape's local space. */
	points: DrawPoint[];
	color: string;
	/** Stroke width in world units. */
	size: number;
};

// ─── Geo shape ──────────────────────────────────────────────────────

export type GeoKind =
	| "rectangle"
	| "ellipse"
	| "diamond"
	| "triangle"
	| "rounded";

export const GEO_KINDS: readonly GeoKind[] = [
	"rectangle",
	"rounded",
	"ellipse",
	"diamond",
	"triangle",
] as const;

export function isGeoKind(value: unknown): value is GeoKind {
	return (
		typeof value === "string" &&
		(GEO_KINDS as readonly string[]).includes(value)
	);
}

export type GeoShapeProps = {
	geo: GeoKind;
	/** Optional label rendered centered inside the shape. */
	text: string;
	color: string;
	/** Fill opacity 0..1 (0 = outline only). */
	fillOpacity: number;
};

// ─── Arrow shape ────────────────────────────────────────────────────

/**
 * An arrow endpoint: either a free point (local space) or a binding to another
 * shape. Bindings use a normalized anchor (0..1 of the target's frame) so the
 * arrow tracks the target through move/resize without storing absolute coords.
 */
export type ArrowEndpoint =
	| { kind: "point"; x: number; y: number }
	| {
			kind: "binding";
			/** Target shape id. */
			target: string;
			/** Normalized anchor on the target frame (0..1). */
			nx: number;
			ny: number;
			/** Whether the binding snaps to the nearest edge/center. */
			precise: boolean;
	  };

export type ArrowShapeProps = {
	start: ArrowEndpoint;
	end: ArrowEndpoint;
	/** Bend of a curved arrow, as a fraction of the length (-0.5..0.5). */
	bend: number;
	color: string;
	size: number;
	/** Arrowhead placement. */
	arrowStart: boolean;
	arrowEnd: boolean;
	label: string;
};

// ─── Text shape ─────────────────────────────────────────────────────

export type TextShapeProps = {
	text: string;
	color: string;
	fontSize: number;
};

// ─── Media shapes ───────────────────────────────────────────────────

export type ImageShapeProps = {
	path: string;
	mimeType?: string;
};

export type VideoShapeProps = {
	path: string;
	mimeType?: string;
};
