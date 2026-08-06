import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { BoardDocument, BoardItem } from "@cohub/protocol/board-document";
import {
  type BoardHeadlessRenderer,
  createBoardHeadlessRenderer,
  exportBoardImageBytes,
} from "../../src/board/headless/index.js";

/**
 * End-to-end cover for the headless path: a real Canvas2D renderer, the real
 * card renderers, real PNG bytes. This is the test that would catch a PixiJS
 * upgrade breaking the Node environment shims — which is exactly the failure
 * mode that would otherwise only surface for a user running `boards export`.
 *
 * `@napi-rs/canvas` is optional, so the suite skips rather than fails when it is
 * not installed.
 */

function frame(x: number, y: number, width: number, height: number) {
  return { x, y, width, height, rotation: 0 };
}

const items: BoardItem[] = [
  { id: "f1", type: "frame", label: "Page", color: "neutral", frame: frame(0, 0, 600, 400) },
  {
    id: "t1",
    type: "text",
    text: "Export 你好",
    fontSize: 24,
    color: "brand",
    frame: frame(24, 24, 300, 40),
  },
  {
    id: "g0",
    type: "geo",
    geo: "rectangle",
    text: "box",
    color: "amber",
    fillOpacity: 0.2,
    frame: frame(24, 90, 160, 100),
  },
  {
    id: "g1",
    type: "geo",
    geo: "ellipse",
    text: "geo",
    color: "blue",
    fillOpacity: 0.2,
    frame: frame(220, 90, 150, 100),
  },
  {
    id: "d1",
    type: "draw",
    points: [
      { x: 0, y: 0, p: 0.5 },
      { x: 40, y: 30, p: 0.6 },
      { x: 90, y: 10, p: 0.4 },
    ],
    color: "rose",
    size: 5,
    frame: frame(24, 230, 120, 60),
  },
  {
    id: "a1",
    type: "arrow",
    start: { kind: "binding", target: "g0", nx: 1, ny: 0.5, precise: true },
    end: { kind: "binding", target: "g1", nx: 0, ny: 0.5, precise: true },
    bend: 0.2,
    color: "violet",
    size: 3,
    arrowStart: false,
    arrowEnd: true,
    label: "to",
    frame: frame(0, 0, 1, 1),
  },
] as BoardItem[];

const document: BoardDocument = {
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

/** PNG magic number, so "did it encode" is checked rather than assumed. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let available = true;
try {
  await import("@napi-rs/canvas");
} catch {
  available = false;
}

describe("headless board export", { skip: available ? false : "@napi-rs/canvas is not installed" }, () => {
  let headless: BoardHeadlessRenderer;

  before(async () => {
    headless = await createBoardHeadlessRenderer();
  });

  after(() => {
    headless?.destroy();
  });

  test("renders a document to PNG bytes", () => {
    const result = exportBoardImageBytes(headless, document, { scale: 1 });
    assert.ok(result, "expected an export result");
    assert.equal(result.format, "png");
    assert.deepEqual([...result.bytes.slice(0, 8)], PNG_SIGNATURE);
    // Padding on both sides of a 600×400 frame.
    assert.equal(result.plan.width, 664);
    assert.equal(result.plan.height, 464);
    assert.ok(result.bytes.length > 1000, "expected a non-trivial image");
  });

  test("scale multiplies the output size", () => {
    const single = exportBoardImageBytes(headless, document, { scale: 1 });
    const double = exportBoardImageBytes(headless, document, { scale: 2 });
    assert.ok(single && double);
    assert.equal(double.plan.width, single.plan.width * 2);
    assert.equal(double.plan.height, single.plan.height * 2);
  });

  test("a frame region exports exactly the frame", () => {
    const result = exportBoardImageBytes(headless, document, {
      region: { kind: "frame", id: "f1" },
      scale: 1,
    });
    assert.ok(result);
    assert.equal(result.plan.width, 600);
    assert.equal(result.plan.height, 400);
  });

  test("an empty region yields null rather than a blank image", () => {
    const result = exportBoardImageBytes(headless, { ...document, items: [] }, {});
    assert.equal(result, null);
  });

  test("jpeg output is encoded as jpeg", () => {
    const result = exportBoardImageBytes(headless, document, { scale: 1, format: "jpeg" });
    assert.ok(result);
    assert.equal(result.format, "jpeg");
    // JPEG SOI marker.
    assert.deepEqual([...result.bytes.slice(0, 2)], [0xff, 0xd8]);
  });

  test("light and dark modes produce different pixels", () => {
    const dark = exportBoardImageBytes(headless, document, { scale: 1, colorScheme: "dark" });
    const light = exportBoardImageBytes(headless, document, { scale: 1, colorScheme: "light" });
    assert.ok(dark && light);
    assert.notDeepEqual([...dark.bytes], [...light.bytes]);
  });

  test("an unnormalised document is parsed rather than crashing a renderer", () => {
    // `geo` items read `text`; a document built by hand may omit schema defaults.
    const raw = {
      ...document,
      items: [{ id: "g", type: "geo", geo: "rectangle", frame: frame(0, 0, 100, 100) }],
    } as unknown as BoardDocument;
    const result = exportBoardImageBytes(headless, raw, { scale: 1 });
    assert.ok(result, "expected the export to survive a sparse document");
  });

  test("missing images are reported as a warning, not a failure", () => {
    const withImage = {
      ...document,
      items: [
        ...items,
        {
          id: "i1",
          type: "image",
          ref: { kind: "space-file", path: "absent.png" },
          frame: frame(400, 230, 120, 90),
        } as BoardItem,
      ],
    } as BoardDocument;
    const result = exportBoardImageBytes(headless, withImage, { scale: 1 });
    assert.ok(result);
    const missing = result.warnings.find((warning) => warning.kind === "images-missing");
    assert.ok(missing, "expected a missing-image warning");
  });
});
