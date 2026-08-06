/**
 * Freehand stroke geometry — pure functions over raw draw points.
 *
 * We persist raw samples (see DrawPoint) and derive everything else here:
 * bounds, simplified paths for low zoom (LOD), a variable-width outline polygon
 * for rendering, and a hit test. Keeping this renderer-independent means the
 * stroke can be re-rendered at any detail level and tested without a GPU.
 */

import type { Rect, WorldPoint } from "../geometry.js";
import type { DrawPoint } from "@cohub/protocol/board-document";
import { getStroke } from "perfect-freehand";

/** Radius of a sample in world units given the stroke size and pressure. */
export function sampleRadius(size: number, pressure: number): number {
	// Pressure modulates width gently; a mouse (p=0.5) yields the base size.
	const clamped = Math.min(1, Math.max(0, pressure));
	return Math.max(0.5, (size / 2) * (0.5 + clamped));
}

/** Axis-aligned bounds of a stroke in its local space, padded by stroke width. */
export function computeDrawBounds(points: DrawPoint[], size: number): Rect {
	if (points.length === 0) return { x: 0, y: 0, width: 1, height: 1 };
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const point of points) {
		const r = sampleRadius(size, point.p);
		minX = Math.min(minX, point.x - r);
		minY = Math.min(minY, point.y - r);
		maxX = Math.max(maxX, point.x + r);
		maxY = Math.max(maxY, point.y + r);
	}
	return {
		x: minX,
		y: minY,
		width: Math.max(1, maxX - minX),
		height: Math.max(1, maxY - minY),
	};
}

/**
 * Ramer–Douglas–Peucker simplification. Reduces point count for low-zoom
 * rendering without touching the persisted raw samples. Returns indices into
 * the input so callers can keep pressure alongside the simplified path.
 */
export function simplifyDrawIndices(
	points: DrawPoint[],
	tolerance: number,
): number[] {
	const n = points.length;
	if (n <= 2 || tolerance <= 0) return points.map((_, i) => i);
	const keep = new Array<boolean>(n).fill(false);
	keep[0] = true;
	keep[n - 1] = true;
	const stack: Array<[number, number]> = [[0, n - 1]];
	while (stack.length > 0) {
		const segment = stack.pop();
		if (!segment) break;
		const [start, end] = segment;
		let maxDist = -1;
		let index = -1;
		const a = points[start];
		const b = points[end];
		if (!a || !b) continue;
		for (let i = start + 1; i < end; i += 1) {
			const point = points[i];
			if (!point) continue;
			const d = perpendicularDistance(point, a, b);
			if (d > maxDist) {
				maxDist = d;
				index = i;
			}
		}
		if (maxDist > tolerance && index !== -1) {
			keep[index] = true;
			stack.push([start, index], [index, end]);
		}
	}
	const out: number[] = [];
	for (let i = 0; i < n; i += 1) if (keep[i]) out.push(i);
	return out;
}

function perpendicularDistance(
	point: DrawPoint,
	a: DrawPoint,
	b: DrawPoint,
): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const lengthSq = dx * dx + dy * dy;
	if (lengthSq === 0) return Math.hypot(point.x - a.x, point.y - a.y);
	const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq;
	const projX = a.x + t * dx;
	const projY = a.y + t * dy;
	return Math.hypot(point.x - projX, point.y - projY);
}

/**
 * Build a closed, pressure-sensitive outline suitable for a filled Pixi polygon.
 * The raw samples remain authoritative; the outline is derived with rounded caps
 * and joins that stay stable through sharp turns and self-intersections.
 */
export function buildStrokeOutline(
	points: DrawPoint[],
	size: number,
): Array<{ x: number; y: number }> {
	const n = points.length;
	if (n === 0) return [];
	const first = points[0];
	if (!first) return [];
	if (n === 1) {
		const r = sampleRadius(size, first.p);
		const p = first;
		// Soft round dot (octagon) — less "diamond stamp" than a 4-point cross.
		const k = r * Math.SQRT1_2;
		return [
			{ x: p.x, y: p.y - r },
			{ x: p.x + k, y: p.y - k },
			{ x: p.x + r, y: p.y },
			{ x: p.x + k, y: p.y + k },
			{ x: p.x, y: p.y + r },
			{ x: p.x - k, y: p.y + k },
			{ x: p.x - r, y: p.y },
			{ x: p.x - k, y: p.y - k },
		];
	}
	return getStroke(
		points.map((point) => [point.x, point.y, point.p]),
		{
			size: Math.max(1, size),
			thinning: 0.5,
			smoothing: 0.5,
			streamline: 0,
			simulatePressure: false,
			last: true,
			start: { cap: true },
			end: { cap: true },
		},
	).map(([x, y]) => ({ x, y }));
}

/**
 * Distance from a world point to the stroke's polyline, in the shape's local
 * space. Used for hit testing: a hit registers within half the stroke width plus
 * a small tolerance. `local` is the point expressed in the draw item's frame.
 */
export function distanceToStroke(
	points: DrawPoint[],
	local: WorldPoint,
): number {
	if (points.length === 0) return Number.POSITIVE_INFINITY;
	const first = points[0];
	if (!first) return Number.POSITIVE_INFINITY;
	if (points.length === 1) return Math.hypot(local.x - first.x, local.y - first.y);
	let min = Number.POSITIVE_INFINITY;
	for (let i = 0; i < points.length - 1; i += 1) {
		const from = points[i];
		const to = points[i + 1];
		if (!from || !to) continue;
		const d = perpendicularDistance({ x: local.x, y: local.y, p: 0 }, from, to);
		if (d < min) min = d;
	}
	return min;
}
