<script lang="ts">
import type { BoardFileSnapshot, BoardItem } from "@neta-art/cohub/board";
import {
	type BoardShapeColors,
	buildStrokeOutline,
	expandRect,
	pickBoardColor,
	pointToWorld,
	resolveArrow,
	resolveEndpoint,
	type ScreenPoint,
	screenPoint,
	screenToWorld,
	shapeCapabilities,
	VIEWPORT_MARGIN_RATIO,
	visibleWorldRect,
	worldPoint,
} from "@neta-art/cohub/board";
import {
	type BoardRenderContext,
	type BoardRenderPalette,
	getBoardCardRenderer,
	getBoardResolution,
	getBoardThemeRenderer,
	textZoomBucket,
} from "@neta-art/cohub/board/render";
import { Application, Container, Graphics, type Renderer } from "pixi.js";
import { onDestroy, onMount, untrack } from "svelte";
import { createBoardAssetManager } from "$lib/board/board-asset-manager";
import type { BoardAssetSource } from "$lib/board/board-asset-source";
import {
	type BoardAwarenessController,
	collaborationColor,
} from "$lib/board/board-awareness";
import {
	fileAvailability,
	filePreviewVersion,
	isFilePreviewStale,
	loadFilePreview,
	subscribeFilePreviews,
} from "$lib/board/board-file-preview-source";
import type { BoardStageExportBridge } from "$lib/board/board-image-export";
import { createBoardScene } from "$lib/board/board-scene";
import {
	type BoardThemeBackground,
	type BoardThemeSnapshot,
	boardThemeKey,
	resolveBoardBackground,
	resolveBoardTheme,
} from "$lib/board/board-theme";
import { resizeCursorForHandle } from "$lib/board/core/selection-transform";
import type { BoardEditor } from "$lib/board/editor.svelte";
import type { BoardRuntimeData } from "$lib/board/runtime/board-runtime";
import { createBoardAnimationRuntime } from "$lib/board/runtime/pixi-animation";
import { pointerDropZone } from "$lib/drag/pointer-drag.svelte";
import {
	type BoardDropItem,
	toBoardDropItems,
} from "$lib/drag/pointer-drag-core";
import { SPACE_STYLE_CHANGED_EVENT } from "$lib/space-style";
import { getResolvedTheme } from "$lib/theme.svelte";

const {
	editor,
	runtime,
	spaceId,
	assetSource,
	readonly = false,
	active = true,
	awareness,
	awarenessVersion,
	onPointerPresence,
	onSurfaceChange,
	onOpenFile,
	onExportReady,
}: {
	editor: BoardEditor;
	runtime: BoardRuntimeData;
	/**
	 * Cache scope for previews. Still required in view mode: it namespaces asset
	 * keys so identical paths from different Spaces never collide.
	 */
	spaceId: string;
	/** Where referenced media is resolved from (live Space or published artifact). */
	assetSource: BoardAssetSource;
	/**
	 * View-only stage: no drops, no shape editing, and no workspace reads. A
	 * published Board is rendered from its snapshot alone.
	 */
	readonly?: boolean;
	active?: boolean;
	awareness: BoardAwarenessController;
	awarenessVersion: number;
	onPointerPresence?: (
		cursor: {
			x: number;
			y: number;
			pointerType: "mouse" | "pen" | "touch";
		} | null,
	) => void;
	onSurfaceChange?: (size: { width: number; height: number }) => void;
	/** Open a workspace file in the preview panel (same target as the file tree). */
	onOpenFile?: (path: string) => void | Promise<void>;
	/**
	 * Hands the parent a way to export using this stage's live renderer and
	 * already-resolved theme. Passing a getter (rather than the renderer itself)
	 * keeps the caller from holding a reference past the stage's lifetime.
	 */
	onExportReady?: (bridge: BoardStageExportBridge | null) => void;
} = $props();

let host: HTMLDivElement | null = $state(null);
let app: Application | null = null;
let world: Container | null = null;
let effectsBehind: Container | null = null;
let nodeLayer: Container | null = null;
let effectsFront: Container | null = null;
let screenEffects: Container | null = null;
let background: Container | null = null;
let backgroundThemeId: string | null = null;
let boardBackdrop: BoardThemeBackground | null = $state(null);
let farLayer: Graphics | null = null;
let overlay: Graphics | null = null;
let scene: ReturnType<typeof createBoardScene> | null = null;
let animationRuntime: ReturnType<typeof createBoardAnimationRuntime> | null =
	null;
let resizeObserver: ResizeObserver | null = null;
let resizeFrame = 0;
// Render-on-demand: Pixi's ticker is disabled (autoStart: false) so an idle
// board draws nothing. Each scene sync schedules exactly one render for the
// next animation frame, coalescing bursts of updates into a single draw.
let renderFrame = 0;
// Culling cache: the visible-id set is recomputed only when the camera or the
// item structure (ids/order) actually changes. During a drag the camera is
// static and only the (pinned, always-rendered) selection moves, so this cache
// removes the per-frame spatial-index query + rebuild that a drag otherwise
// triggered — the single biggest interaction cost on large boards.
let cullCache: {
	cameraKey: string;
	structureKey: number;
	geometryKey: number;
	visibleIds: Set<string>;
} | null = null;
let dropActive = $state(false);
let surface = $state<{ width: number; height: number }>({
	width: 0,
	height: 0,
});
// Bumped whenever the asset manager resolves a new thumbnail URL, so cards
// re-sync and images pop in.
let assetVersion = $state(0);
let spaceStyleVersion = $state(0);

