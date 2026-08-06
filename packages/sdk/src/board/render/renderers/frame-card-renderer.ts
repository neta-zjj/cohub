import { BOARD_FONT_STACK } from "@cohub/protocol/board-constants";
import { Container, Graphics, type Text } from "pixi.js";
import { syncTextResolution } from "../text-resolution.js";
import type { BoardItem } from "@cohub/protocol/board-document";
import { pickBoardColor } from "../../core/palette.js";
import {
	createLabel,
	positionShell,
} from "./base-card-renderer.js";
import type {
	BoardCardRenderer,
	BoardRenderContext,
} from "./board-renderer-registry.js";
import { drawFarPlate } from "./far-plate.js";

type FrameParts = {
	root: Container;
	box: Graphics;
	label: Text;
	visualSig: string;
	textSig: string;
	resolution: number;
};

const partsByContainer = new WeakMap<Container, FrameParts>();

function sync(
	container: Container,
	item: BoardItem,
	context: BoardRenderContext,
) {
	const parts = partsByContainer.get(container);
	if (!parts || item.type !== "frame") return;

	const { frame, label, color, locked } = item;
	positionShell(parts.root, item);
	syncTextResolution(parts.label, parts, context.zoom);

	const selected = context.selectedIds.has(item.id);
	const hovered = context.hoveredId === item.id;
	const palette = pickBoardColor(context.colors, color, context.colorScheme);
	const stroke = selected ? context.palette.brand : palette.stroke;
	const alpha = selected ? 1 : hovered ? 0.85 : 0.55;
	const visualSig = [
		frame.width,
		frame.height,
		selected,
		hovered,
		palette.fill,
		stroke,
	].join("|");
	if (visualSig !== parts.visualSig) {
		parts.visualSig = visualSig;
		parts.box.clear();
		// Subtle fill so the container reads as a region.
		parts.box
			.roundRect(0, 0, frame.width, frame.height, 4)
			.fill({ color: palette.fill, alpha: 0.04 });
		parts.box.roundRect(0, 0, frame.width, frame.height, 4).stroke({
			color: stroke,
			width: selected ? 2 : 1.5,
			alpha,
			// Dashed look approximated by thinner stroke when unselected.
		});
	}

	const title = locked ? `🔒 ${label || "Frame"}` : label || "Frame";
	const textSig = [title, palette.stroke].join("|");
	if (textSig !== parts.textSig) {
		parts.textSig = textSig;
		parts.label.text = title;
		parts.label.style.fill = palette.stroke;
	}
	parts.label.position.set(4, -18);
}

export const frameCardRenderer: BoardCardRenderer = {
	id: "frame-card",
	canRender: (item) => item.type === "frame",
	create: (item, context) => {
		const root = new Container();
		const box = new Graphics();
		const label = createLabel("", {
			fill: context.palette.muted,
			fontFamily: BOARD_FONT_STACK,
			fontSize: 12,
			fontWeight: "600",
		});
		root.addChild(box, label);
		partsByContainer.set(root, {
			root,
			box,
			label,
			visualSig: "",
			textSig: "",
			resolution: label.resolution,
		});
		sync(root, item, context);
		return root;
	},
	update: (container, item, context) => {
		sync(container, item, context);
	},
	/**
	 * Far LOD: a frame is a background region, so it draws as a faint wash with no
	 * label.
	 *
	 * Batching it is what keeps it *behind* its contents. As a live container it
	 * would be drawn above the whole far layer no matter where the document places
	 * it, so a frame would hide every card inside it.
	 */
	renderFar: (graphics, item, context) => {
		if (item.type !== "frame") return;
		const palette = pickBoardColor(
			context.colors,
			item.color,
			context.colorScheme,
		);
		drawFarPlate(graphics, item.frame, {
			fill: palette.fill,
			fillAlpha: 0.07,
		});
	},
	destroy: (container) => {
		partsByContainer.delete(container);
		container.destroy({ children: true });
	},
};
