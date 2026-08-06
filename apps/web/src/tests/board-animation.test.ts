import assert from "node:assert/strict";
import { test } from "node:test";
import type {
	BoardClip,
	BoardEffect,
	BoardPlaybackSnapshot,
	BoardSequence,
} from "@neta-art/cohub";
import { Container } from "pixi.js";
import {
	clipSampleAt,
	composePose,
	createPose,
	hashUnit,
	playbackPosition,
	playbackSampleAt,
	sampleKeyframePose,
	samplePathPose,
	sequencePosition,
} from "$lib/board/runtime/animation-core";
import { createBoardAnimationRuntime } from "$lib/board/runtime/pixi-animation";

function makeClip(overrides: Partial<BoardClip> = {}): BoardClip {
	return {
		id: "clip",
		sequenceId: "sequence",
		kind: "motion.keyframes",
		kindVersion: 1,
		target: { type: "node", nodeId: "node" },
		start: 100,
		duration: 400,
		layer: "content",
		fill: "none",
		easing: "linear",
		params: {},
		keyframes: [],
		assetRefs: [],
		seed: "seed",
		metadata: {},
		...overrides,
	};
}

test("clip fill samples only the requested playback boundaries", () => {
	assert.equal(clipSampleAt(makeClip(), 50), null);
	assert.equal(clipSampleAt(makeClip(), 550), null);
	assert.deepEqual(clipSampleAt(makeClip({ fill: "both" }), 50), {
		localTime: 0,
		progress: 0,
		boundary: "before",
	});
	assert.deepEqual(clipSampleAt(makeClip({ fill: "forwards" }), 550), {
		localTime: 400,
		progress: 1,
		boundary: "after",
	});
});

test("keyframe and path sampling are absolute-time deterministic", () => {
	const keyframes = makeClip({
		keyframes: [
			{ at: 0, value: { x: 0, scale: 1 } },
			{ at: 400, value: { x: 80, scale: 2 } },
		],
	});
	assert.deepEqual(sampleKeyframePose(keyframes, 200), { x: 40, scale: 1.5 });
	assert.deepEqual(
		sampleKeyframePose(
			makeClip({
				keyframes: [
					{ at: 0, value: { x: 0 } },
					{ at: 0.5, value: { x: 10 } },
				],
			}),
			0.25,
		),
		{ x: 5 },
	);

	const path = makeClip({
		kind: "motion.path",
		params: {
			points: [
				{ x: 0, y: 0 },
				{ x: 30, y: 0 },
				{ x: 30, y: 70 },
			],
		},
	});
	assert.deepEqual(samplePathPose(path, 200), { x: 30, y: 20 });
});

test("pose channels compose instead of overwriting one another", () => {
	const pose = createPose();
	composePose(pose, { x: 10, scale: 1.2, alpha: 0.5 });
	composePose(pose, { y: 5, scaleX: 2, rotation: 0.25 });
	assert.deepEqual(pose, {
		x: 10,
		y: 5,
		scaleX: 2.4,
		scaleY: 1.2,
		rotation: 0.25,
		alpha: 0.5,
	});
});

test("playback and seeded random values can be reconstructed after reconnect", () => {
	const playback: BoardPlaybackSnapshot = {
		boardId: "11111111-1111-4111-8111-111111111111",
		playbackId: "22222222-2222-4222-8222-222222222222",
		sequenceId: "sequence",
		sequenceRevision: 3,
		playbackRevision: 7,
		status: "playing",
		position: 250,
		effectiveAt: 1_000,
		timeScale: 1.5,
		seed: "battle",
	};
	assert.equal(playbackPosition(playback, 1_200), 550);
	assert.equal(
		hashUnit("battle:clip:4:angle"),
		hashUnit("battle:clip:4:angle"),
	);
	assert.notEqual(
		hashUnit("battle:clip:4:angle"),
		hashUnit("battle:clip:5:angle"),
	);
});

test("loop playback wraps without ending and honors its initial delay", () => {
	const playback: BoardPlaybackSnapshot = {
		boardId: "11111111-1111-4111-8111-111111111111",
		playbackId: "22222222-2222-4222-8222-222222222222",
		sequenceId: "sequence",
		sequenceRevision: 1,
		playbackRevision: 1,
		status: "playing",
		position: 250,
		effectiveAt: 1_500,
		timeScale: 1,
		seed: "loop",
	};
	assert.deepEqual(playbackSampleAt(playback, 1_000, 1_000, true), {
		position: 250,
		ended: false,
		waiting: true,
	});
	assert.deepEqual(playbackSampleAt(playback, 1_000, 3_500, true), {
		position: 250,
		ended: false,
		waiting: false,
	});
	assert.equal(sequencePosition(-100, 1_000, true), 900);
	assert.equal(sequencePosition(1_250, 1_000, false), 1_000);
});