function handleSpaceStyleChanged(event: Event) {
	const detail = (event as CustomEvent<{ spaceId?: string | null }>).detail;
	if (detail?.spaceId !== null && detail?.spaceId !== spaceId) return;
	spaceStyleVersion += 1;
	themeCache = null;
}

// One manager per mounted board; the space id and source are fixed for the mount.
const assets = createBoardAssetManager({
	spaceId: untrack(() => spaceId),
	resolveSpaceFileUrl: (_spaceId, path) =>
		untrack(() => assetSource).resolveFileUrl(path),
});
const unsubscribeAssets = assets.subscribe(() => {
	assetVersion += 1;
});

// Bumped when a workspace file change invalidates a cached preview, so visible
// file cards can refresh their snapshot.
let previewVersion = $state(filePreviewVersion());
const unsubscribePreviews = subscribeFilePreviews((event) => {
	previewVersion = filePreviewVersion();
	if (readonly || !event || event.spaceId !== spaceId) return;
	assets.invalidatePath(event.path);
	editor.applyMediaFileChange(event.path, event.meta);
});

/**
 * Resolved theme colors, cached per theme identity. The snapshot is shared by
 * live rendering and export so the two paths cannot drift.
 */
let themeCache: BoardThemeSnapshot | null = null;

function resolveTheme(): BoardThemeSnapshot {
	const key = boardThemeKey(host, spaceStyleVersion);
	if (themeCache?.key === key) return themeCache;
	const current = resolveBoardTheme(host, spaceStyleVersion, key);
	themeCache = current;
	return current;
}

function getPalette(): BoardRenderPalette {
	return resolveTheme().palette;
}

// Request image and video previews only for cards near the viewport. The margin
// preloads a band just off-screen so panning feels
// instant, and matches the culling margin so a texture is requested before its
// card scrolls into view. Tracks only items/camera/surface: loaded textures
// notify via `assetVersion`, which the render effect (not this one) consumes.
//
// The candidate set comes from the spatial index, not from scanning every item,
// so this stays proportional to what is near the viewport rather than to the
// document size.
$effect(() => {
	editor.structureVersion;
	editor.geometryVersion;
	previewVersion;
	const camera = editor.camera;
	const width = surface.width;
	const height = surface.height;
	if (width === 0 || height === 0) return;
	for (const item of itemsNearViewport(camera, width, height)) {
		if (assets.assetKey(item)) assets.requestItem(item);
	}
});

// Adopt intrinsic image sizes once their textures resolve, so a frame created
// without dimension metadata (file-tree drop) stops letterboxing. Guarded by the
// snapshot in the editor, so each node is corrected once and never re-corrected.
// Only nodes near the viewport can have a resolved texture, so the same spatial
// candidate set bounds this work too.
$effect(() => {
	editor.structureVersion;
	editor.geometryVersion;
	const camera = editor.camera;
	const width = surface.width;
	const height = surface.height;
	// Re-run when a texture lands.
	assetVersion;
	if (width === 0 || height === 0) return;
	const pending: Array<{ id: string; width: number; height: number }> = [];
	for (const item of itemsNearViewport(camera, width, height)) {
		if (item.type !== "image" && item.type !== "video") continue;
		if (item.snapshot?.naturalWidth && item.snapshot?.naturalHeight) continue;
		const key = assets.assetKey(item);
		if (!key) continue;
		const natural = assets.getNaturalSize(key);
		if (!natural?.width || !natural.height) continue;
		pending.push({ id: item.id, ...natural });
	}
	if (pending.length > 0) editor.adoptMediaNaturalSizes(pending);
});

/** Items intersecting the viewport plus the preload margin, via the index. */
function itemsNearViewport(
	camera: { x: number; y: number; zoom: number },
	width: number,
	height: number,
): BoardItem[] {
	const visible = visibleWorldRect(camera, width, height);
	const preload = expandRect(
		visible,
		Math.max(visible.width, visible.height) * VIEWPORT_MARGIN_RATIO,
	);
	const result: BoardItem[] = [];
	for (const id of editor.idsInRect(preload)) {
		const item = editor.itemById(id);
		if (item) result.push(item);
	}
	return result;
}

// Fill in (and refresh) file-card previews for cards near the viewport.
//
// Two cases are handled here: a card whose snapshot was never enriched (created
// by another client, or by the CLI, which only writes the file ref), and a card
// whose file changed while the board was open. Both are bounded to what is near
// the viewport, so a board with thousands of file cards reads only the handful
// the user can actually see.
//
// Skipped entirely in view mode: a published Board has no live workspace behind
// it, so cards render from the snapshot captured at publish time.
$effect(() => {
	if (readonly) return;
	editor.structureVersion;
	editor.geometryVersion;
	const camera = editor.camera;
	const width = surface.width;
	const height = surface.height;
	// Re-run when a file change invalidates a cached preview.
	previewVersion;
	if (width === 0 || height === 0) return;

	const targets: Array<{ id: string; path: string }> = [];
	for (const item of itemsNearViewport(camera, width, height)) {
		if (item.type !== "file") continue;
		const path = item.ref.path;
		const stale = isFilePreviewStale(spaceId, path);
		// An unenriched card has no mtime recorded yet.
		const unenriched = item.snapshot?.mtimeMs === undefined;
		if (!stale && !unenriched) continue;
		// The stale mark is consumed by the read itself, which carries the change
		// event's metadata with it.
		targets.push({ id: item.id, path });
	}
	if (targets.length > 0) void enrichFileCards(targets);
});

