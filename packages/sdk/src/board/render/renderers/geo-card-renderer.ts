import { BOARD_FONT_STACK } from "@cohub/protocol/board-constants";
import { Container, Graphics, Text } from "pixi.js";
import {
	syncTextResolution,
	syncTextWrapWidth,
	textResolutionForZoom,
} from "../text-resolution.js";
import type { BoardGeoItem } from "@cohub/protocol/board-document";
import { pickBoardColor } from "../../core/palette.js";
import { positionShell } from "./base-card-renderer.js";
import type {
	BoardCardRenderer,
	BoardRenderContext,
} from "./board-renderer-registry.js";
import { drawFarPlate } from "./far-plate.js";

const RADIUS = 8;
const LABEL_PADDING = 8;

type GeoParts = {
	root: Container;
	shape: Graphics;
	label: Text;
	visualSig: string;
	textSig: string;
	wrapWidth: number;
	resolution: number;
};

const partsByContainer = new WeakMap<Container, GeoParts>();

function traceOutline(
	graphics: Graphics,
	geo: BoardGeoItem["geo"],
	width: number,
	height: number,
) {
	switch (geo) {
		case "ellipse":
			graphics.ellipse(width / 2, height / 2, width / 2, height / 2);
			return;
		case "diamond":
			graphics
				.moveTo(width / 2, 0)
				.lineTo(width, height / 2)
				.lineTo(width / 2, height)
				.lineTo(0, height / 2)
				.closePath();
			return;
		case "triangle":
			graphics
				.moveTo(width / 2, 0)
				.lineTo(width, height)
				.lineTo(0, height)
				.closePath();
			return;
		case "rounded":
			graphics.roundRect(0, 0, width, height, RADIUS);
			return;
		default:
			graphics.rect(0, 0, width, height);
	}
}

function sync(
	container: Container,
	item: BoardGeoItem,
	context: BoardRenderContext,
) {
	const parts = partsByContainer.get(container);
	if (!parts) return;
	positionShell(parts.root, item);
	const { width, height } = item.frame;
	const selected = context.selectedIds.has(item.id);
	const hovered = context.hoveredId === item.id;
	const color = pickBoardColor(context.colors, item.color, context.colorScheme);
	syncTextResolution(parts.label, parts, context.zoom);
	const resizing = context.resizingIds.has(item.id);

	const visualSig = [
		width,
		height,
		selected,
		hovered,
		item.geo,
		item.fillOpacity,
		color.fill,
		color.stroke,
		context.palette.muted,
	].join("|");
	if (visualSig !== parts.visualSig) {
		parts.visualSig = visualSig;
		parts.shape.clear();
		traceOutline(parts.shape, item.geo, width, height);
		if (item.fillOpacity > 0)
			parts.shape.fill({ color: color.fill, alpha: item.fillOpacity });
		traceOutline(parts.shape, item.geo, width, height);
		parts.shape.stroke({
			color: selected
				? color.stroke
				: hovered
					? context.palette.muted
					: color.stroke,
			width: selected ? 2.5 : 1.75,
			alpha: selected ? 1 : hovered ? 0.95 : 0.85,
		});
	}

	const textSig = [item.text, color.label].join("|");
	if (textSig !== parts.textSig) {
		parts.textSig = textSig;
		parts.label.text = item.text;
		parts.label.visible = item.text.length > 0;
		parts.label.style.fill = color.label;
	}
	syncTextWrapWidth(
		parts.label,
		parts,
		Math.max(1, width - LABEL_PADDING * 2),
		resizing,
	);
	parts.label.position.set(width / 2, height / 2);
}

export const geoCardRenderer: BoardCardRenderer = {
	id: "geo-card",
	canRender: (item) => item.type === "geo",
	create: (item, context) => {
		const root = new Container();
		const shape = new Graphics();
		const resolution = textResolutionForZoom(context.zoom);
		const label = new Text({
			text: "",
			style: {
				fill: 0xffffff,
				fontFamily: BOARD_FONT_STACK,
				fontSize: 14,
				fontWeight: "500",
				align: "center",
				wordWrap: true,
				lineHeight: 20,
			},
			resolution,
			roundPixels: true,
		});
		label.anchor.set(0.5);
		root.addChild(shape, label);
		partsByContainer.set(root, {
			root,
			shape,
			label,
			visualSig: "",
			textSig: "",
			wrapWidth: 0,
			resolution,
		});
		if (item.type === "geo") sync(root, item, context);
		return root;
	},
	update: (container, item, context) => {
		if (item.type === "geo") sync(container, item, context);
	},
	// Far LOD: the shape's colour and footprint survive, the outline shape and label
	// do not. Approximating an ellipse or a triangle with its bounding plate is a
	// small lie at this scale, and it keeps the item inside the batch — an unbatched
	// item would be a live container drawn above every plate regardless of its
	// document position.
	renderFar: (graphics, item, context) => {
		if (item.type !== "geo") return;
		const color = pickBoardColor(context.colors, item.color, context.colorScheme);
		drawFarPlate(graphics, item.frame, {
			fill: color.fill,
			fillAlpha: Math.max(0.18, item.fillOpacity),
			accent: color.stroke,
			accentAlpha: 0.9,
		});
	},
	destroy: (container) => {
		partsByContainer.get(container)?.root.destroy({ children: true });
		partsByContainer.delete(container);
	},
};
