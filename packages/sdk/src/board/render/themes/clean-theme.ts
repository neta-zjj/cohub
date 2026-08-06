import { Container, Graphics, RenderTexture, TilingSprite } from "pixi.js";
import type {
	BoardThemeContext,
	BoardThemeRenderer,
} from "./board-theme-registry.js";

type GridParts = {
	fill: Graphics;
	sprite: TilingSprite | null;
	textureKey: string;
	lastWidth: number;
	lastHeight: number;
	lastBg: number;
	lastBgAlpha: number;
};

const partsByContainer = new WeakMap<Container, GridParts>();

/** Positive modulo so tile offsets stay valid for negative viewport offsets. */
function wrap(value: number, period: number) {
	return ((value % period) + period) % period;
}

function buildGridTexture(
	context: BoardThemeContext,
	size: number,
	color: number,
	opacity: number,
	kind: "dots" | "grid" = "dots",
): RenderTexture {
	const graphics = new Graphics();
	if (kind === "grid") {
		graphics
			.moveTo(0, 0.5)
			.lineTo(size, 0.5)
			.moveTo(0.5, 0)
			.lineTo(0.5, size)
			.stroke({ color, width: 1, alpha: opacity });
	} else {
		// Soft paper dots — lighter than a full grid, still spatial.
		graphics.circle(0.5, 0.5, 0.9).fill({ color, alpha: opacity });
	}
	const target = RenderTexture.create({ width: size, height: size });
	context.app.renderer.render({ container: graphics, target });
	graphics.destroy();
	return target;
}

function sync(parts: GridParts, context: BoardThemeContext) {
	const { app, document, viewport, palette } = context;
	const width = app.screen.width;
	const height = app.screen.height;
	const bgAlpha = context.hasImageBackground ? 0 : 1;

	if (
		parts.lastWidth !== width ||
		parts.lastHeight !== height ||
		parts.lastBg !== palette.bg ||
		parts.lastBgAlpha !== bgAlpha
	) {
		parts.fill.clear();
		parts.fill
			.rect(0, 0, width, height)
			.fill({ color: palette.bg, alpha: bgAlpha });
		parts.lastWidth = width;
		parts.lastHeight = height;
		parts.lastBg = palette.bg;
		parts.lastBgAlpha = bgAlpha;
	}

	const appearance = document.appearance;
	// Clean default: solid paper. Pattern only when grid is explicitly visible.
	const visible = appearance.grid?.visible === true;
	const size = Math.max(4, appearance.grid?.size ?? 24);
	const opacity = appearance.grid?.opacity ?? 0.12;
	const kind =
		appearance.background?.kind === "grid"
			? ("grid" as const)
			: ("dots" as const);
	const key = `${kind}|${size}|${palette.border}|${opacity}`;

	if (!visible) {
		if (parts.sprite) parts.sprite.visible = false;
		return;
	}

	if (parts.textureKey !== key || !parts.sprite) {
		if (parts.sprite) {
			// Capture the texture before destroying the sprite: Pixi nulls the
			// sprite's texture reference on destroy, so reading it afterwards throws.
			const previousTexture = parts.sprite.texture;
			parts.sprite.destroy();
			previousTexture.destroy(true);
		}
		const texture = buildGridTexture(
			context,
			size,
			palette.border,
			opacity,
			kind,
		);
		parts.sprite = new TilingSprite({ texture, width, height });
		parts.textureKey = key;
		parts.fill.parent?.addChild(parts.sprite);
	}

	const sprite = parts.sprite;
	if (!sprite) return;
	sprite.visible = true;
	sprite.width = width;
	sprite.height = height;
	const step = size * viewport.zoom;
	sprite.tileScale.set(viewport.zoom);
	sprite.tilePosition.set(wrap(viewport.x, step), wrap(viewport.y, step));
}

export const cleanBoardTheme: BoardThemeRenderer = {
	id: "clean",
	canRender: () => true,
	createBackground: (context) => {
		const container = new Container();
		const fill = new Graphics();
		container.addChild(fill);
		const parts: GridParts = {
			fill,
			sprite: null,
			textureKey: "",
			lastWidth: -1,
			lastHeight: -1,
			lastBg: Number.NaN,
			lastBgAlpha: Number.NaN,
		};
		partsByContainer.set(container, parts);
		sync(parts, context);
		return container;
	},
	updateBackground: (container, context) => {
		const parts = partsByContainer.get(container);
		if (parts) sync(parts, context);
	},
};