function buildContext(
	palette: BoardRenderPalette,
	getDisplayItem: (id: string) => BoardItem | null,
): BoardRenderContext {
	const colorScheme = resolveTheme().colorScheme;
	const resizingIds =
		editor.interaction.type === "resizing"
			? new Set(editor.interaction.origin.keys())
			: new Set<string>();
	return {
		document: editor.document,
		getItem: getDisplayItem,
		selectedIds: new Set(editor.selection),
		hoveredId: editor.hoverId,
		resizingIds,
		palette,
		colors: resolveTheme().colors,
		colorScheme,
		zoom: editor.camera.zoom,
		assetKey: assets.assetKey,
		getTexture: (key) => assets.getTexture(key),
		hasError: (key) => assets.hasError(key),
		fileState: (path) => fileAvailability(spaceId, path),
		acquireTexture: (key) => assets.acquire(key),
		releaseTexture: (key) => assets.release(key),
	};
}

function computeVisibleIds(): Set<string> | null {
	const width = surface.width;
	const height = surface.height;
	if (width === 0 || height === 0) return null;
	const camera = editor.camera;
	const cameraKey = `${camera.x}|${camera.y}|${camera.zoom}|${width}x${height}`;
	// structureVersion: membership/order. geometryVersion: moves/resizes (nudge,
	// align, drag commit). Both are O(1) keys — no per-frame O(n) id join.
	const structureKey = editor.structureVersion;
	const geometryKey = editor.geometryVersion;
	if (
		cullCache &&
		cullCache.cameraKey === cameraKey &&
		cullCache.structureKey === structureKey &&
		cullCache.geometryKey === geometryKey
	)
		return cullCache.visibleIds;
	const visible = visibleWorldRect(camera, width, height);
	const culled = expandRect(
		visible,
		Math.max(visible.width, visible.height) * VIEWPORT_MARGIN_RATIO,
	);
	const visibleIds = new Set(editor.idsInRect(culled));
	cullCache = { cameraKey, structureKey, geometryKey, visibleIds };
	return visibleIds;
}

function sameBackdrop(
	left: BoardThemeBackground | null,
	right: BoardThemeBackground | null,
): boolean {
	return (
		left?.url === right?.url &&
		left?.tileWidth === right?.tileWidth &&
		left?.tileHeight === right?.tileHeight
	);
}

function backdropSize(value: BoardThemeBackground): string {
	if (!value.tileWidth || !value.tileHeight) return "auto";
	return `${value.tileWidth * editor.camera.zoom}px ${value.tileHeight * editor.camera.zoom}px`;
}

function syncBackground(theme: BoardThemeSnapshot) {
	if (!app) return;
	const nextBackdrop = resolveBoardBackground(
		editor.document.appearance,
		theme.background,
	);
	if (!sameBackdrop(boardBackdrop, nextBackdrop)) boardBackdrop = nextBackdrop;
	const themeRenderer = getBoardThemeRenderer(editor.document);
	const context = {
		app,
		document: editor.document,
		viewport: editor.camera,
		palette: theme.palette,
		hasImageBackground: Boolean(nextBackdrop),
	};
	if (!background || backgroundThemeId !== themeRenderer.id) {
		background?.destroy({ children: true });
		background = themeRenderer.createBackground(context);
		backgroundThemeId = themeRenderer.id;
		app.stage.addChildAt(background, 0);
		return;
	}
	themeRenderer.updateBackground?.(background, context);
}

function scheduleRender() {
	if (renderFrame || !app || !active) return;
	renderFrame = requestAnimationFrame(() => {
		renderFrame = 0;
		app?.render();
	});
}

function localGestureItemIds(): Set<string> {
	const interaction = editor.interaction;
	switch (interaction.type) {
		case "translating":
		case "resizing":
		case "rotating":
			return new Set(interaction.origin.keys());
		case "draggingArrowHandle":
			return new Set([interaction.arrowId]);
		default:
			return new Set();
	}
}

function remotePreviewItems(): Map<string, BoardItem> {
	const previews = new Map<string, BoardItem>();
	const localIds = localGestureItemIds();
	const peers = [...awareness.peers].sort(
		(a, b) => a.lastSeenAt - b.lastSeenAt,
	);
	for (const peer of peers) {
		if (peer.gesture?.kind !== "transform") continue;
		for (const preview of peer.gesture.nodes) {
			if (localIds.has(preview.nodeId)) continue;
			const item = editor.itemById(preview.nodeId);
			if (!item) continue;
			previews.set(preview.nodeId, {
				...item,
				frame: preview.frame,
				...(item.type === "arrow" && preview.arrow
					? {
							start: preview.arrow.start,
							end: preview.arrow.end,
							bend: preview.arrow.bend,
						}
					: {}),
			} as BoardItem);
		}
	}
	return previews;
}

