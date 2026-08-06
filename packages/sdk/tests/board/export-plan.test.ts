import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardDocument, BoardItem } from "@cohub/protocol/board-document";
import {
  BOARD_EXPORT_DEFAULT_PADDING,
  BOARD_EXPORT_MAX_EDGE,
  BOARD_EXPORT_MAX_PIXELS,
  planBoardExport,
} from "../../src/board/core/export-plan.js";

/**
 * Export planning is where "what do I get, and how big is it" is decided, so
 * these pin the parts a user would notice: which items land in the image, how
 * padding differs per region kind, and that a large board cannot ask for a
 * texture no backend will allocate.
 */

function frame(x: number, y: number, width: number, height: number) {
  return { x, y, width, height, rotation: 0 };
}

function doc(items: BoardItem[]): BoardDocument {
  return {
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
  } as BoardDocument;
}

const box = (id: string, x: number, y: number): BoardItem =>
  ({
    id,
    type: "geo",
    geo: "rectangle",
    text: id,
    color: "brand",
    fillOpacity: 0,
    frame: frame(x, y, 100, 80),
  }) as BoardItem;

test("planBoardExport returns null for an empty document", () => {
  assert.equal(planBoardExport({ document: doc([]), region: { kind: "all" } }), null);
});

test("all region unions every item and applies default padding", () => {
  const plan = planBoardExport({
    document: doc([box("a", 0, 0), box("b", 300, 200)]),
    region: { kind: "all" },
    scale: 1,
  });
  assert.ok(plan);
  const pad = BOARD_EXPORT_DEFAULT_PADDING;
  assert.equal(plan.world.x, -pad);
  assert.equal(plan.world.y, -pad);
  // Content spans 0..400 x 0..280, plus padding on both sides.
  assert.equal(plan.world.width, 400 + pad * 2);
  assert.equal(plan.world.height, 280 + pad * 2);
  assert.equal(plan.items.length, 2);
});

test("items region keeps only the requested ids", () => {
  const plan = planBoardExport({
    document: doc([box("a", 0, 0), box("b", 300, 0), box("c", 600, 0)]),
    region: { kind: "items", ids: ["a", "c"] },
    scale: 1,
  });
  assert.ok(plan);
  assert.deepEqual(
    plan.items.map((item) => item.id),
    ["a", "c"],
  );
});

test("frame region excludes the frame itself but keeps what it contains", () => {
  const document = doc([
    { id: "f", type: "frame", label: "Page", color: "neutral", frame: frame(0, 0, 500, 400) } as BoardItem,
    box("inside", 50, 50),
    box("outside", 900, 900),
  ]);
  const plan = planBoardExport({ document, region: { kind: "frame", id: "f" }, scale: 1 });
  assert.ok(plan);
  assert.deepEqual(
    plan.items.map((item) => item.id),
    ["inside"],
  );
  // A frame is a page: it gets no padding, so the image is exactly the frame.
  assert.deepEqual(plan.world, { x: 0, y: 0, width: 500, height: 400 });
});

test("frame region returns null for an unknown id", () => {
  const plan = planBoardExport({
    document: doc([box("a", 0, 0)]),
    region: { kind: "frame", id: "missing" },
  });
  assert.equal(plan, null);
});

test("rect region selects intersecting items and is not padded", () => {
  const plan = planBoardExport({
    document: doc([box("a", 0, 0), box("b", 800, 0)]),
    region: { kind: "rect", rect: frame(0, 0, 200, 200) },
    scale: 1,
  });
  assert.ok(plan);
  assert.deepEqual(
    plan.items.map((item) => item.id),
    ["a"],
  );
  assert.deepEqual(plan.world, { x: 0, y: 0, width: 200, height: 200 });
});

test("explicit padding overrides the per-region default", () => {
  const plan = planBoardExport({
    document: doc([box("a", 0, 0)]),
    region: { kind: "rect", rect: frame(0, 0, 100, 100) },
    padding: 10,
    scale: 1,
  });
  assert.ok(plan);
  assert.deepEqual(plan.world, { x: -10, y: -10, width: 120, height: 120 });
});

