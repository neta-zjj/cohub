import assert from "node:assert/strict";
import { test } from "node:test";
import {
	type FilesChromeVisibility,
	filesChromeEffectivelyHidden,
	floatPanelsFit,
	nextTreeSnapshot,
	resolveFilesChromeToggle,
} from "../lib/features/space/modules/float-layout.ts";

test("float panels preserve a usable preview corridor", () => {
	assert.equal(floatPanelsFit(960, 260, 320), false);
	assert.equal(floatPanelsFit(1024, 260, 320), true);
	assert.equal(floatPanelsFit(1440, 520, 320), true);
});

test("only user tree toggles update the restore snapshot", () => {
	const snapshot = {
		leftSidebarCollapsed: true,
		rightSidebarCollapsed: false,
		filesColumnHidden: false,
		previewWidth: 480,
		treeVisible: true,
	};

	assert.equal(nextTreeSnapshot(snapshot, true, false), snapshot);
	assert.deepEqual(nextTreeSnapshot(snapshot, true, true), {
		...snapshot,
		rightSidebarCollapsed: true,
		treeVisible: false,
	});
});

test("Files chrome visibility handles desktop empty rails and mobile drawers", () => {
	const visible: FilesChromeVisibility = {
		isCompact: false,
		mobileDrawerOpen: false,
		filesColumnHidden: false,
		treeCollapsed: false,
		hasPreview: false,
	};

	assert.equal(filesChromeEffectivelyHidden(visible), false);
	assert.equal(
		filesChromeEffectivelyHidden({ ...visible, treeCollapsed: true }),
		true,
	);
	assert.equal(
		filesChromeEffectivelyHidden({
			...visible,
			treeCollapsed: true,
			hasPreview: true,
		}),
		false,
	);
	assert.equal(
		filesChromeEffectivelyHidden({
			...visible,
			isCompact: true,
			mobileDrawerOpen: false,
		}),
		true,
	);
});

test("Files chrome toggle resolves to one visible state transition", () => {
	const visible: FilesChromeVisibility = {
		isCompact: false,
		mobileDrawerOpen: false,
		filesColumnHidden: false,
		treeCollapsed: false,
		hasPreview: false,
	};

	assert.equal(resolveFilesChromeToggle(visible), "hide");
	assert.equal(
		resolveFilesChromeToggle({ ...visible, treeCollapsed: true }),
		"reveal",
	);
	assert.equal(
		resolveFilesChromeToggle({ ...visible, filesColumnHidden: true }),
		"reveal",
	);
	assert.equal(
		resolveFilesChromeToggle({ ...visible, isCompact: true }),
		"toggle-mobile",
	);
});