function syncStage() {
	if (!app || !world || !scene) return;
	const theme = resolveTheme();
	const palette = theme.palette;
	syncBackground(theme);
	world.x = editor.camera.x;
	world.y = editor.camera.y;
	world.scale.set(editor.camera.zoom);
	if (world.parent !== app.stage) app.stage.addChild(world);
	if (screenEffects && screenEffects.parent !== app.stage)
		app.stage.addChild(screenEffects);

	const previewItems = remotePreviewItems();
	const getDisplayItem = (id: string) =>
		previewItems.get(id) ?? editor.itemById(id);
	const context = buildContext(palette, getDisplayItem);
	const visibleIds = computeVisibleIds();
	const pinnedIds = new Set(editor.selection);
	for (const id of previewItems.keys()) pinnedIds.add(id);
	if (editor.editingId) pinnedIds.add(editor.editingId);

	// Global render signals that affect every card equally (asset readiness,
	// theme, text zoom-bucket, file availability). Selection and hover are tracked
	// per card by the scene. Use the quantised zoom bucket — not raw zoom — so tiny
	// zooms do not thrash text re-rasterisation.
	const globalSig = [
		assetVersion,
		previewVersion,
		resolveTheme().key,
		textZoomBucket(editor.camera.zoom),
	].join("|");

	animationRuntime?.prepareSceneSync();
	scene.sync({
		items: editor.items,
		context,
		getItem: getDisplayItem,
		visibleIds,
		pinnedIds,
		globalSig,
		structureVersion: editor.structureVersion,
		geometryVersion: editor.geometryVersion,
		gestureActive: editor.gestureActive,
	});
	animationRuntime?.invalidatePoses();

	const single = editor.selection.length === 1 ? editor.selectedItems[0] : null;
	let arrowEndpoints: Array<{ x: number; y: number }> | undefined;
	if (single?.type === "arrow" && !single.locked) {
		const lookup = (id: string) => editor.itemById(id)?.frame;
		const resolved = resolveArrow(single, lookup);
		if (resolved)
			arrowEndpoints = [resolved.start, resolved.control, resolved.end];
	}
	scene.drawOverlay(
		{
			zoom: editor.camera.zoom,
			pointerType: editor.pointerType,
			marquee: editor.marquee,
			selection: editor.selection,
			transform: editor.selectionTransform,
			controls: editor.tool === "select",
			hoveredControl: editor.hoveredTransformControl,
			rotationPointer:
				editor.interaction.type === "rotating"
					? editor.interaction.current
					: null,
			arrowEndpoints,
		},
		palette,
	);

	drawRemoteAwareness(context.colors, context.colorScheme);
	drawTransient(palette, context.colors, context.colorScheme);

	scheduleRender();
}

function drawRemoteAwareness(colors: BoardShapeColors, mode: "dark" | "light") {
	if (!overlay) return;
	const inv = 1 / Math.max(editor.camera.zoom, 0.0001);
	for (const peer of awareness.peers) {
		const collaboration = collaborationColor(peer.actorId);
		const selection = peer.state?.selection;
		if (selection?.bounds && selection.count > 0) {
			const bounds = selection.bounds;
			const editing = peer.state?.editingId != null;
			overlay.rect(bounds.x, bounds.y, bounds.width, bounds.height).stroke({
				color: collaboration,
				width: (editing ? 2 : 1.25) * inv,
				alpha: editing ? 0.94 : 0.82,
			});
			if (editing) {
				overlay
					.circle(bounds.x, bounds.y, 3.5 * inv)
					.fill({ color: collaboration, alpha: 0.96 });
			}
		}

		const gesture = peer.gesture;
		if (!gesture) continue;
		if (gesture.kind === "draw") {
			const color = pickBoardColor(colors, gesture.color, mode);
			const outline = buildStrokeOutline(gesture.points, gesture.size);
			const first = outline[0];
			if (!first || outline.length < 3) continue;
			overlay.moveTo(first.x, first.y);
			for (let index = 1; index < outline.length; index += 1) {
				const point = outline[index];
				if (point) overlay.lineTo(point.x, point.y);
			}
			overlay.closePath().fill({ color: color.stroke, alpha: 0.9 });
			continue;
		}
		if (gesture.kind === "arrow") {
			const color = pickBoardColor(colors, gesture.color, mode);
			const angle = Math.atan2(
				gesture.current.y - gesture.start.y,
				gesture.current.x - gesture.start.x,
			);
			const head = Math.max(14, 16 * inv);
			const spread = Math.PI / 6;
			overlay
				.moveTo(gesture.start.x, gesture.start.y)
				.lineTo(gesture.current.x, gesture.current.y)
				.stroke({
					color: color.stroke,
					width: Math.max(gesture.size, 1.5 * inv),
					alpha: 0.88,
				});
			overlay
				.moveTo(
					gesture.current.x - head * Math.cos(angle - spread),
					gesture.current.y - head * Math.sin(angle - spread),
				)
				.lineTo(gesture.current.x, gesture.current.y)
				.lineTo(
					gesture.current.x - head * Math.cos(angle + spread),
					gesture.current.y - head * Math.sin(angle + spread),
				)
				.stroke({
					color: color.stroke,
					width: Math.max(gesture.size, 1.5 * inv),
					alpha: 0.92,
					cap: "round",
					join: "round",
				});
			continue;
		}
		if (gesture.kind === "box") {
			const color = pickBoardColor(colors, gesture.color, mode);
			const x = Math.min(gesture.start.x, gesture.current.x);
			const y = Math.min(gesture.start.y, gesture.current.y);
			const width = Math.max(1, Math.abs(gesture.current.x - gesture.start.x));
			const height = Math.max(1, Math.abs(gesture.current.y - gesture.start.y));
			overlay
				.roundRect(x, y, width, height, 4)
				.fill({ color: color.fill, alpha: 0.05 })
				.stroke({ color: color.stroke, width: 1.5 * inv, alpha: 0.82 });
			continue;
		}
		if (gesture.bounds) {
			overlay
				.rect(
					gesture.bounds.x,
					gesture.bounds.y,
					gesture.bounds.width,
					gesture.bounds.height,
				)
				.stroke({
					color: collaboration,
					width: 1.5 * inv,
					alpha: 0.88,
				});
		}
	}
}

