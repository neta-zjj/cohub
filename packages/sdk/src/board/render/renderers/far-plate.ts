/**
 * Shared far-LOD drawing helpers.
 *
 * At far zoom (or on very dense boards) cards are not materialised as
 * containers; every far-capable shape instead contributes flat geometry to one
 * shared `Graphics`, which the GPU batches into a couple of draw calls. So the
 * primitives here are deliberately cheap:
 *
 * - plain rectangles, not rounded ones — the corner radius is sub-pixel at this
 *   scale, and arcs would multiply the vertex count for nothing;
 * - no text, no textures, no masks;
 * - one fill plus at most one accent band per card.
 *
 * The result reads as a legible layout map of the board: you can see where
 * content sits and roughly what kind it is, then zoom in for detail.
 */

import type { Graphics } from "pixi.js";
import { degToRad } from "../../geometry.js";
import type { BoardFrame } from "@cohub/protocol/board-document";

/** Upper bound on points kept when a stroke is drawn at far LOD. */
const FAR_STROKE_MAX_POINTS = 24;

/** Accent band height as a fraction of the plate, clamped to sane world units. */
const ACCENT_RATIO = 0.14;
const ACCENT_MIN = 2;
const ACCENT_MAX = 10;

/**
 * Trace a frame's rectangle, honouring rotation. Unrotated frames take the
 * fast `rect` path; rotated ones emit four explicit corners (still one path,
 * no arcs) so the far layer never needs a per-card transform.
 */
function traceFrame(
	graphics: Graphics,
	frame: BoardFrame,
	inset = 0,
	heightOverride?: number,
) {
	const x = frame.x + inset;
	const y = frame.y + inset;
	const width = Math.max(0, frame.width - inset * 2);
	const height = Math.max(0, (heightOverride ?? frame.height) - inset * 2);
	if (!frame.rotation) {
		graphics.rect(x, y, width, height);
		return;
	}
	// Rotation is about the frame centre, matching the geometry model.
	const cx = frame.x + frame.width / 2;
	const cy = frame.y + frame.height / 2;
	const angle = degToRad(frame.rotation);
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	const corner = (px: number, py: number) => {
		const dx = px - cx;
		const dy = py - cy;
		return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
	};
	const a = corner(x, y);
	const b = corner(x + width, y);
	const c = corner(x + width, y + height);
	const d = corner(x, y + height);
	graphics
		.moveTo(a.x, a.y)
		.lineTo(b.x, b.y)
		.lineTo(c.x, c.y)
		.lineTo(d.x, d.y)
		.closePath();
}

export type FarPlateStyle = {
	/** Plate body fill. */
	fill: number;
	fillAlpha?: number;
	/** Optional accent band along the top edge, identifying the content kind. */
	accent?: number;
	accentAlpha?: number;
};

/**
 * Draw one card as a far-LOD plate: a filled body plus an optional top accent
 * band. Selection and hover are intentionally not drawn here — the interaction
 * overlay already renders selection in world space, above this layer.
 */
export function drawFarPlate(
	graphics: Graphics,
	frame: BoardFrame,
	style: FarPlateStyle,
) {
	if (frame.width <= 0 || frame.height <= 0) return;
	traceFrame(graphics, frame);
	graphics.fill({ color: style.fill, alpha: style.fillAlpha ?? 1 });
	if (style.accent === undefined) return;
	const band = Math.min(
		ACCENT_MAX,
		Math.max(ACCENT_MIN, frame.height * ACCENT_RATIO),
	);
	traceFrame(graphics, frame, 0, band);
	graphics.fill({ color: style.accent, alpha: style.accentAlpha ?? 0.9 });
}

/**
 * Draw one card as a far-LOD polyline.
 *
 * The counterpart to `drawFarPlate` for shapes whose meaning is a path rather than
 * a region — strokes and arrows. It stays in the shared `Graphics`, so these keep
 * their place in the batch and therefore in document order: an unbatched shape
 * would be a live container, drawn above every plate no matter where the document
 * puts it.
 *
 * Points are decimated to a bound, because a freehand stroke can hold thousands of
 * samples that are sub-pixel apart at this zoom.
 */
export function drawFarStroke(
	graphics: Graphics,
	points: ReadonlyArray<{ x: number; y: number }>,
	style: { color: number; width: number; alpha?: number },
) {
	if (points.length < 2) return;
	const step = Math.max(1, Math.ceil(points.length / FAR_STROKE_MAX_POINTS));
	const first = points[0];
	if (!first) return;
	graphics.moveTo(first.x, first.y);
	for (let i = step; i < points.length; i += step) {
		const point = points[i];
		if (point) graphics.lineTo(point.x, point.y);
	}
	// Always land on the true endpoint, so decimation cannot shorten the shape.
	const last = points[points.length - 1];
	if (last) graphics.lineTo(last.x, last.y);
	graphics.stroke({
		color: style.color,
		width: style.width,
		alpha: style.alpha ?? 0.9,
	});
}