test("persistent effects resume after their target is materialized", () => {
	const descriptors = new Map(
		["window", "document", "requestAnimationFrame", "cancelAnimationFrame"].map(
			(key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
		),
	);
	const originalDateNow = Date.now;
	const callbacks = new Map<number, FrameRequestCallback>();
	let nextFrameId = 1;
	let now = 0;
	let node: { item: never; container: Container } | null = null;
	const world = new Container();
	const layers = {
		behind: new Container(),
		front: new Container(),
		screen: new Container(),
	};
	const effect: BoardEffect = {
		id: "float",
		boardId: "11111111-1111-4111-8111-111111111111",
		target: { type: "node", nodeId: "node" },
		kind: "effects.float",
		kindVersion: 1,
		enabled: true,
		lifecycle: "persistent",
		timeOrigin: "board",
		layer: "front",
		seed: "float",
		params: { period: 1_000, distance: 10 },
		assetRefs: [],
		metadata: {},
		revision: 0,
	};
	const pulseEffect: BoardEffect = {
		...effect,
		id: "pulse",
		kind: "effects.pulse",
		seed: "pulse",
		params: { period: 1_000, amount: 0.5 },
	};
	const motionQuery = {
		matches: false,
		addEventListener() {},
		removeEventListener() {},
	};
	const documentStub = {
		hidden: false,
		addEventListener() {},
		removeEventListener() {},
	};

	Object.defineProperties(globalThis, {
		window: {
			configurable: true,
			value: { matchMedia: () => motionQuery },
		},
		document: { configurable: true, value: documentStub },
		requestAnimationFrame: {
			configurable: true,
			value: (callback: FrameRequestCallback) => {
				const id = nextFrameId++;
				callbacks.set(id, callback);
				return id;
			},
		},
		cancelAnimationFrame: {
			configurable: true,
			value: (id: number) => callbacks.delete(id),
		},
	});
	Date.now = () => now;

	const runFrame = () => {
		const entry = callbacks.entries().next().value;
		assert.ok(entry);
		const [id, callback] = entry;
		callbacks.delete(id);
		callback(now);
	};

	const runtime = createBoardAnimationRuntime({
		getNode: () => node,
		getWorld: () => world,
		getLayers: () => layers,
		getScreen: () => ({ width: 800, height: 600 }),
		getAccentColor: () => 0xff3e00,
		render() {},
	});

	try {
		runtime.setData({
			effects: [effect, pulseEffect],
			sequences: [],
			clips: [],
			playback: null,
			playbackPolicy: null,
		});
		runFrame();
		assert.equal(callbacks.size, 0);

		node = { item: {} as never, container: new Container() };
		runtime.invalidatePoses();
		assert.equal(callbacks.size, 1);

		now = 250;
		runFrame();
		assert.equal(node.container.y, 10);
		assert.equal(node.container.scale.x, 1.5);
		assert.equal(callbacks.size, 1);

		for (let sync = 0; sync < 5; sync += 1) {
			runtime.prepareSceneSync();
			assert.equal(node.container.y, 0);
			assert.equal(node.container.scale.x, 1);
			runtime.invalidatePoses();
			runFrame();
			assert.equal(node.container.y, 10);
			assert.equal(node.container.scale.x, 1.5);
		}

		const sequence: BoardSequence = {
			id: "sequence",
			boardId: "11111111-1111-4111-8111-111111111111",
			name: "Autoplay",
			duration: 1_000,
			seed: "autoplay",
			restPose: {},
			metadata: {},
			revision: 0,
		};
		runtime.setActive(false);
		runtime.setData({
			effects: [],
			sequences: [sequence],
			clips: [
				makeClip({
					start: 0,
					duration: 1_000,
					keyframes: [
						{ at: 0, value: { x: 40 } },
						{ at: 1_000, value: { x: 100 } },
					],
				}),
			],
			playback: null,
			playbackPolicy: {
				sequenceId: sequence.id,
				delayMs: 500,
				loop: true,
			},
		});
		assert.equal(callbacks.size, 0);
		runtime.setActive(true);
		assert.equal(callbacks.size, 1);
		now = 250;
		runFrame();
		assert.equal(node.container.x, 0);
		assert.equal(callbacks.size, 0);
		now = 750;
		runtime.invalidatePoses();
		runFrame();
		assert.equal(node.container.x, 40);
		assert.equal(callbacks.size, 1);

		runtime.setActive(false);
		assert.equal(callbacks.size, 0);
		runtime.invalidatePoses();
		assert.equal(callbacks.size, 0);
		runtime.setActive(true);
		assert.equal(callbacks.size, 1);
	} finally {
		runtime.destroy();
		Date.now = originalDateNow;
		for (const [key, descriptor] of descriptors) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
	}
});

const stubEnvKeys = [
	"window",
	"document",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"setTimeout",
	"clearTimeout",
] as const;

function stubAnimationEnv() {
	const descriptors = new Map(
		stubEnvKeys.map(
			(key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
		),
	);
	const originalDateNow = Date.now;
	const rafCallbacks = new Map<number, FrameRequestCallback>();
	const timers = new Map<number, () => void>();
	let nextFrameId = 1;
	let nextTimerId = 1;
	let now = 0;

	Object.defineProperties(globalThis, {
		window: {
			configurable: true,
			value: {
				matchMedia: () => ({
					matches: false,
					addEventListener() {},
					removeEventListener() {},
				}),
			},
		},
		document: {
			configurable: true,
			value: { hidden: false, addEventListener() {}, removeEventListener() {} },
		},
		requestAnimationFrame: {
			configurable: true,
			value: (callback: FrameRequestCallback) => {
				const id = nextFrameId++;
				rafCallbacks.set(id, callback);
				return id;
			},
		},
		cancelAnimationFrame: {
			configurable: true,
			value: (id: number) => rafCallbacks.delete(id),
		},
		setTimeout: {
			configurable: true,
			value: (callback: () => void) => {
				const id = nextTimerId++;
				timers.set(id, callback);
				return id;
			},
		},
		clearTimeout: {
			configurable: true,
			value: (id: number) => timers.delete(id),
		},
	});
	Date.now = () => now;

	const runFrame = () => {
		const entry = rafCallbacks.entries().next().value;
		assert.ok(entry, "expected a pending rAF callback");
		rafCallbacks.delete(entry[0]);
		entry[1](now);
	};

	const runTimer = () => {
		const entry = timers.entries().next().value;
		assert.ok(entry, "expected a pending timer");
		timers.delete(entry[0]);
		entry[1]();
	};

	const restore = () => {
		Date.now = originalDateNow;
		for (const [key, descriptor] of descriptors) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
	};

	return {
		now: (value: number) => {
			now = value;
		},
		runFrame,
		runTimer,
		rafCount: () => rafCallbacks.size,
		timerCount: () => timers.size,
		restore,
	};
}

test("shared playback clamps a future server timestamp once", () => {
	const env = stubAnimationEnv();
	const node = { item: {} as never, container: new Container() };
	const sequence: BoardSequence = {
		id: "seq",
		boardId: "11111111-1111-4111-8111-111111111111",
		name: "Battle",
		duration: 2_000,
		seed: "battle",
		restPose: {},
		metadata: {},
		revision: 3,
	};
	const playback: BoardPlaybackSnapshot = {
		boardId: sequence.boardId,
		playbackId: "22222222-2222-4222-8222-222222222222",
		sequenceId: sequence.id,
		sequenceRevision: 3,
		playbackRevision: 1,
		status: "playing",
		position: 0,
		effectiveAt: 5_000,
		timeScale: 1,
		seed: "shared",
	};

	const runtime = createBoardAnimationRuntime({
		getNode: () => node,
		getWorld: () => new Container(),
		getLayers: () => ({
			behind: new Container(),
			front: new Container(),
			screen: new Container(),
		}),
		getScreen: () => ({ width: 800, height: 600 }),
		getAccentColor: () => 0xff3e00,
		render() {},
	});

	const runtimeData = {
		effects: [],
		sequences: [sequence],
		clips: [
			makeClip({
				sequenceId: sequence.id,
				start: 0,
				duration: 2_000,
				keyframes: [
					{ at: 0, value: { x: 0 } },
					{ at: 2_000, value: { x: 200 } },
				],
			}),
		],
		playback,
		playbackPolicy: null,
	};

	try {
		env.now(1_000);
		runtime.setData(runtimeData);
		assert.equal(
			playback.effectiveAt,
			5_000,
			"server snapshot remains unchanged",
		);
		assert.equal(env.timerCount(), 0, "shared playback does not use a timer");

		env.now(1_200);
		env.runFrame();
		assert.equal(
			node.container.x,
			20,
			"playback starts from local receipt time",
		);

		// Unrelated Board updates must not move the local clock anchor.
		env.now(1_500);
		runtime.setData({ ...runtimeData });
		env.runFrame();
		assert.equal(node.container.x, 50);
		assert.equal(env.rafCount(), 1);
	} finally {
		runtime.destroy();
		env.restore();
	}
});

test("delayed autoplay restores its timer after reactivation", () => {
	const env = stubAnimationEnv();
	const node = { item: {} as never, container: new Container() };
	const sequence: BoardSequence = {
		id: "seq",
		boardId: "11111111-1111-4111-8111-111111111111",
		name: "Autoplay",
		duration: 2_000,
		seed: "autoplay",
		restPose: {},
		metadata: {},
		revision: 3,
	};
	const runtime = createBoardAnimationRuntime({
		getNode: () => node,
		getWorld: () => new Container(),
		getLayers: () => ({
			behind: new Container(),
			front: new Container(),
			screen: new Container(),
		}),
		getScreen: () => ({ width: 800, height: 600 }),
		getAccentColor: () => 0xff3e00,
		render() {},
	});

	try {
		env.now(100);
		runtime.setData({
			effects: [],
			sequences: [sequence],
			clips: [
				makeClip({
					sequenceId: sequence.id,
					start: 0,
					duration: 2_000,
					keyframes: [
						{ at: 0, value: { x: 0 } },
						{ at: 2_000, value: { x: 200 } },
					],
				}),
			],
			playback: null,
			playbackPolicy: {
				sequenceId: sequence.id,
				delayMs: 500,
				loop: true,
			},
		});
		assert.equal(env.timerCount(), 1);

		runtime.setActive(false);
		assert.equal(env.timerCount(), 0);
		env.now(200);
		runtime.setActive(true);
		assert.equal(env.timerCount(), 1);
		env.runFrame();
		assert.equal(env.rafCount(), 0);

		env.now(600);
		env.runTimer();
		env.now(700);
		env.runFrame();
		assert.equal(node.container.x, 10);
		assert.equal(env.rafCount(), 1);
	} finally {
		runtime.destroy();
		env.restore();
	}
});

test("shared playback with a past effectiveAt starts immediately", () => {
	const env = stubAnimationEnv();
	const node = { item: {} as never, container: new Container() };
	const sequence: BoardSequence = {
		id: "seq",
		boardId: "11111111-1111-4111-8111-111111111111",
		name: "Battle",
		duration: 2_000,
		seed: "battle",
		restPose: {},
		metadata: {},
		revision: 3,
	};
	const playback: BoardPlaybackSnapshot = {
		boardId: sequence.boardId,
		playbackId: "22222222-2222-4222-8222-222222222222",
		sequenceId: sequence.id,
		sequenceRevision: 3,
		playbackRevision: 1,
		status: "playing",
		position: 0,
		effectiveAt: 1_000,
		timeScale: 1,
		seed: "shared",
	};

	const runtime = createBoardAnimationRuntime({
		getNode: () => node,
		getWorld: () => new Container(),
		getLayers: () => ({
			behind: new Container(),
			front: new Container(),
			screen: new Container(),
		}),
		getScreen: () => ({ width: 800, height: 600 }),
		getAccentColor: () => 0xff3e00,
		render() {},
	});

	try {
		env.now(1_500); // past effectiveAt → not waiting
		runtime.setData({
			effects: [],
			sequences: [sequence],
			clips: [
				makeClip({
					sequenceId: sequence.id,
					start: 0,
					duration: 2_000,
					keyframes: [
						{ at: 0, value: { x: 0 } },
						{ at: 2_000, value: { x: 200 } },
					],
				}),
			],
			playback,
			playbackPolicy: null,
		});
		assert.equal(
			env.timerCount(),
			0,
			"no deferred timer when effectiveAt is past",
		);
		assert.equal(env.rafCount(), 1, "rAF loop starts immediately");

		env.runFrame();
		assert.ok(node.container.x > 0, "node moves immediately");
	} finally {
		runtime.destroy();
		env.restore();
	}
});