/**
 * Draw in-progress gesture previews (freehand stroke, arrow being drawn) and
 * alignment guides onto the overlay, in world space. These are ephemeral — they
 * exist only while a gesture is active and never touch the document.
 */
function drawTransient(
	palette: BoardRenderPalette,
	colors: BoardShapeColors,
	mode: "dark" | "light",
) {
	if (!overlay) return;
	const zoom = editor.camera.zoom;
	const inv = 1 / Math.max(zoom, 0.0001);
	const interaction = editor.interaction;

	// Alignment guides.
	for (const guide of editor.snapGuides) {
		overlay
			.moveTo(
				guide.axis === "x" ? guide.at : guide.from,
				guide.axis === "x" ? guide.from : guide.at,
			)
			.lineTo(
				guide.axis === "x" ? guide.at : guide.to,
				guide.axis === "x" ? guide.to : guide.at,
			)
			.stroke({ color: palette.brand, width: inv, alpha: 0.9 });
	}

	if (interaction.type === "drawing" && interaction.points.length > 0) {
		const color = pickBoardColor(colors, interaction.color, mode);
		const outline = buildStrokeOutline(interaction.points, interaction.size);
		if (outline.length >= 3) {
			overlay.moveTo(outline[0].x, outline[0].y);
			for (let i = 1; i < outline.length; i += 1)
				overlay.lineTo(outline[i].x, outline[i].y);
			overlay.closePath().fill({ color: color.stroke, alpha: 0.92 });
		}
	}

	if (interaction.type === "creatingArrow") {
		const color = pickBoardColor(colors, interaction.color, mode);
		const { start, current } = interaction;
		overlay
			.moveTo(start.x, start.y)
			.lineTo(current.x, current.y)
			.stroke({
				color: color.stroke,
				width: Math.max(interaction.size, 1.5 * inv),
				alpha: 0.9,
			});
		const angle = Math.atan2(current.y - start.y, current.x - start.x);
		const head = Math.max(14, 16 * inv);
		const spread = Math.PI / 6;
		overlay
			.moveTo(
				current.x - head * Math.cos(angle - spread),
				current.y - head * Math.sin(angle - spread),
			)
			.lineTo(current.x, current.y)
			.lineTo(
				current.x - head * Math.cos(angle + spread),
				current.y - head * Math.sin(angle + spread),
			)
			.stroke({
				color: color.stroke,
				width: Math.max(interaction.size, 1.5 * inv),
				alpha: 0.95,
				cap: "round",
				join: "round",
			});
	}

	if (interaction.type === "creatingBox") {
		const color = pickBoardColor(colors, interaction.color, mode);
		const { start, current } = interaction;
		const x = Math.min(start.x, current.x);
		const y = Math.min(start.y, current.y);
		const w = Math.abs(current.x - start.x);
		const h = Math.abs(current.y - start.y);
		if (w > 1 || h > 1) {
			overlay
				.roundRect(x, y, Math.max(w, 1), Math.max(h, 1), 4)
				.fill({ color: color.fill, alpha: 0.04 })
				.stroke({
					color: color.stroke,
					width: 1.5 * inv,
					alpha: 0.85,
				});
		}
	}
}

function reportSurfaceSize() {
	if (!app) {
		surface = { width: 0, height: 0 };
		onSurfaceChange?.({ width: 0, height: 0 });
		return;
	}
	surface = { width: app.screen.width, height: app.screen.height };
	onSurfaceChange?.({ width: app.screen.width, height: app.screen.height });
}

function resizeStage() {
	if (!app) return;
	cancelAnimationFrame(resizeFrame);
	resizeFrame = requestAnimationFrame(() => {
		if (!app) return;
		app.resize();
		syncStage();
		reportSurfaceSize();
	});
}

// Convert a DOM event to a surface-relative screen point (the single place
// screen coordinates enter the editor).
function toScreenPoint(
	event: PointerEvent | WheelEvent | MouseEvent,
): ScreenPoint {
	if (!host) return screenPoint(0, 0);
	const rect = host.getBoundingClientRect();
	return screenPoint(event.clientX - rect.left, event.clientY - rect.top);
}

