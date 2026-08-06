import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	autoscrollStep,
	describePointerDragPayload,
	hasLeftRetractSurface,
	isPointerDragPointerType,
	isWithinActivateTolerance,
	POINTER_DRAG_ACTIVATE_MS,
	POINTER_DRAG_ACTIVATE_TOLERANCE_PX,
	POINTER_DRAG_AUTOSCROLL_MAX_PX,
	POINTER_DRAG_CLICK_SUPPRESS_MS,
	POINTER_DRAG_RETRACT_THRESHOLD_PX,
	type PointerDragPayload,
	type PointerDropZone,
	pickDropZone,
	toBoardDropItems,
} from "../lib/drag/pointer-drag-core";

function payload(
	items: PointerDragPayload["items"] = [
		{ type: "file", path: "src/a.png", name: "a.png" },
	],
): PointerDragPayload {
	return { origin: "space-file-tree", items };
}

describe("isPointerDragPointerType", () => {
	it("claims touch and pen only", () => {
		assert.equal(isPointerDragPointerType("touch"), true);
		assert.equal(isPointerDragPointerType("pen"), true);
		// Mouse keeps native HTML5 drag and drop.
		assert.equal(isPointerDragPointerType("mouse"), false);
		assert.equal(isPointerDragPointerType(""), false);
	});
});

describe("isWithinActivateTolerance", () => {
	it("allows a still finger", () => {
		assert.equal(isWithinActivateTolerance(0, 0), true);
		assert.equal(isWithinActivateTolerance(3, 4), true);
	});

	it("rejects movement past the slop, which means a scroll", () => {
		assert.equal(
			isWithinActivateTolerance(0, POINTER_DRAG_ACTIVATE_TOLERANCE_PX + 1),
			false,
		);
		assert.equal(isWithinActivateTolerance(20, 20), false);
	});
});

describe("autoscrollStep", () => {
	const rect = { top: 100, bottom: 500 };

	it("is idle in the middle", () => {
		assert.equal(autoscrollStep(300, rect), 0);
	});

	it("scrolls up near the top edge and down near the bottom", () => {
		assert.ok(autoscrollStep(105, rect) < 0);
		assert.ok(autoscrollStep(495, rect) > 0);
	});

	it("ramps to the max at the edge", () => {
		assert.equal(autoscrollStep(100, rect), -POINTER_DRAG_AUTOSCROLL_MAX_PX);
		assert.equal(autoscrollStep(500, rect), POINTER_DRAG_AUTOSCROLL_MAX_PX);
	});

	it("clamps past the edge instead of accelerating", () => {
		assert.equal(autoscrollStep(20, rect), -POINTER_DRAG_AUTOSCROLL_MAX_PX);
		assert.equal(autoscrollStep(900, rect), POINTER_DRAG_AUTOSCROLL_MAX_PX);
	});
});

describe("hasLeftRetractSurface", () => {
	const rect = { left: 200, right: 480 };

	it("stays put inside the surface", () => {
		assert.equal(hasLeftRetractSurface(300, rect), false);
		assert.equal(hasLeftRetractSurface(200, rect), false);
	});

	it("ignores travel inside the threshold band", () => {
		assert.equal(
			hasLeftRetractSurface(
				rect.left - POINTER_DRAG_RETRACT_THRESHOLD_PX,
				rect,
			),
			false,
		);
	});

	it("retracts once the pointer clears the threshold", () => {
		assert.equal(
			hasLeftRetractSurface(
				rect.left - POINTER_DRAG_RETRACT_THRESHOLD_PX - 1,
				rect,
			),
			true,
		);
		assert.equal(
			hasLeftRetractSurface(
				rect.right + POINTER_DRAG_RETRACT_THRESHOLD_PX + 1,
				rect,
			),
			true,
		);
	});
});

describe("describePointerDragPayload", () => {
	it("names a single item", () => {
		assert.equal(describePointerDragPayload(payload()), "a.png");
	});

	it("counts a multi-item drag", () => {
		assert.equal(
			describePointerDragPayload(
				payload([
					{ type: "file", path: "a", name: "a" },
					{ type: "file", path: "b", name: "b" },
				]),
			),
			"2 items",
		);
	});

	it("is empty for an empty payload", () => {
		assert.equal(describePointerDragPayload(payload([])), "");
	});
});

describe("toBoardDropItems", () => {
	it("maps files with their snapshot facts", () => {
		const items = toBoardDropItems(
			payload([
				{
					type: "file",
					path: "src/a.png",
					name: "a.png",
					mimeType: "image/png",
					size: 12,
					mtimeMs: 99,
				},
			]),
		);
		assert.deepEqual(items, [
			{
				path: "src/a.png",
				snapshot: {
					title: "a.png",
					mimeType: "image/png",
					size: 12,
					mtimeMs: 99,
				},
			},
		]);
	});

	it("skips directories, which have no single file to reference", () => {
		const items = toBoardDropItems(
			payload([
				{ type: "dir", path: "src", name: "src" },
				{ type: "file", path: "src/a.png", name: "a.png" },
			]),
		);
		assert.deepEqual(
			items.map((item) => item.path),
			["src/a.png"],
		);
	});

	it("yields nothing for a directory-only payload, so a zone can decline", () => {
		assert.deepEqual(
			toBoardDropItems(payload([{ type: "dir", path: "src", name: "src" }])),
			[],
		);
	});

	it("normalizes a trailing slash", () => {
		const [item] = toBoardDropItems(
			payload([{ type: "file", path: "src/a.png/", name: "a.png" }]),
		);
		assert.equal(item.path, "src/a.png");
	});

	it("drops empty paths", () => {
		assert.deepEqual(
			toBoardDropItems(payload([{ type: "file", path: "", name: "" }])),
			[],
		);
	});
});

describe("timing constants", () => {
	it("suppresses clicks past the synthetic one a touch release fires", () => {
		// The synthesised click lands right after pointerup, so the window only has
		// to clear that, while staying short enough that a deliberate follow-up tap
		// still registers.
		assert.ok(POINTER_DRAG_CLICK_SUPPRESS_MS >= 300);
		assert.ok(POINTER_DRAG_CLICK_SUPPRESS_MS <= POINTER_DRAG_ACTIVATE_MS * 2);
	});
});

describe("pickDropZone", () => {
	function zone(label: string | null, priority?: number): PointerDropZone {
		return {
			priority,
			resolve: () => (label ? { label, effect: "copy" } : null),
			drop: () => {},
		};
	}

	it("returns null when nothing claims the payload", () => {
		assert.equal(pickDropZone([], payload()), null);
		assert.equal(pickDropZone([{ zone: zone(null) }], payload()), null);
	});

	it("prefers the topmost candidate, as hit testing reports it", () => {
		const picked = pickDropZone(
			[{ zone: zone("inner") }, { zone: zone("outer") }],
			payload(),
		);
		assert.equal(picked?.intent.label, "inner");
	});

	it("falls through when the topmost zone declines", () => {
		const picked = pickDropZone(
			[{ zone: zone(null) }, { zone: zone("outer") }],
			payload(),
		);
		assert.equal(picked?.intent.label, "outer");
	});

	it("lets an explicit priority beat hit-test order", () => {
		const picked = pickDropZone(
			[{ zone: zone("inner", 1) }, { zone: zone("outer", 5) }],
			payload(),
		);
		assert.equal(picked?.intent.label, "outer");
	});
});
