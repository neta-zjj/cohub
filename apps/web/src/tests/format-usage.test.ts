import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Usage } from "@cohub/protocol/core";
import {
	formatTokenCount,
	formatUsageCost,
	formatUsageCostFromUsage,
	getDisplayInputTokens,
	getUsageCostTotal,
	getUsageTotalTokens,
	sumUsages,
} from "../lib/format-usage";

describe("format-usage", () => {
	test("formatTokenCount matches chat bubble compact style", () => {
		assert.equal(formatTokenCount(999), "999");
		assert.equal(formatTokenCount(1_200), "1.2k");
		assert.equal(formatTokenCount(1_500_000), "1.5M");
	});

	test("formatUsageCost precision tiers", () => {
		assert.equal(formatUsageCost(0), "");
		assert.equal(formatUsageCost(-1), "");
		assert.equal(formatUsageCost(0.0004), "$0.0004");
		assert.equal(formatUsageCost(0.0123), "$0.012");
		assert.equal(formatUsageCost(1.234), "$1.23");
	});

	test("getUsageCostTotal ignores non-positive totals", () => {
		assert.equal(getUsageCostTotal(null), null);
		assert.equal(getUsageCostTotal({ cost: { total: 0 } }), null);
		assert.equal(getUsageCostTotal({ cost: { total: 0.05 } }), 0.05);
		assert.equal(formatUsageCostFromUsage({ cost: { total: 0.05 } }), "$0.050");
	});

	test("display input tokens include cache read", () => {
		assert.equal(getDisplayInputTokens({ input: 100, cacheRead: 20 }), 120);
		assert.equal(getUsageTotalTokens({ input: 100, output: 30 }), 130);
		assert.equal(getUsageTotalTokens({ totalTokens: 999 }), 999);
	});

	test("sumUsages aggregates tokens and cost without inventing zeros", () => {
		const a: Usage = {
			input: 10,
			output: 2,
			cost: { total: 0.01, input: 0.008, output: 0.002 },
		};
		const b: Usage = {
			input: 5,
			cacheRead: 3,
			output: 1,
			cost: { total: 0.004, input: 0.003, output: 0.001 },
		};
		assert.deepEqual(sumUsages([a, null, b]), {
			input: 15,
			output: 3,
			cacheRead: 3,
			cacheWrite: undefined,
			totalTokens: undefined,
			cost: {
				input: 0.011,
				output: 0.003,
				cacheRead: undefined,
				cacheWrite: undefined,
				total: 0.014,
			},
		});
		assert.equal(sumUsages([null, undefined]), null);
	});
});