test("scale is clamped to the edge budget and reported as clamped", () => {
  const plan = planBoardExport({
    document: doc([box("a", 0, 0)]),
    region: { kind: "rect", rect: frame(0, 0, 4000, 100) },
    scale: 8,
    maxEdge: 8192,
  });
  assert.ok(plan);
  assert.ok(plan.clamped, "expected the plan to report clamping");
  assert.ok(plan.width <= 8192, `width ${plan.width} exceeded the edge budget`);
  assert.equal(plan.requestedScale, 8);
  assert.ok(plan.scale < 8);
});

test("scale is clamped to the pixel budget even when each edge fits", () => {
  const plan = planBoardExport({
    document: doc([box("a", 0, 0)]),
    region: { kind: "rect", rect: frame(0, 0, 4000, 4000) },
    scale: 2,
    maxEdge: 8192,
    maxPixels: 4_000_000,
  });
  assert.ok(plan);
  assert.ok(plan.clamped);
  assert.ok(plan.width * plan.height <= 4_000_000 + 8192);
});

/**
 * The budgets exist to keep a renderer from being asked for a texture it cannot
 * allocate, so they have to hold for *any* world size — a lower bound on scale
 * would quietly let a huge board through.
 */
for (const [width, height] of [
  [1_000_000, 1_000_000],
  [1_000_000_000, 1_000_000_000],
  [4_000_000, 100],
] as const) {
  test(`a ${width}x${height} region still respects both budgets`, () => {
    const plan = planBoardExport({
      document: doc([box("a", 0, 0)]),
      region: { kind: "rect", rect: frame(0, 0, width, height) },
      scale: 2,
    });
    assert.ok(plan);
    assert.ok(
      plan.width <= BOARD_EXPORT_MAX_EDGE && plan.height <= BOARD_EXPORT_MAX_EDGE,
      `${plan.width}x${plan.height} exceeded the ${BOARD_EXPORT_MAX_EDGE}px edge budget`,
    );
    assert.ok(
      plan.width * plan.height <= BOARD_EXPORT_MAX_PIXELS,
      `${plan.width * plan.height} exceeded the ${BOARD_EXPORT_MAX_PIXELS} pixel budget`,
    );
    assert.ok(plan.clamped);
    assert.ok(plan.width >= 1 && plan.height >= 1);
  });
}

test("a non-finite or non-positive scale falls back to a usable one", () => {
  for (const scale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const plan = planBoardExport({
      document: doc([box("a", 0, 0)]),
      region: { kind: "rect", rect: frame(0, 0, 100, 100) },
      scale,
    });
    assert.ok(plan, `expected a plan for scale ${scale}`);
    assert.ok(plan.width >= 1 && plan.height >= 1);
    assert.ok(plan.width <= BOARD_EXPORT_MAX_EDGE);
  }
});

test("a requested scale that fits is preserved exactly", () => {
  const plan = planBoardExport({
    document: doc([box("a", 0, 0)]),
    region: { kind: "rect", rect: frame(0, 0, 100, 100) },
    scale: 3,
  });
  assert.ok(plan);
  assert.equal(plan.scale, 3);
  assert.equal(plan.clamped, false);
  assert.equal(plan.width, 300);
  assert.equal(plan.height, 300);
});

test("arrow bounds resolve through bindings so bound arrows are not clipped", () => {
  const document = doc([
    box("a", 0, 0),
    box("b", 400, 300),
    {
      id: "arrow",
      type: "arrow",
      start: { kind: "binding", target: "a", nx: 0.5, ny: 0.5, precise: true },
      end: { kind: "binding", target: "b", nx: 0.5, ny: 0.5, precise: true },
      bend: 0,
      color: "brand",
      size: 2,
      arrowStart: false,
      arrowEnd: true,
      label: "",
      frame: frame(0, 0, 1, 1),
    } as BoardItem,
  ]);
  const plan = planBoardExport({
    document,
    region: { kind: "items", ids: ["arrow"] },
    padding: 0,
    scale: 1,
  });
  assert.ok(plan);
  // The arrow's own frame is 1×1; resolved through its bindings it spans both boxes.
  assert.ok(plan.world.width > 300, `expected a resolved span, got ${plan.world.width}`);
  assert.ok(plan.world.height > 200, `expected a resolved span, got ${plan.world.height}`);
});
