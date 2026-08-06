import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { LabelListItem } from "@neta-art/cohub";
import {
	findSessionUserLabel,
	getDisplayLabels,
	getSessionUserLabelSystemKey,
	isSystemLabel,
	SESSION_USER_ROOT_LABEL_SYSTEM_KEY,
} from "../lib/stores/sidebar-source-labels";

function makeLabel(
	partial: Partial<LabelListItem> &
		Pick<LabelListItem, "id" | "name" | "systemKey">,
): LabelListItem {
	return {
		id: partial.id,
		scopeType: partial.scopeType ?? "space",
		scopeId: partial.scopeId ?? "space-1",
		name: partial.name,
		slug: partial.slug ?? partial.name.toLowerCase(),
		parentId: partial.parentId ?? null,
		depth: partial.depth ?? 0,
		rank: partial.rank ?? 0,
		source: partial.source ?? "system",
		systemKey: partial.systemKey,
		createdBy: partial.createdBy ?? null,
		createdAt: partial.createdAt ?? "2026-01-01T00:00:00.000Z",
		updatedAt: partial.updatedAt ?? "2026-01-01T00:00:00.000Z",
		children: partial.children ?? [],
	};
}

describe("findSessionUserLabel", () => {
	const mine = makeLabel({
		id: "user-me",
		name: "me-uuid",
		parentId: "user-root",
		depth: 1,
		systemKey: getSessionUserLabelSystemKey("me-uuid"),
	});
	const other = makeLabel({
		id: "user-other",
		name: "other-uuid",
		parentId: "user-root",
		depth: 1,
		systemKey: getSessionUserLabelSystemKey("other-uuid"),
	});
	const root = makeLabel({
		id: "user-root",
		name: "User",
		systemKey: SESSION_USER_ROOT_LABEL_SYSTEM_KEY,
		children: [mine, other],
	});

	test("returns the current user child under User root", () => {
		assert.equal(findSessionUserLabel([root], "me-uuid")?.id, "user-me");
	});

	test("returns null for missing user, blank uuid, or empty tree", () => {
		assert.equal(findSessionUserLabel([root], "missing-uuid"), null);
		assert.equal(findSessionUserLabel([root], "  "), null);
		assert.equal(findSessionUserLabel([root], null), null);
		assert.equal(findSessionUserLabel([], "me-uuid"), null);
	});

	test("ignores non-system children with the same systemKey shape", () => {
		const custom = makeLabel({
			id: "custom",
			name: "Custom",
			parentId: "user-root",
			depth: 1,
			source: "user",
			systemKey: getSessionUserLabelSystemKey("me-uuid"),
		});
		const onlyCustom = makeLabel({
			...root,
			children: [custom],
		});
		assert.equal(findSessionUserLabel([onlyCustom], "me-uuid"), null);
	});
});

describe("sidebar label visibility", () => {
	test("keeps user and migrated legacy labels visible", () => {
		const nullKey = makeLabel({
			id: "null-key",
			name: "Bug",
			source: "user",
			systemKey: null,
		});
		const blankKey = makeLabel({
			id: "blank-key",
			name: "Frontend",
			source: "user",
			systemKey: "  ",
		});
		const legacyChild = makeLabel({
			id: "legacy-child",
			name: "P0",
			parentId: "legacy-root",
			depth: 1,
			source: "user",
			systemKey: null,
		});
		const legacyRoot = makeLabel({
			id: "legacy-root",
			name: "TODO",
			source: "user",
			systemKey: "legacy:pinned",
			children: [legacyChild],
		});

		assert.deepEqual(
			getDisplayLabels([nullKey, blankKey, legacyRoot]).map(
				(label) => label.id,
			),
			["null-key", "blank-key", "legacy-root"],
		);
		assert.equal(isSystemLabel(legacyRoot, [legacyRoot]), false);
		assert.equal(isSystemLabel(legacyChild, [legacyRoot]), false);
	});

	test("protects labels with a real system key and descendants of system roots", () => {
		const child = makeLabel({
			id: "system-child",
			name: "Web App",
			parentId: "system-root",
			depth: 1,
			source: "user",
			systemKey: null,
		});
		const root = makeLabel({
			id: "system-root",
			name: "Source",
			source: "user",
			systemKey: "session-source:root",
			children: [child],
		});

		assert.equal(isSystemLabel(root, [root]), true);
		assert.equal(isSystemLabel(child, [root]), true);
		assert.deepEqual(getDisplayLabels([root]), []);
	});
});
