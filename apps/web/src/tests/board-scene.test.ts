import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardItem } from "@neta-art/cohub/board";
import { buildFallbackShapeColors } from "@neta-art/cohub/board";
import {
	type BoardCardRenderer,
	type BoardRenderContext,
	type BoardRenderPalette,
	boardCardRenderersForTest,
} from "@neta-art/cohub/board/render";
import { createBoardScene } from "../lib/board/board-scene.ts";

/**
 * These tests pin the scaling contract of the scene: cost must track what is on
 * screen, not how large the document is. They run headless against minimal
 * stand-ins for Pixi's display objects — the scene only ever touches parenting,
 * child order and visibility, so no GPU or DOM is required.
 */

type FakeContainer = {
	children: FakeContainer[];
	parent: FakeContainer | null;
	visible: boolean;
	destroyed: boolean;
	zIndex: number;
	sortableChildren: boolean;
	addChild: (child: FakeContainer) => void;
	removeChild: (child: FakeContainer) => void;
	setChildIndex: (child: FakeContainer, index: number) => void;
	sortChildren: () => void;
	destroy: (options?: unknown) => void;
	clear: () => FakeContainer;
};

function createContainer(): FakeContainer {
	const self: FakeContainer = {
		children: [],
		parent: null,
		visible: true,
		destroyed: false,
		zIndex: 0,
		sortableChildren: false,
		addChild(child) {
			child.parent = self;
			self.children.push(child);
		},
		removeChild(child) {
			const index = self.children.indexOf(child);
			if (index >= 0) self.children.splice(index, 1);
			if (child.parent === self) child.parent = null;
		},
		setChildIndex(child, index) {
			const current = self.children.indexOf(child);
			if (current < 0) return;
			self.children.splice(current, 1);
			self.children.splice(index, 0, child);
		},
		// Mirrors Pixi's stable sort by zIndex.
		sortChildren() {
			self.children = self.children
				.map((child, index) => ({ child, index }))
				.sort((a, b) => a.child.zIndex - b.child.zIndex || a.index - b.index)
				.map((entry) => entry.child);
		},
		destroy() {
			self.destroyed = true;
		},
		clear() {
			return self;
		},
	};
	return self;
}

/** Counting renderer, so the tests can assert on real create/update volume. */
function createCountingRenderer(options: { far: boolean }) {
	const counts = { created: 0, updated: 0, destroyed: 0, farDrawn: 0 };
	const renderer: BoardCardRenderer = {
		id: options.far ? "far-capable" : "container-only",
		canRender: () => true,
		create: () => {
			counts.created += 1;
			return createContainer() as never;
		},
		update: () => {
			counts.updated += 1;
		},
		destroy: () => {
			counts.destroyed += 1;
		},
		...(options.far
			? {
					renderFar: () => {
						counts.farDrawn += 1;
					},
				}
			: {}),
	};
	return { renderer, counts };
}

const palette: BoardRenderPalette = {
	bg: 0,
	surface: 0,
	hover: 0,
	border: 0,
	brand: 0,
	text: 0,
	muted: 0,
	rare: 0,
	epic: 0,
	legendary: 0,
};

function makeItems(count: number): BoardItem[] {
	return Array.from({ length: count }, (_, index) => ({
		id: `n${index}`,
		type: "geo" as const,
		geo: "rectangle",
		text: "",
		color: "brand",
		fillOpacity: 0,
		frame: {
			x: index * 10,
			y: 0,
			width: 100,
			height: 100,
			rotation: 0,
		},
	}));
}

