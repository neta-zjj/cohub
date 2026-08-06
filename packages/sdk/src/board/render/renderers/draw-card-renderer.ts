import { Container, Graphics } from "pixi.js";
import type { BoardDrawItem } from "@cohub/protocol/board-document";
import {
	buildStrokeOutline,
	computeDrawBounds,
} from "../../core/draw-geometry.js";
import { pickBoardColor } from "../../core/palette.js";
import { positionShell } from "./base-card-renderer.js";
import type {
	BoardCardRenderer,
	BoardRenderContext,
} from "./board-renderer-registry.js";
import { drawFarStroke } from "./far-plate.js";

type DrawParts = {
	root: Container;
	stroke: Graphics;
	sig: string;
	/** Last points array rendered; a new array (edit/undo) forces a redraw. */
	points: unknown;
	/** Local-space width the current tessellation was built at. */
	baseWidth: number;
};

const partsByContainer = new WeakMap<Container, DrawParts>();

function sync(
	container: Container,
	item: BoardDrawItem,
	context: BoardRenderContext,
) {
	const parts = partsByContainer.get(container);
	if (!parts) return;
	positionShell(parts.root, item);
	const selected = context.selectedIds.has(item.id);
	const hovered = context.hoveredId === item.id;
	const color = pickBoardColor(context.colors, item.color, context.colorScheme);

	// Rebuild the ribbon only when the stroke or its styling changes. Position is
	// handled by positionShell, so a pure drag does not re-tessellate the path.
	// The points array identity is part of the key so an edit/undo that replaces
	// the samples (even at unchanged length) re-renders.
	const sig = [
		item.points.length,
		item.size,
		item.color,
		selected,
		hovered,
		context.colorScheme,
		color.stroke,
	].join("|");
	if (sig !== parts.sig || item.points !== parts.points) {
		parts.sig = sig;
		parts.points = item.points;
		parts.baseWidth = computeDrawBounds(item.points, item.size).width;

		parts.stroke.clear();
		const outline = buildStrokeOutline(item.points, item.size);
		const origin = outline[0];
		if (origin && outline.length >= 3) {
			parts.stroke.moveTo(origin.x, origin.y);
			for (let i = 1; i < outline.length; i += 1) {
				const point = outline[i];
				if (point) parts.stroke.lineTo(point.x, point.y);
			}
			parts.stroke.closePath();
			parts.stroke.fill({
				color: color.stroke,
				alpha: selected || hovered ? 1 : 0.92,
			});
		}
	}

	// A live resize only grows the frame; scale the existing tessellation on the
	// GPU instead of rebuilding the ribbon each pointer move. The points are baked
	// at the final scale on pointer-up, which resets this back to 1.
	const previewScale = item.frame.width / Math.max(0.0001, parts.baseWidth);
	parts.stroke.scale.set(Number.isFinite(previewScale) ? previewScale : 1);
}

export const drawCardRenderer: BoardCardRenderer = {
	id: "draw-card",
	canRender: (item) => item.type === "draw",
	create: (item, context) => {
		const root = new Container();
		const stroke = new Graphics();
		root.addChild(stroke);
		partsByContainer.set(root, {
			root,
			stroke,
			sig: "",
			points: null,
			baseWidth: 0,
		});
		if (item.type === "draw") sync(root, item, context);
		return root;
	},
	update: (container, item, context) => {
		if (item.type === "draw") sync(container, item, context);
	},
	// Far LOD: the stroke's path is its content, so it is drawn as a decimated
	// polyline rather than a plate. Batching it also keeps it in document order —
	// as a live container it would sit above every plate on the board.
	renderFar: (graphics, item, context) => {
		if (item.type !== "draw") return;
		const color = pickBoardColor(context.colors, item.color, context.colorScheme);
		drawFarStroke(graphics, item.points, {
			color: color.stroke,
			width: item.size,
			alpha: 0.92,
		});
	},
	destroy: (container) => {
		partsByContainer.get(container)?.root.destroy({ children: true });
		partsByContainer.delete(container);
	},
};