function toPointerEvent(event: PointerEvent) {
	const screen = toScreenPoint(event);
	return {
		pointerId: event.pointerId,
		screen,
		world: pointToWorld(screen, editor.camera),
		shiftKey: event.shiftKey,
		metaKey: event.metaKey,
		ctrlKey: event.ctrlKey,
		altKey: event.altKey,
		button: event.button,
		buttons: event.buttons,
		pointerType: event.pointerType,
		cancelled:
			event.type === "pointercancel" || event.type === "lostpointercapture",
		// Pens report real pressure; mouse/touch default to a mid value so strokes
		// have a sensible, consistent width.
		pressure:
			event.pointerType === "pen" && event.pressure > 0 ? event.pressure : 0.5,
	};
}

function pointerType(event: PointerEvent): "mouse" | "pen" | "touch" {
	if (event.pointerType === "pen" || event.pointerType === "touch")
		return event.pointerType;
	return "mouse";
}

function publishPointerPresence(event: PointerEvent) {
	const point = toPointerEvent(event).world;
	onPointerPresence?.({
		x: point.x,
		y: point.y,
		pointerType: pointerType(event),
	});
}

function handlePointerDown(event: PointerEvent) {
	if (!host) return;
	host.setPointerCapture(event.pointerId);
	const input = toPointerEvent(event);
	editor.pointerDown(input);
	onPointerPresence?.({
		x: input.world.x,
		y: input.world.y,
		pointerType: pointerType(event),
	});
}

function handlePointerMove(event: PointerEvent) {
	const input = toPointerEvent(event);
	editor.pointerMove(input);
	onPointerPresence?.({
		x: input.world.x,
		y: input.world.y,
		pointerType: pointerType(event),
	});
}

function handlePointerUp(event: PointerEvent) {
	editor.pointerUp(toPointerEvent(event));
	if (event.type === "pointercancel" || event.pointerType !== "mouse") {
		editor.pointerLeave();
		onPointerPresence?.(null);
	} else {
		publishPointerPresence(event);
	}
}

function handlePointerLeave(event: PointerEvent) {
	if (event.buttons !== 0) return;
	editor.pointerLeave();
	onPointerPresence?.(null);
}

function handleWheel(event: WheelEvent) {
	event.preventDefault();
	editor.wheel(
		toScreenPoint(event),
		event.deltaX,
		event.deltaY,
		event.ctrlKey || event.metaKey,
		event.deltaMode,
	);
}

function handleDoubleClick(event: MouseEvent) {
	const rect = host?.getBoundingClientRect() ?? new DOMRect();
	const worldPointAtCursor = screenToWorld(
		event.clientX,
		event.clientY,
		rect,
		editor.camera,
	);
	const item = editor.itemAt(worldPointAtCursor);
	// A file card is an entry point, not an editable surface: activating it opens
	// the file in the workspace preview, the same destination as the file tree.
	if (item?.type === "file") {
		void onOpenFile?.(item.ref.path);
		return;
	}
	// View mode stops here: text editing and the blank-canvas text draft are both
	// authoring actions.
	if (readonly) return;
	if (item && !item.locked && shapeCapabilities(item).canEdit) {
		editor.editingId = item.id;
	} else if (!item) {
		editor.beginTextDraft(worldPointAtCursor);
	}
}

/**
 * Read previews for file cards and fold the results into their snapshots.
 *
 * Cards are already on the board before this runs, so a slow or failed read only
 * means less detail, never a missing card.
 */
async function enrichFileCards(targets: Array<{ id: string; path: string }>) {
	const resolved = await Promise.all(
		targets.map(async ({ id, path }) => {
			const item = editor.itemById(id);
			if (item?.type !== "file") return null;
			const result = await loadFilePreview(spaceId, {
				path,
				title: item.snapshot?.title,
				mimeType: item.snapshot?.mimeType,
				size: item.snapshot?.size,
				mtimeMs: item.snapshot?.mtimeMs,
			});
			// `replace` carries the distinction the editor needs: a complete read
			// describes the file as it is now, so fields it omits are fields the file
			// no longer has. An incomplete one is only merged, so a failed read never
			// blanks a card.
			return { id, snapshot: result.facts, replace: result.complete };
		}),
	);
	const updates = resolved.filter(
		(
			entry,
		): entry is {
			id: string;
			snapshot: BoardFileSnapshot;
			replace: boolean;
		} => entry !== null,
	);
	if (updates.length > 0) editor.applyFileSnapshots(updates);
}

function handleDrop(event: DragEvent) {
	event.preventDefault();
	dropActive = false;
	if (readonly) return;

	const items: BoardDropItem[] = [];

	const raw = event.dataTransfer?.getData("application/x-cohub-resource");
	if (raw) {
		try {
			const payload = JSON.parse(raw) as {
				resources?: Array<{
					type?: string;
					title?: string;
					path?: string;
					ref?: string;
					mimeType?: string;
					size?: number;
					mtimeMs?: number;
				}>;
			};
			for (const resource of payload.resources ?? []) {
				if (resource.type && resource.type !== "file") continue;
				const path = (resource.path ?? resource.ref ?? "").replace(/\/$/, "");
				if (!path) continue;
				items.push({
					path,
					snapshot: {
						title: resource.title,
						mimeType: resource.mimeType,
						size: resource.size,
						mtimeMs: resource.mtimeMs,
					},
				});
			}
		} catch {
			/* ignore malformed payload */
		}
	}

	if (items.length === 0) {
		const path = event.dataTransfer
			?.getData("text/cohub-path")
			?.replace(/\/$/, "");
		if (path) items.push({ path });
	}

	dropBoardItems(event.clientX, event.clientY, items);
}