function makeContext(
	items: BoardItem[],
	overrides: Partial<BoardRenderContext> = {},
): BoardRenderContext {
	const acquired = new Set<string>();
	const byId = new Map(items.map((item) => [item.id, item]));
	return {
		getItem: (id: string) => byId.get(id) ?? null,
		document: {
			kind: "cohub.board",
			version: 1,
			appearance: {
				theme: "clean",
				background: { kind: "solid" },
				grid: { visible: false, size: 24, opacity: 0.12 },
				mood: "clean",
			},
			viewport: { x: 0, y: 0, zoom: 1 },
			items,
		} as BoardRenderContext["document"],
		selectedIds: new Set(),
		hoveredId: null,
		resizingIds: new Set(),
		palette,
		colors: buildFallbackShapeColors("dark"),
		colorScheme: "dark",
		zoom: 1,
		assetKey: () => null,
		getTexture: () => null,
		hasError: () => false,
		fileState: () => "ok" as const,
		acquireTexture: (key) => acquired.add(key),
		releaseTexture: (key) => acquired.delete(key),
		...overrides,
	};
}

function setupScene(renderer: BoardCardRenderer) {
	const world = createContainer();
	const farLayer = createContainer();
	const overlay = createContainer();
	world.addChild(farLayer);
	const scene = createBoardScene({
		world: world as never,
		farLayer: farLayer as never,
		overlay: overlay as never,
		getRenderer: () => renderer,
	});
	return { scene, world, farLayer, overlay };
}

function syncOnce(
	scene: ReturnType<typeof createBoardScene>,
	input: {
		items: BoardItem[];
		context: BoardRenderContext;
		visibleIds: Set<string> | null;
		pinnedIds?: Set<string>;
		structureVersion?: number;
		geometryVersion?: number;
		gestureActive?: boolean;
		globalSig?: string;
	},
) {
	const byId = new Map(input.items.map((item) => [item.id, item]));
	scene.sync({
		items: input.items,
		context: input.context,
		getItem: (id) => byId.get(id) ?? null,
		visibleIds: input.visibleIds,
		pinnedIds: input.pinnedIds ?? new Set(),
		globalSig: input.globalSig ?? "sig",
		structureVersion: input.structureVersion ?? 1,
		geometryVersion: input.geometryVersion ?? 1,
		gestureActive: input.gestureActive ?? false,
	});
}

test("materialises only visible cards, not the whole document", () => {
	const items = makeItems(5000);
	const { renderer, counts } = createCountingRenderer({ far: false });
	const { scene, world } = setupScene(renderer);
	const visibleIds = new Set(items.slice(0, 12).map((item) => item.id));

	syncOnce(scene, { items, context: makeContext(items), visibleIds });

	assert.equal(counts.created, 12, "creates one container per visible card");
	// world holds the far layer plus the visible containers.
	assert.equal(world.children.length, 13);
});

test("recycles containers on pan instead of reallocating", () => {
	const items = makeItems(200);
	const { renderer, counts } = createCountingRenderer({ far: false });
	const { scene } = setupScene(renderer);
	const context = makeContext(items);

	syncOnce(scene, {
		items,
		context,
		visibleIds: new Set(items.slice(0, 10).map((item) => item.id)),
	});
	assert.equal(counts.created, 10);

	// Pan to a disjoint window: the outgoing containers should be reused.
	syncOnce(scene, {
		items,
		context,
		visibleIds: new Set(items.slice(50, 60).map((item) => item.id)),
	});

	assert.equal(counts.created, 10, "no new containers allocated after the pan");
	assert.equal(counts.destroyed, 0, "recycled rather than destroyed");
});

test("keeps document z-order when a card materialises mid-pan", () => {
	const items = makeItems(10);
	const { renderer } = createCountingRenderer({ far: false });
	const { scene, world, farLayer } = setupScene(renderer);
	const context = makeContext(items);

	syncOnce(scene, { items, context, visibleIds: new Set(["n5"]) });
	// Reveal an earlier sibling without a structural change (a pure pan).
	syncOnce(scene, { items, context, visibleIds: new Set(["n2", "n5"]) });

	const order = world.children.map((child) => {
		if (child === farLayer) return "far";
		const found = ["n2", "n5"].find(
			(id) => scene.getNode(id)?.container === (child as never),
		);
		return found ?? "?";
	});
	assert.deepEqual(
		order,
		["far", "n2", "n5"],
		"n2 sits below n5, matching document order",
	);
});

