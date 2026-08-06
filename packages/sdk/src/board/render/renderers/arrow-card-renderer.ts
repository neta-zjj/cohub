import { BOARD_FONT_STACK } from "@cohub/protocol/board-constants";
import { Container, Graphics, Text } from "pixi.js";
import {
	syncTextResolution,
	textResolutionForZoom,
} from "../text-resolution.js";
import type { BoardArrowItem } from "@cohub/protocol/board-document";
import { resolveArrow, sampleQuadratic } from "../../core/bindings.js";
import { pickBoardColor } from "../../core/palette.js";
import type {
	BoardCardRenderer,
	BoardRenderContext,
} from "./board-renderer-registry.js";
import { drawFarStroke } from "./far-plate.js";

type ArrowParts = {
	root: Container;
	line: Graphics;
	label: Text;
	lineSig: string;
	labelSig: string;
	resolution: number;
};

const partsByContainer = new WeakMap<Container, ArrowParts>();

/**
 * Frame lookup for resolving bindings.
 *
 * Routed through the context's id index rather than scanning the document: an
 * arrow re-resolves its endpoints on every sync, and a per-arrow O(items) scan
 * would make a board with many arrows quadratic per frame.
 */
function frameLookup(context: BoardRenderContext) {
	return (id: string) => context.getItem(id)?.frame;
}

/** Open chevron arrowhead — clearly directional, not a tiny filled nub. */
function drawArrowhead(
	graphics: Graphics,
	tip: { x: number; y: number },
	angle: number,
	size: number,
	color: number,
	strokeWidth: number,
) {
	const spread = Math.PI / 6;
	const left = {
		x: tip.x - size * Math.cos(angle - spread),
		y: tip.y - size * Math.sin(angle - spread),
	};
	const right = {
		x: tip.x - size * Math.cos(angle + spread),
		y: tip.y - size * Math.sin(angle + spread),
	};
	graphics
		.moveTo(left.x, left.y)
		.lineTo(tip.x, tip.y)
		.lineTo(right.x, right.y)
		.stroke({
			color,
			width: Math.max(1.5, strokeWidth),
			alpha: 1,
			cap: "round",
			join: "round",
		});
}

function sync(
	container: Container,
	item: BoardArrowItem,
	context: BoardRenderContext,
) {
	const parts = partsByContainer.get(container);
	if (!parts) return;
	// Arrows are positioned in world space (their geometry is absolute), so the
	// root sits at the origin with no frame transform.
	parts.root.position.set(0, 0);
	parts.root.rotation = 0;
	const selected = context.selectedIds.has(item.id);
	const hovered = context.hoveredId === item.id;
	const color = pickBoardColor(context.colors, item.color, context.colorScheme);
	syncTextResolution(parts.label, parts, context.zoom);

	const getFrame = frameLookup(context);
	const resolved = resolveArrow(item, getFrame);

	// Signature includes the resolved endpoints so the line tracks bound targets.
	const lineSig = resolved
		? [
				resolved.start.x,
				resolved.start.y,
				resolved.end.x,
				resolved.end.y,
				resolved.control.x,
				resolved.control.y,
				selected,
				hovered,
				color.stroke,
				item.size,
				item.arrowStart,
				item.arrowEnd,
			].join("|")
		: `empty|${item.id}`;
	if (lineSig !== parts.lineSig) {
		parts.lineSig = lineSig;
		parts.line.clear();
		if (resolved) {
			const strokeColor = color.stroke;
			const width = selected ? item.size + 1 : item.size;
			const samples = sampleQuadratic(resolved, 24);
			const head = samples[0];
			const tail = samples[samples.length - 1];
			if (head && tail) {
				parts.line.moveTo(head.x, head.y);
				for (let i = 1; i < samples.length; i += 1) {
					const point = samples[i];
					if (point) parts.line.lineTo(point.x, point.y);
				}
				parts.line.stroke({
					color: strokeColor,
					width,
					alpha: selected || hovered ? 1 : 0.92,
					cap: "round",
					join: "round",
				});

				// Head scales with stroke and arrow length so short arrows stay legible.
				const span = Math.hypot(tail.x - head.x, tail.y - head.y);
				const headSize = Math.min(
					Math.max(14, item.size * 5.5),
					Math.max(10, span * 0.28),
				);
				if (item.arrowEnd) {
					const prev = samples[samples.length - 2];
					if (prev)
						drawArrowhead(
							parts.line,
							tail,
							Math.atan2(tail.y - prev.y, tail.x - prev.x),
							headSize,
							strokeColor,
							width,
						);
				}
				if (item.arrowStart) {
					const next = samples[1];
					if (next)
						drawArrowhead(
							parts.line,
							head,
							Math.atan2(head.y - next.y, head.x - next.x),
							headSize,
							strokeColor,
							width,
						);
				}
			}
		}
	}

	const labelSig = [item.label, color.label].join("|");
	if (labelSig !== parts.labelSig) {
		parts.labelSig = labelSig;
		parts.label.text = item.label;
		parts.label.style.fill = color.label;
	}
	parts.label.visible = Boolean(resolved && item.label.length > 0);
	if (resolved) parts.label.position.copyFrom(resolved.control);
}

export const arrowCardRenderer: BoardCardRenderer = {
	id: "arrow-card",
	canRender: (item) => item.type === "arrow",
	create: (item, context) => {
		const root = new Container();
		const line = new Graphics();
		const resolution = textResolutionForZoom(context.zoom);
		const label = new Text({
			text: "",
			style: {
				fill: 0xffffff,
				fontFamily: BOARD_FONT_STACK,
				fontSize: 12,
				fontWeight: "500",
			},
			resolution,
			roundPixels: true,
		});
		label.anchor.set(0.5);
		root.addChild(line, label);
		partsByContainer.set(root, {
			root,
			line,
			label,
			lineSig: "",
			labelSig: "",
			resolution,
		});
		if (item.type === "arrow") sync(root, item, context);
		return root;
	},
	update: (container, item, context) => {
		if (item.type === "arrow") sync(container, item, context);
	},
	// Far LOD: the line, without arrowheads or label — a head is a few world units
	// across and would be invisible anyway. Batching it keeps the arrow in document
	// order; as a live container it would be drawn above every plate.
	renderFar: (graphics, item, context) => {
		if (item.type !== "arrow") return;
		const resolved = resolveArrow(item, frameLookup(context));
		if (!resolved) return;
		const color = pickBoardColor(context.colors, item.color, context.colorScheme);
		drawFarStroke(graphics, sampleQuadratic(resolved, 12), {
			color: color.stroke,
			width: item.size,
			alpha: 0.85,
		});
	},
	destroy: (container) => {
		partsByContainer.get(container)?.root.destroy({ children: true });
		partsByContainer.delete(container);
	},
};
