import assert from "node:assert/strict";
import { test } from "node:test";
import {
	type LruEntry,
	selectLruEvictions,
} from "../lib/board/board-asset-lru.ts";

function entry(key: string, lastUsedAt: number, bytes = 1000): LruEntry {
	return { key, lastUsedAt, bytes };
}

test("returns nothing when the pool fits the budget", () => {
	const entries = [entry("a", 1), entry("b", 2)];
	assert.deepEqual(
		selectLruEvictions(entries, { maxCount: 10, maxBytes: 10_000 }),
		[],
	);
});

test("returns nothing for an empty pool", () => {
	assert.deepEqual(selectLruEvictions([], { maxCount: 1, maxBytes: 1 }), []);
});

test("evicts oldest first when over the count budget", () => {
	const entries = [entry("new", 30), entry("old", 10), entry("mid", 20)];
	const evict = selectLruEvictions(entries, {
		maxCount: 1,
		maxBytes: Number.POSITIVE_INFINITY,
	});
	assert.deepEqual(evict, ["old", "mid"]);
});

test("evicts oldest first when over the byte budget", () => {
	const entries = [entry("a", 1, 60), entry("b", 2, 60), entry("c", 3, 60)];
	// Budget 100 bytes: must drop to <=100, evicting oldest (a, then b).
	const evict = selectLruEvictions(entries, {
		maxCount: Number.POSITIVE_INFINITY,
		maxBytes: 100,
	});
	assert.deepEqual(evict, ["a", "b"]);
});

test("does not mutate the input array", () => {
	const entries = [entry("b", 2), entry("a", 1)];
	const snapshot = entries.map((e) => e.key);
	selectLruEvictions(entries, {
		maxCount: 1,
		maxBytes: Number.POSITIVE_INFINITY,
	});
	assert.deepEqual(
		entries.map((e) => e.key),
		snapshot,
	);
});