test("far layer replaces containers past the density threshold", () => {
	const items = makeItems(2000);
	const { renderer, counts } = createCountingRenderer({ far: true });
	const { scene, farLayer } = setupScene(renderer);
	const context = makeContext(items);
	const visibleIds = new Set(items.map((item) => item.id));

	syncOnce(scene, { items, context, visibleIds });

	assert.equal(counts.created, 0, "no per-card containers in far mode");
	assert.equal(
		counts.farDrawn,
		2000,
		"every card contributes batched geometry",
	);
	assert.equal(farLayer.visible, true);
});

test("far layer is not rebuilt while a gesture is running", () => {
	const items = makeItems(1000);
	const { renderer, counts } = createCountingRenderer({ far: true });
	const { scene } = setupScene(renderer);
	const context = makeContext(items);
	const visibleIds = new Set(items.map((item) => item.id));

	syncOnce(scene, { items, context, visibleIds, geometryVersion: 1 });
	const afterFirst = counts.farDrawn;

	// A drag bumps geometryVersion every frame; only pinned nodes actually move,
	// and pinned nodes are excluded from the batch.
	for (let frame = 2; frame < 8; frame += 1) {
		syncOnce(scene, {
			items,
			context,
			visibleIds,
			pinnedIds: new Set(["n0"]),
			geometryVersion: frame,
			gestureActive: true,
		});
	}

	assert.equal(
		counts.farDrawn,
		afterFirst,
		"batch untouched during the gesture",
	);

	// Pointer-up: one rebuild picks up the committed geometry.
	syncOnce(scene, {
		items,
		context,
		visibleIds,
		pinnedIds: new Set(["n0"]),
		geometryVersion: 9,
		gestureActive: false,
	});
	assert.ok(counts.farDrawn > afterFirst, "rebuilt once the gesture ended");
});

test("pinned cards stay live containers while the rest are batched", () => {
	const items = makeItems(1000);
	const { renderer, counts } = createCountingRenderer({ far: true });
	const { scene } = setupScene(renderer);
	const context = makeContext(items);
	const visibleIds = new Set(items.map((item) => item.id));

	syncOnce(scene, {
		items,
		context,
		visibleIds,
		pinnedIds: new Set(["n7"]),
	});

	assert.equal(counts.created, 1, "only the pinned card is materialised");
	assert.ok(scene.getNode("n7"), "pinned card is reachable as a live node");
	assert.equal(scene.getNode("n8"), null, "batched card has no container");
});

test("swapping the pinned node rebuilds the batch", () => {
	const items = makeItems(1000);
	const { renderer, counts } = createCountingRenderer({ far: true });
	const { scene } = setupScene(renderer);
	const context = makeContext(items);
	const visibleIds = new Set(items.map((item) => item.id));

	syncOnce(scene, { items, context, visibleIds, pinnedIds: new Set(["n1"]) });
	const afterFirst = counts.farDrawn;

	// Same pinned-set size, different member: a size-only key would miss this.
	syncOnce(scene, { items, context, visibleIds, pinnedIds: new Set(["n2"]) });

	assert.ok(
		counts.farDrawn > afterFirst,
		"batch rebuilt for the new pinned set",
	);
});

test("leaving far mode releases the batch and materialises the visible few", () => {
	const items = makeItems(1000);
	const { renderer, counts } = createCountingRenderer({ far: true });
	const { scene, farLayer } = setupScene(renderer);
	const context = makeContext(items);

	syncOnce(scene, {
		items,
		context,
		visibleIds: new Set(items.map((item) => item.id)),
	});
	assert.equal(farLayer.visible, true);

	// Zoom in: only a handful of cards remain visible.
	syncOnce(scene, {
		items,
		context,
		visibleIds: new Set(items.slice(0, 20).map((item) => item.id)),
	});

	assert.equal(farLayer.visible, false, "far layer switched off");
	assert.equal(counts.created, 20, "visible cards became live containers");
});

