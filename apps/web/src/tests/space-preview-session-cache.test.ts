import assert from "node:assert/strict";
import { test } from "node:test";
import { createSpacePreviewSessionCache } from "../lib/space-preview-session-cache.ts";

test("reuses a valid preview session without loading", async () => {
	let now = 1_000;
	const cache = createSpacePreviewSessionCache(() => now);
	cache.remember("space-a", { token: "token-a", expiresIn: 600 });
	let loads = 0;
	const session = await cache.get("space-a", async () => {
		loads += 1;
		return { token: "unexpected", expiresIn: 600 };
	});
	assert.equal(session.token, "token-a");
	assert.equal(loads, 0);
	now += 541_000;
	assert.equal(cache.read("space-a"), null);
});

test("deduplicates concurrent preview session loads", async () => {
	const cache = createSpacePreviewSessionCache(() => 1_000);
	let resolveLoad!: (value: { token: string; expiresIn: number }) => void;
	let loads = 0;
	const load = () => {
		loads += 1;
		return new Promise<{ token: string; expiresIn: number }>((resolve) => {
			resolveLoad = resolve;
		});
	};
	const first = cache.get("space-a", load);
	const second = cache.get("space-a", load);
	assert.equal(loads, 1);
	resolveLoad({ token: "shared", expiresIn: 600 });
	assert.equal((await first).token, "shared");
	assert.equal((await second).token, "shared");
});

test("startup prime wins over the fallback POST", async () => {
	const cache = createSpacePreviewSessionCache(() => 1_000);
	let resolvePrime!: (
		value: { token: string; expiresIn: number } | null,
	) => void;
	cache.prime(
		"space-a",
		new Promise((resolve) => {
			resolvePrime = resolve;
		}),
	);
	let loads = 0;
	const pending = cache.get("space-a", async () => {
		loads += 1;
		return { token: "fallback", expiresIn: 600 };
	});
	resolvePrime({ token: "startup", expiresIn: 600 });
	assert.equal((await pending).token, "startup");
	assert.equal(loads, 0);
});
