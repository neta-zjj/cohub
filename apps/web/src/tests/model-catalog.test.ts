import assert from "node:assert/strict";
import { test } from "node:test";
import { getRequestedThinkingLevel } from "../lib/model-catalog";

test("getRequestedThinkingLevel only reads explicit requests", () => {
	assert.equal(
		getRequestedThinkingLevel({
			requestedThinkingLevel: "high",
			effectiveThinkingLevel: "medium",
		}),
		"high",
	);
	assert.equal(
		getRequestedThinkingLevel({ effectiveThinkingLevel: "high" }),
		null,
	);
	assert.equal(getRequestedThinkingLevel(null), null);
});
