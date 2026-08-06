import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
	__resetCacheDbStateForTests,
	idbGet,
	openCacheDb,
} from "../lib/cache/db.ts";

type OpenRequest = {
	result: IDBDatabase | null;
	error: DOMException | null;
	onsuccess: ((event: Event) => void) | null;
	onerror: ((event: Event) => void) | null;
	onblocked: ((event: Event) => void) | null;
	onupgradeneeded: ((event: Event) => void) | null;
};

type PendingOpen = {
	request: OpenRequest;
	version: number;
	resolve: (db: FakeDb) => void;
	reject: (error: DOMException) => void;
};

class FakeDb {
	objectStoreNames = { contains: () => true };
	onversionchange: ((event: Event) => void) | null = null;
	closed = false;
	close() {
		this.closed = true;
	}
	transaction() {
		throw new Error("unexpected transaction in open tests");
	}
	createObjectStore() {
		return { createIndex() {} };
	}
}

const pendingOpens: PendingOpen[] = [];
const originalIndexedDb = globalThis.indexedDB;
const originalWarn = console.warn;

function installHangingIndexedDb() {
	const fakeIndexedDb = {
		open(_name: string, version?: number) {
			const request: OpenRequest = {
				result: null,
				error: null,
				onsuccess: null,
				onerror: null,
				onblocked: null,
				onupgradeneeded: null,
			};
			let resolve!: (db: FakeDb) => void;
			let reject!: (error: DOMException) => void;
			new Promise<FakeDb>((res, rej) => {
				resolve = res;
				reject = rej;
			}).then(
				(db) => {
					request.result = db as unknown as IDBDatabase;
					request.onsuccess?.(new Event("success"));
				},
				(error: DOMException) => {
					request.error = error;
					request.onerror?.(new Event("error"));
				},
			);
			pendingOpens.push({
				request,
				version: version ?? 1,
				resolve,
				reject,
			});
			return request as unknown as IDBOpenDBRequest;
		},
		deleteDatabase() {
			const request: OpenRequest = {
				result: null,
				error: null,
				onsuccess: null,
				onerror: null,
				onblocked: null,
				onupgradeneeded: null,
			};
			queueMicrotask(() => request.onsuccess?.(new Event("success")));
			return request as unknown as IDBOpenDBRequest;
		},
	};
	Object.defineProperty(globalThis, "indexedDB", {
		configurable: true,
		writable: true,
		value: fakeIndexedDb,
	});
}

function completeNextOpen(db = new FakeDb()) {
	const pending = pendingOpens.shift();
	assert.ok(pending, "expected a pending indexedDB.open");
	pending.resolve(db);
	return db;
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(() => {
	pendingOpens.length = 0;
	__resetCacheDbStateForTests();
	Object.defineProperty(globalThis, "indexedDB", {
		configurable: true,
		writable: true,
		value: originalIndexedDb,
	});
	console.warn = originalWarn;
});

test("openCacheDb fail-fasts after timeout instead of re-waiting every caller", async () => {
	installHangingIndexedDb();
	__resetCacheDbStateForTests({
		openTimeoutMs: 40,
		openDegradedMs: 500,
		openLogThrottleMs: 60_000,
	});

	const warnings: unknown[][] = [];
	console.warn = (...args: unknown[]) => {
		warnings.push(args);
	};

	const first = await openCacheDb();
	assert.equal(first, null);
	assert.equal(pendingOpens.length, 1);
	assert.equal(warnings.length, 1);

	const burstStarted = Date.now();
	const burst = await Promise.all(
		Array.from({ length: 40 }, () => openCacheDb()),
	);
	const burstElapsed = Date.now() - burstStarted;
	assert.ok(
		burst.every((db) => db === null),
		"degraded open should return null without waiting",
	);
	// Before the fix each caller waited the full open budget (~40ms * 40).
	assert.ok(
		burstElapsed < 80,
		`expected fail-fast burst, took ${burstElapsed}ms`,
	);
	assert.equal(warnings.length, 1, "timeout warn should be throttled");
	assert.equal(pendingOpens.length, 1, "should not start parallel opens");
});

test("openCacheDb restores persistence when a timed-out open later succeeds", async () => {
	installHangingIndexedDb();
	__resetCacheDbStateForTests({
		openTimeoutMs: 40,
		openDegradedMs: 500,
		openLogThrottleMs: 60_000,
	});

	const timedOut = await openCacheDb();
	assert.equal(timedOut, null);

	const db = completeNextOpen();
	// Allow the late-success watcher microtask to run.
	await sleep(0);
	await sleep(0);

	const recovered = await openCacheDb();
	assert.equal(recovered, db as unknown as IDBDatabase);
	assert.equal(pendingOpens.length, 0);
});

test("idbGet returns null quickly while open is degraded", async () => {
	installHangingIndexedDb();
	__resetCacheDbStateForTests({
		openTimeoutMs: 40,
		openDegradedMs: 500,
		opTimeoutMs: 40,
		openLogThrottleMs: 60_000,
	});

	assert.equal(await openCacheDb(), null);

	const started = Date.now();
	const result = await idbGet("session_details", "k");
	const elapsed = Date.now() - started;
	assert.equal(result, null);
	assert.ok(
		elapsed < 50,
		`idbGet should fail-fast while degraded, took ${elapsed}ms`,
	);
});
