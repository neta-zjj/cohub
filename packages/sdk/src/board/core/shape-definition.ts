/**
 * ShapeDefinition protocol + registry.
 *
 * A ShapeDefinition describes everything the editor needs to *behave* correctly
 * around a shape — bounds, hit testing, handles, capabilities, snap targets —
 * with no knowledge of how the shape is drawn. The Pixi renderers are a separate
 * concern (board-renderer-registry). This separation is what lets us add a shape
 * by writing one definition + one renderer, and keeps geometry fully unit-testable
 * without a GPU.
 *
 * Definitions are looked up by `item.type`. Unknown types fall back to a generic
 * box definition so unrecognised shapes still select, move and resize.
 */

import {
	frameContainsPoint,
	itemBounds,
	type Rect,
	type WorldPoint,
} from "../geometry.js";
import {
	type BoardFrame,
	type BoardItem,
	isUnknownItem,
} from "@cohub/protocol/board-document";
import {
	resizeModeForCapabilities,
	type ShapeCapabilities,
	type ShapeGeometry,
	type ShapeHandle,
	type ShapeResizeMode,
} from "./shape-types.js";

export type ShapeDefinition = {
	/** The item type this definition handles. */
	type: string;
	capabilities: ShapeCapabilities;
	/** Rotation-aware world bounds (culling, marquee). Defaults to itemBounds. */
	getBounds?: (item: BoardItem) => Rect;
	/** Exact world-space containment (hit testing). Defaults to rotated rect. */
	hitTest?: (item: BoardItem, point: WorldPoint) => boolean;
	/** Interaction handles in the shape's local space. Defaults to none. */
	getHandles?: (item: BoardItem) => ShapeHandle[];
	/**
	 * Local-space geometry outline, used for precise hit tests and snapping.
	 * Optional; box shapes rely on the frame directly.
	 */
	getGeometry?: (item: BoardItem) => ShapeGeometry;
};

const definitions = new Map<string, ShapeDefinition>();

export function registerShapeDefinition(definition: ShapeDefinition) {
	definitions.set(definition.type, definition);
}

export function getShapeDefinition(type: string): ShapeDefinition | undefined {
	return definitions.get(type);
}

/**
 * The generic fallback for unknown shape types: a plain movable/resizable box.
 * This guarantees a shape authored by a newer client is still interactive here.
 */
export const unknownShapeDefinition: ShapeDefinition = {
	type: "__unknown__",
	capabilities: {
		canMove: true,
		canResize: true,
		aspectLocked: false,
		canRotate: true,
		canEdit: false,
		canBind: true,
		canSnap: true,
		canLock: true,
	},
};

export function definitionForItem(item: BoardItem): ShapeDefinition {
	if (isUnknownItem(item)) return unknownShapeDefinition;
	return definitions.get(item.type) ?? unknownShapeDefinition;
}

// ─── Convenience accessors used by the editor ───────────────────────

export function shapeBounds(item: BoardItem): Rect {
	const definition = definitionForItem(item);
	return definition.getBounds?.(item) ?? itemBounds(item.frame);
}

export function shapeHitTest(item: BoardItem, point: WorldPoint): boolean {
	const definition = definitionForItem(item);
	if (definition.hitTest) return definition.hitTest(item, point);
	return frameContainsPoint(item.frame, point);
}

export function shapeHandles(item: BoardItem): ShapeHandle[] {
	const definition = definitionForItem(item);
	return definition.getHandles?.(item) ?? [];
}

export function shapeCapabilities(item: BoardItem): ShapeCapabilities {
	return definitionForItem(item).capabilities;
}

export function shapeResizeMode(item: BoardItem): ShapeResizeMode {
	return resizeModeForCapabilities(shapeCapabilities(item));
}

export type { BoardFrame };