/**
 * Place dropped workspace files on the board at a screen point.
 *
 * Shared by the native drag-and-drop path (desktop) and the touch/pen pointer
 * drag path (mobile), so both produce identical cards and enrichment.
 */
function dropBoardItems(
	clientX: number,
	clientY: number,
	items: BoardDropItem[],
) {
	if (!host || items.length === 0) return;
	const rect = host.getBoundingClientRect();
	const origin = screenToWorld(clientX, clientY, rect, editor.camera);

	// Tile dropped files to the right so a multi-drop stays readable. Every file is
	// accepted — non-media becomes a file card — so the created ids are collected
	// and handed to the preview enrichment below.
	let offsetX = 0;
	const created: Array<{ id: string; path: string }> = [];
	for (const entry of items) {
		const id = editor.addFile(
			entry.path,
			worldPoint(origin.x + offsetX, origin.y),
			entry.snapshot,
		);
		created.push({ id, path: entry.path });
		offsetX += 36;
	}
	// Surface the result of the drop: the new cards are the selection, which also
	// puts them under the selection toolbar for an immediate follow-up action.
	if (created.length > 0) {
		editor.setSelection(created.map((entry) => entry.id));
		// Read previews in the background; the cards are already on the board and
		// simply gain detail when this lands.
		void enrichFileCards(created);
	}
}

const ROTATE_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath d='M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5' fill='none' stroke='%23fff' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5' fill='none' stroke='%231d1d1f' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") 12 12, crosshair`;

const cursor = $derived.by(() => {
	const interaction = editor.interaction;
	if (interaction.type === "panning") return "grabbing";
	if (interaction.type === "translating") return "grabbing";
	if (interaction.type === "resizing")
		return resizeCursorForHandle(
			interaction.handle,
			interaction.single?.rotation ?? 0,
		);
	if (interaction.type === "rotating") return ROTATE_CURSOR;
	if (interaction.type === "draggingArrowHandle") return "crosshair";
	if (interaction.type === "brushing") return "crosshair";
	if (editor.spaceHeld || editor.tool === "hand") return "grab";

	const control = editor.hoveredTransformControl;
	if (control?.kind === "resize")
		return resizeCursorForHandle(
			control.handle,
			editor.selectionTransform?.frame.rotation ?? 0,
		);
	if (control?.kind === "rotate") return ROTATE_CURSOR;

	switch (editor.tool) {
		case "draw":
		case "arrow":
		case "geo":
		case "frame":
		case "text":
			return "crosshair";
		default: {
			const hovered = editor.hoverId ? editor.itemById(editor.hoverId) : null;
			return hovered && !hovered.locked && shapeCapabilities(hovered).canMove
				? "move"
				: "default";
		}
	}
});

let disposed = false;

onMount(async () => {
	if (!host) return;
	const instance = new Application();
	try {
		await instance.init({
			antialias: true,
			autoDensity: true,
			backgroundAlpha: 0,
			resizeTo: host,
			resolution: getBoardResolution(),
			// Render on demand (see scheduleRender) instead of every tick, so an
			// idle board does not keep the GPU/CPU busy redrawing an unchanged
			// scene ~60 times a second.
			autoStart: false,
		});
	} catch (error) {
		console.error("Board failed to initialize", error);
		instance.destroy(true);
		return;
	}
	// The component may have been torn down while init was awaiting.
	if (disposed) {
		instance.destroy(true);
		return;
	}
	app = instance;
	instance.canvas.classList.add("board-stage-canvas");
	host.appendChild(instance.canvas);
	world = new Container({ isRenderGroup: true, label: "board-world" });
	effectsBehind = new Container({ label: "board-effects-behind" });
	nodeLayer = new Container({ label: "board-nodes" });
	effectsFront = new Container({ label: "board-effects-front" });
	screenEffects = new Container({
		isRenderGroup: true,
		label: "board-screen-effects",
	});
	overlay = new Graphics({ label: "board-interaction-overlay" });
	// Batched far-LOD geometry. Lives at the bottom of the node layer so live
	// cards (selection, editing) always draw above the plates.
	farLayer = new Graphics({ label: "board-far-layer" });
	nodeLayer.addChild(farLayer);
	world.addChild(effectsBehind, nodeLayer, effectsFront, overlay);
	scene = createBoardScene({
		world: nodeLayer,
		farLayer,
		overlay,
		getRenderer: getBoardCardRenderer,
	});
	animationRuntime = createBoardAnimationRuntime({
		getNode: (nodeId) => scene?.getNode(nodeId) ?? null,
		getWorld: () => world,
		getLayers: () =>
			effectsBehind && effectsFront && screenEffects
				? { behind: effectsBehind, front: effectsFront, screen: screenEffects }
				: null,
		getScreen: () => ({
			width: app?.screen.width ?? 0,
			height: app?.screen.height ?? 0,
		}),
		getAccentColor: () => getPalette().brand,
		render: () => {
			if (active) app?.render();
		},
	});
	animationRuntime.setActive(active);
	animationRuntime.setData(runtime);

	// The export path deliberately reuses this renderer and this theme snapshot:
	onExportReady?.({
		renderer: () => (app ? (app.renderer as unknown as Renderer) : null),
		theme: () => {
			const resolved = resolveTheme();
			return {
				palette: resolved.palette,
				colors: resolved.colors,
				colorScheme: resolved.colorScheme,
			};
		},
		assetKey: assets.assetKey,
		withTextures: (items, use) => assets.withTextures(items, use),
	});

	host.addEventListener("pointerdown", handlePointerDown);
	host.addEventListener("pointermove", handlePointerMove);
	host.addEventListener("pointerup", handlePointerUp);
	host.addEventListener("pointercancel", handlePointerUp);
	host.addEventListener("lostpointercapture", handlePointerUp);
	host.addEventListener("pointerleave", handlePointerLeave);
	host.addEventListener("wheel", handleWheel, { passive: false });
	host.addEventListener("dblclick", handleDoubleClick);

	resizeObserver = new ResizeObserver(resizeStage);
	resizeObserver.observe(host);
	resizeStage();
	window.addEventListener(SPACE_STYLE_CHANGED_EVENT, handleSpaceStyleChanged);
});