test("structure changes recycle removed cards and release their textures", () => {
	const items = makeItems(20);
	const { renderer, counts } = createCountingRenderer({ far: false });
	const { scene } = setupScene(renderer);
	const released: string[] = [];
	const context = makeContext(items, {
		assetKey: (item) => `key:${item.id}`,
		releaseTexture: (key) => released.push(key),
	});
	const visibleIds = new Set(items.slice(0, 5).map((item) => item.id));

	syncOnce(scene, { items, context, visibleIds, structureVersion: 1 });
	assert.equal(counts.created, 5);

	test("far layer batches only the visible set, not the whole document", () => {
		// The far layer exists to make cost track the viewport. Batching every plate in
		// the document would defeat that: one Graphics holding 20k plates uploads and
		// draws all of them every frame.
		const items = makeItems(20_000);
		const { renderer, counts } = createCountingRenderer({ far: true });
		const { scene } = setupScene(renderer);
		const context = makeContext(items);
		const visibleIds = new Set(items.slice(0, 600).map((item) => item.id));

		syncOnce(scene, { items, context, visibleIds });

		assert.equal(counts.created, 0, "no per-card containers in far mode");
		assert.equal(
			counts.farDrawn,
			600,
			"batched geometry is generated for the visible set only",
		);
	});

	test("far layer rebuilds when a pan changes which cards are visible", () => {
		const items = makeItems(20_000);
		const { renderer, counts } = createCountingRenderer({ far: true });
		const { scene } = setupScene(renderer);
		const context = makeContext(items);

		syncOnce(scene, {
			items,
			context,
			visibleIds: new Set(items.slice(0, 600).map((item) => item.id)),
		});
		assert.equal(counts.farDrawn, 600);

		// Same count, different members: a size-only key would miss this and leave the
		// previous window's plates on screen.
		syncOnce(scene, {
			items,
			context,
			visibleIds: new Set(items.slice(600, 1200).map((item) => item.id)),
		});
		assert.equal(counts.farDrawn, 1200, "the new window was batched");

		// An identical visible set must not rebuild.
		syncOnce(scene, {
			items,
			context,
			visibleIds: new Set(items.slice(600, 1200).map((item) => item.id)),
		});
		assert.equal(counts.farDrawn, 1200, "an unchanged window is not rebuilt");
	});

	test("batched geometry is emitted in document order", () => {
		// One Graphics draws in the order it was traced, so document order is only
		// preserved if the batch is built in that order.
		const items = makeItems(600);
		const drawn: string[] = [];
		const renderer: BoardCardRenderer = {
			id: "far-capable",
			canRender: () => true,
			create: () => createContainer() as never,
			update: () => {},
			renderFar: (_graphics, item) => {
				drawn.push(item.id);
			},
		};
		const { scene } = setupScene(renderer);
		const context = makeContext(items);

		syncOnce(scene, {
			items,
			context,
			visibleIds: new Set(items.map((item) => item.id)),
		});

		assert.deepEqual(
			drawn,
			items.map((item) => item.id),
		);
	});

	test("every card renderer can draw itself at far LOD", () => {
		// This is what makes the far layer's z-order correct. An item without renderFar
		// stays a live container, and live containers are drawn above the entire batch
		// regardless of document position — a frame would then hide the cards inside it.
		// Pinned items are the deliberate exception: they are being manipulated.
		const missing = boardCardRenderersForTest()
			.filter((renderer) => typeof renderer.renderFar !== "function")
			.map((renderer) => renderer.id);
		assert.deepEqual(
			missing,
			[],
			"these renderers would break far-mode z-order",
		);
	});
	const remaining = items.filter((item) => item.id !== "n0");
	syncOnce(scene, {
		items: remaining,
		context,
		visibleIds,
		structureVersion: 2,
	});

	assert.equal(scene.getNode("n0"), null, "deleted card is gone");
	assert.ok(released.includes("key:n0"), "its texture reference was released");
});
