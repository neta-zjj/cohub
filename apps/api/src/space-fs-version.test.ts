import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesSpaceFsVersion } from "./space-fs-version.js";

test("matches file versions only when size and mtime are unchanged", () => {
	const expected = { size: 12, mtimeMs: 1_700_000_000_000 };
	assert.equal(matchesSpaceFsVersion(expected, expected), true);
	assert.equal(
		matchesSpaceFsVersion({ ...expected, size: 13 }, expected),
		false,
	);
	assert.equal(
		matchesSpaceFsVersion({ ...expected, mtimeMs: expected.mtimeMs + 1 }, expected),
		false,
	);
	assert.equal(matchesSpaceFsVersion({ size: 12 }, expected), false);
});
