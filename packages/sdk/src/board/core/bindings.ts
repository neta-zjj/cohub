/**
 * Arrow bindings — pure geometry for connecting arrows to shapes.
 *
 * An arrow endpoint is either a free world point or a *binding*: a normalized
 * anchor (0..1) on a target shape's frame. Because the anchor is relative, the
 * arrow tracks the target through move and resize with no stored absolute
 * coordinates — the binding never goes stale. Resolution to world space happens
 * here, given a frame lookup, so it is fully testable and renderer-independent.
 */

import {
	degToRad,
	type Rect,
	rectCenter,
	rotatePointAround,
	type WorldPoint,
	worldPoint,
} from "../geometry.js";
import type {
	ArrowEndpoint,
	BoardArrowItem,
	BoardFrame,
} from "@cohub/protocol/board-document";

export type FrameLookup = (id: string) => BoardFrame | undefined;

/** Denormalize a binding anchor to a world point on the (rotated) frame. */
export function anchorToWorld(
	frame: BoardFrame,
	nx: number,
	ny: number,
): WorldPoint {
	const unrotated = worldPoint(
		frame.x + nx * frame.width,
		frame.y + ny * frame.height,
	);
	if (!frame.rotation) return unrotated;
	return rotatePointAround(
		unrotated,
		rectCenter(frame),
		degToRad(frame.rotation),
	);
}

/** Normalize a world point to a binding anchor on the (rotated) frame, clamped. */
export function worldToAnchor(
	frame: BoardFrame,
	point: WorldPoint,
): { nx: number; ny: number } {
	let local = point;
	if (frame.rotation)
		local = rotatePointAround(
			point,
			rectCenter(frame),
			-degToRad(frame.rotation),
		);
	const nx = clamp01((local.x - frame.x) / frame.width);
	const ny = clamp01((local.y - frame.y) / frame.height);
	return { nx, ny };
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

/** Resolve an endpoint to a world point, or null if a binding target is gone. */
export function resolveEndpoint(
	endpoint: ArrowEndpoint,
	getFrame: FrameLookup,
): WorldPoint | null {
	if (endpoint.kind === "point") return worldPoint(endpoint.x, endpoint.y);
	const frame = getFrame(endpoint.target);
	if (!frame) return null;
	return anchorToWorld(frame, endpoint.nx, endpoint.ny);
}

export type ResolvedArrow = {
	start: WorldPoint;
	end: WorldPoint;
	/** Quadratic control point (already bent); equals midpoint when bend is 0. */
	control: WorldPoint;
};

/** Resolve both endpoints and compute the bent control point. */
export function resolveArrow(
	item: BoardArrowItem,
	getFrame: FrameLookup,
): ResolvedArrow | null {
	const start = resolveEndpoint(item.start, getFrame);
	const end = resolveEndpoint(item.end, getFrame);
	if (!start || !end) return null;
	const mid = worldPoint((start.x + end.x) / 2, (start.y + end.y) / 2);
	if (!item.bend) return { start, end, control: mid };
	// Offset the control point perpendicular to the arrow by bend × length.
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const length = Math.hypot(dx, dy) || 1;
	const offset = item.bend * length;
	const control = worldPoint(
		mid.x + (-dy / length) * offset,
		mid.y + (dx / length) * offset,
	);
	return { start, end, control };
}

/** World-space bounds of an arrow, sampling the curve for accuracy. */
export function arrowBounds(
	item: BoardArrowItem,
	getFrame: FrameLookup,
): Rect | null {
	const resolved = resolveArrow(item, getFrame);
	if (!resolved) return null;
	const samples = sampleQuadratic(resolved, 12);
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const p of samples) {
		minX = Math.min(minX, p.x);
		minY = Math.min(minY, p.y);
		maxX = Math.max(maxX, p.x);
		maxY = Math.max(maxY, p.y);
	}
	const pad = Math.max(8, item.size * 2);
	return {
		x: minX - pad,
		y: minY - pad,
		width: Math.max(1, maxX - minX + pad * 2),
		height: Math.max(1, maxY - minY + pad * 2),
	};
}

/** Sample the arrow's quadratic curve into world points (for render/hit-test). */
export function sampleQuadratic(
	resolved: ResolvedArrow,
	segments: number,
): WorldPoint[] {
	const { start, control, end } = resolved;
	const out: WorldPoint[] = [];
	for (let i = 0; i <= segments; i += 1) {
		const t = i / segments;
		const mt = 1 - t;
		out.push(
			worldPoint(
				mt * mt * start.x + 2 * mt * t * control.x + t * t * end.x,
				mt * mt * start.y + 2 * mt * t * control.y + t * t * end.y,
			),
		);
	}
	return out;
}

/** Distance from a world point to the arrow curve (hit testing). */
export function distanceToArrow(
	item: BoardArrowItem,
	getFrame: FrameLookup,
	point: WorldPoint,
): number {
	const resolved = resolveArrow(item, getFrame);
	if (!resolved) return Number.POSITIVE_INFINITY;
	const samples = sampleQuadratic(resolved, 16);
	let min = Number.POSITIVE_INFINITY;
	for (let i = 0; i < samples.length - 1; i += 1) {
		const from = samples[i];
		const to = samples[i + 1];
		if (!from || !to) continue;
		const d = segmentDistance(point, from, to);
		if (d < min) min = d;
	}
	return min;
}

function segmentDistance(p: WorldPoint, a: WorldPoint, b: WorldPoint): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const lengthSq = dx * dx + dy * dy;
	if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
	const t = Math.min(
		1,
		Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq),
	);
	return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Turn a free endpoint into a binding if a candidate target frame contains the
 * point; otherwise keep it free. Used while dragging an arrow handle so the
 * arrow "connects" to shapes it lands on.
 */
export function bindEndpointAt(
	point: WorldPoint,
	target: { id: string; frame: BoardFrame } | null,
): ArrowEndpoint {
	if (!target) return { kind: "point", x: point.x, y: point.y };
	const { nx, ny } = worldToAnchor(target.frame, point);
	return { kind: "binding", target: target.id, nx, ny, precise: true };
}

/**
 * Translate an arrow by a delta: free endpoints move; bindings stay attached to
 * their targets (so a bound end anchors while the rest of the arrow moves). The
 * frame — a derived bounding box, not a transform — is recomputed from the new
 * endpoint geometry.
 */
export function translateArrow(
	item: BoardArrowItem,
	dx: number,
	dy: number,
	getFrame: FrameLookup,
): BoardArrowItem {
	const move = (endpoint: ArrowEndpoint): ArrowEndpoint =>
		endpoint.kind === "point"
			? { kind: "point", x: endpoint.x + dx, y: endpoint.y + dy }
			: endpoint;
	const next: BoardArrowItem = {
		...item,
		start: move(item.start),
		end: move(item.end),
	};
	const bounds = arrowBounds(next, getFrame);
	return bounds ? { ...next, frame: { ...bounds, rotation: 0 } } : next;
}
