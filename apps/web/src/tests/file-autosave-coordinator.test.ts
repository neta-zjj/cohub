import assert from "node:assert/strict";
import { test } from "node:test";
import { createFileAutosaveCoordinator } from "../lib/features/space/modules/file-autosave-coordinator.ts";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

test("coalesces bursty edits into one save", async () => {
	const paths: string[] = [];
	const coordinator = createFileAutosaveCoordinator({
		save: async (path) => {
			paths.push(path);
			return "saved";
		},
		debounceMs: 5,
		maxWaitMs: 50,
	});

	coordinator.schedule("notes.md");
	coordinator.schedule("notes.md");
	coordinator.schedule("notes.md");
	await wait(20);

	assert.deepEqual(paths, ["notes.md"]);
	coordinator.dispose();
});

test("serializes a trailing save requested while one is in flight", async () => {
	const first = deferred();
	let calls = 0;
	let inFlight = 0;
	let maxInFlight = 0;
	const coordinator = createFileAutosaveCoordinator({
		save: async () => {
			calls += 1;
			inFlight += 1;
			maxInFlight = Math.max(maxInFlight, inFlight);
			if (calls === 1) await first.promise;
			inFlight -= 1;
			return "saved";
		},
		debounceMs: 5,
		maxWaitMs: 50,
	});

	const saving = coordinator.flush("notes.md");
	await wait(0);
	coordinator.schedule("notes.md");
	first.resolve();
	await saving;
	await wait(0);

	assert.equal(calls, 2);
	assert.equal(maxInFlight, 1);
	coordinator.dispose();
});

test("a blocked save does not hot-loop queued work", async () => {
	const first = deferred();
	let calls = 0;
	const coordinator = createFileAutosaveCoordinator({
		save: async () => {
			calls += 1;
			await first.promise;
			return "blocked";
		},
		debounceMs: 5,
		maxWaitMs: 50,
	});

	const saving = coordinator.flush("notes.md");
	await wait(0);
	coordinator.schedule("notes.md");
	first.resolve();
	assert.equal(await saving, "blocked");
	await wait(10);

	assert.equal(calls, 1);
	coordinator.dispose();
});

test("cancel detaches an in-flight save from later work on the same path", async () => {
	const first = deferred();
	let calls = 0;
	const coordinator = createFileAutosaveCoordinator({
		save: async () => {
			calls += 1;
			if (calls === 1) await first.promise;
			return "saved";
		},
		debounceMs: 5,
		maxWaitMs: 50,
	});

	const oldSave = coordinator.flush("notes.md");
	await wait(0);
	coordinator.cancel("notes.md");
	coordinator.schedule("notes.md");
	await wait(10);

	assert.equal(calls, 2);
	first.resolve();
	await oldSave;
	coordinator.dispose();
});

test("cancel removes a scheduled save", async () => {
	let calls = 0;
	const coordinator = createFileAutosaveCoordinator({
		save: async () => {
			calls += 1;
			return "saved";
		},
		debounceMs: 5,
		maxWaitMs: 10,
	});

	coordinator.schedule("notes.md");
	coordinator.cancel("notes.md");
	await wait(20);

	assert.equal(calls, 0);
	coordinator.dispose();
});