$effect(() => {
	animationRuntime?.setData(runtime);
});

$effect(() => {
	animationRuntime?.setActive(active);
	if (!active) {
		cancelAnimationFrame(renderFrame);
		renderFrame = 0;
		return;
	}
	resizeStage();
	syncStage();
});

$effect(() => {
	editor.items;
	editor.camera;
	editor.selection;
	editor.hoverId;
	editor.marquee;
	editor.bounds;
	editor.interaction;
	editor.snapGuides;
	editor.structureVersion;
	editor.geometryVersion;
	awarenessVersion;
	assetVersion;
	// Re-render when the user theme or active Space style changes.
	getResolvedTheme();
	spaceStyleVersion;
	syncStage();
});

onDestroy(() => {
	disposed = true;
	window.removeEventListener(
		SPACE_STYLE_CHANGED_EVENT,
		handleSpaceStyleChanged,
	);
	resizeObserver?.disconnect();
	cancelAnimationFrame(resizeFrame);
	cancelAnimationFrame(renderFrame);
	unsubscribeAssets();
	unsubscribePreviews();
	if (host) {
		host.removeEventListener("pointerdown", handlePointerDown);
		host.removeEventListener("pointermove", handlePointerMove);
		host.removeEventListener("pointerup", handlePointerUp);
		host.removeEventListener("pointercancel", handlePointerUp);
		host.removeEventListener("lostpointercapture", handlePointerUp);
		host.removeEventListener("pointerleave", handlePointerLeave);
		host.removeEventListener("wheel", handleWheel);
		host.removeEventListener("dblclick", handleDoubleClick);
	}
	// Stop animation and restore transient poses before releasing scene resources.
	animationRuntime?.destroy();
	animationRuntime = null;
	const context = buildContext(getPalette(), (id) => editor.itemById(id));
	scene?.destroy(context);
	scene = null;
	assets.destroy();
	background?.destroy({ children: true });
	background = null;
	effectsBehind = null;
	nodeLayer = null;
	effectsFront = null;
	screenEffects = null;
	world = null;
	overlay = null;
	farLayer = null;
	app?.destroy(true);
	app = null;
	onExportReady?.(null);
});
</script>

<div
	bind:this={host}
	class="board-stage-host relative isolate h-full w-full overflow-hidden {dropActive ? 'board-drop-active' : ''}"
	class:bg-bg-primary={Boolean(boardBackdrop)}
	role="application"
	aria-label="Board stage"
	data-drawer-swipe-ignore
	style:cursor={cursor}
	style:touch-action="none"
	use:pointerDropZone={{
		resolve: (payload) => {
			if (readonly) return null;
			// Directories have no single file to reference, so the board declines them
			// rather than silently dropping part of the payload.
			const items = toBoardDropItems(payload);
			if (items.length === 0) return null;
			return { label: "Add to board", effect: "copy" };
		},
		drop: (payload, point) => {
			if (readonly) return;
			dropBoardItems(point.clientX, point.clientY, toBoardDropItems(payload));
		},
	}}
	ondragover={(event) => {
		if (readonly) return;
		const types = event.dataTransfer?.types;
		if (!types) return;
		// Accept both the rich resource payload and the bare path, so a drag from
		// anywhere in the workspace (file tree, task tray) lands.
		if (types.includes("text/cohub-path") || types.includes("application/x-cohub-resource")) {
			event.preventDefault();
			dropActive = true;
		}
	}}
	ondragleave={() => { dropActive = false; }}
	ondrop={handleDrop}
>
	{#if boardBackdrop}
		<div
			aria-hidden="true"
			class="pointer-events-none absolute inset-0 z-0"
			style:background-image={`url(${JSON.stringify(boardBackdrop.url)})`}
			style:background-position={`${editor.camera.x}px ${editor.camera.y}px`}
			style:background-repeat="repeat"
			style:background-size={backdropSize(boardBackdrop)}
		></div>
	{/if}
</div>

<style>
	.board-stage-host :global(.board-stage-canvas) {
		position: relative;
		z-index: 1;
		display: block;
	}

	.board-drop-active::after {
		content: "";
		position: absolute;
		inset: 0.75rem;
		z-index: 2;
		pointer-events: none;
		border: 1px solid var(--brand-border);
		border-radius: 0.75rem;
		background: color-mix(in srgb, var(--brand-bg) 40%, transparent);
	}
</style>
