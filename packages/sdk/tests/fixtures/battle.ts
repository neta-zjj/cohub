import type { BoardEffect, BoardNodeInput } from "@cohub/protocol";
import { clip, compileSequence, timeline } from "../../src/board/animation.js";

export function createBattleFixture(input: {
	leftImagePath: string;
	rightImagePath: string;
	seed?: string;
	autoplayDelay?: number;
}) {
	const seed = input.seed ?? "cohub-battle-v1";
	const nodes: BoardNodeInput[] = [
		{
			nodeId: "fighter-left",
			type: "image",
			parentId: null,
			orderKey: "00000001",
			x: -360,
			y: -140,
			width: 280,
			height: 280,
			rotation: 0,
			refKind: "space_file",
			refPath: input.leftImagePath,
			refUrl: null,
			view: {},
			style: {},
			data: {},
		},
		{
			nodeId: "fighter-right",
			type: "image",
			parentId: null,
			orderKey: "00000002",
			x: 80,
			y: -140,
			width: 280,
			height: 280,
			rotation: 0,
			refKind: "space_file",
			refPath: input.rightImagePath,
			refUrl: null,
			view: {},
			style: {},
			data: {},
		},
		{
			nodeId: "battle-title",
			type: "text",
			parentId: null,
			orderKey: "00000003",
			x: -170,
			y: 190,
			width: 340,
			height: 72,
			rotation: 0,
			refKind: null,
			refPath: null,
			refUrl: null,
			view: {},
			style: {},
			data: { text: "FINAL IMPACT", color: "brand", autoSize: false },
		},
	];
	const effects: Array<Omit<BoardEffect, "boardId" | "revision">> = [
		{
			id: "left-pulse",
			target: { type: "node", nodeId: "fighter-left" },
			kind: "effects.pulse",
			kindVersion: 1,
			enabled: true,
			lifecycle: "when-visible",
			timeOrigin: "visible",
			layer: "behind",
			seed: `${seed}:left-pulse`,
			params: { amount: 0.025, period: 1800 },
			assetRefs: [],
			metadata: {},
		},
		{
			id: "right-float",
			target: { type: "node", nodeId: "fighter-right" },
			kind: "effects.float",
			kindVersion: 1,
			enabled: true,
			lifecycle: "when-visible",
			timeOrigin: "visible",
			layer: "behind",
			seed: `${seed}:right-float`,
			params: { distance: 5, period: 2200 },
			assetRefs: [],
			metadata: {},
		},
	];
	const motion = (nodeId: string, x: number) =>
		clip({
			kind: "motion.keyframes",
			target: { type: "node", nodeId },
			duration: 900,
			easing: "ease-in-out",
			keyframes: [
				{ at: 0, value: { x: 0, scale: 1 } },
				{ at: 580, value: { x, scale: 1.08 }, easing: "ease-in" },
				{ at: 900, value: { x: 0, scale: 1 } },
			],
		});
	const compiled = compileSequence({
		id: "battle",
		name: "Battle",
		seed,
		restPose: { "battle-title": { alpha: 1 } },
		timeline: timeline.sequence(
			timeline.parallel(motion("fighter-left", 170), motion("fighter-right", -170)),
			timeline.parallel(
				clip({
					kind: "effects.impact",
					target: { type: "board" },
					duration: 520,
					layer: "front",
					params: { radius: 180 },
				}),
				clip({
					kind: "effects.particles",
					target: { type: "board" },
					duration: 900,
					layer: "front",
					params: {
						count: 420,
						bounds: { x: -240, y: -220, width: 480, height: 440 },
					},
				}),
				clip({
					kind: "effects.trail",
					target: { type: "node", nodeId: "fighter-left" },
					duration: 620,
					layer: "behind",
				}),
				clip({
					kind: "camera.shake",
					target: { type: "camera" },
					duration: 480,
					layer: "screen",
					params: { amount: 12, frequency: 32 },
				}),
			),
			timeline.stagger(
				90,
				clip({
					kind: "draw.handwrite",
					target: { type: "node", nodeId: "battle-title" },
					duration: 700,
				}),
				clip({
					kind: "text.reveal",
					target: { type: "node", nodeId: "battle-title" },
					duration: 500,
				}),
			),
		),
		metadata: { fixture: "battle-v1" },
	});
	return {
		metadata: {
			playback: {
				sequenceId: compiled.sequence.id,
				delayMs: input.autoplayDelay ?? 0,
				loop: true,
			},
		},
		nodes,
		effects,
		...compiled,
	};
}
