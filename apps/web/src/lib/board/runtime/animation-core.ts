import type {
	BoardClip,
	BoardPlaybackSnapshot,
	BoardSequence,
} from "@neta-art/cohub";

export type AnimationPoseValue = Partial<{
	x: number;
	y: number;
	scale: number;
	scaleX: number;
	scaleY: number;
	rotation: number;
	alpha: number;
}>;

export type AnimationPose = {
	x: number;
	y: number;
	scaleX: number;
	scaleY: number;
	rotation: number;
	alpha: number;
};

export type ClipSample = {
	localTime: number;
	progress: number;
	boundary: "before" | "active" | "after";
};

const finite = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

export function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

export function ease(name: string, value: number): number {
	const t = clamp01(value);
	switch (name) {
		case "ease-in":
		case "easeIn":
		case "ease-in-quad":
			return t * t;
		case "ease-out":
		case "easeOut":
		case "ease-out-quad":
			return 1 - (1 - t) * (1 - t);
		case "ease-in-out":
		case "easeInOut":
		case "ease-in-out-quad":
			return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
		case "ease-out-cubic":
			return 1 - (1 - t) ** 3;
		case "ease-out-quart":
			return 1 - (1 - t) ** 4;
		case "ease-out-expo":
			return t === 1 ? 1 : 1 - 2 ** (-10 * t);
		default:
			return t;
	}
}

export function clipSampleAt(
	clip: BoardClip,
	position: number,
): ClipSample | null {
	if (position < clip.start) {
		if (clip.fill !== "backwards" && clip.fill !== "both") return null;
		return { localTime: 0, progress: 0, boundary: "before" };
	}
	const end = clip.start + clip.duration;
	if (position > end) {
		if (clip.fill !== "forwards" && clip.fill !== "both") return null;
		return { localTime: clip.duration, progress: 1, boundary: "after" };
	}
	const localTime = Math.max(0, Math.min(clip.duration, position - clip.start));
	return {
		localTime,
		progress: ease(clip.easing, localTime / clip.duration),
		boundary: "active",
	};
}

function poseRecord(value: unknown): AnimationPoseValue | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const pose: AnimationPoseValue = {};
	for (const key of [
		"x",
		"y",
		"scale",
		"scaleX",
		"scaleY",
		"rotation",
		"alpha",
	] as const) {
		if (finite(record[key])) pose[key] = record[key];
	}
	return Object.keys(pose).length > 0 ? pose : null;
}

function interpolatePose(
	from: AnimationPoseValue,
	to: AnimationPoseValue,
	progress: number,
): AnimationPoseValue {
	const result: AnimationPoseValue = {};
	for (const key of [
		"x",
		"y",
		"scale",
		"scaleX",
		"scaleY",
		"rotation",
		"alpha",
	] as const) {
		const left = from[key];
		const right = to[key];
		if (finite(left) && finite(right))
			result[key] = left + (right - left) * progress;
		else if (finite(right)) result[key] = right;
		else if (finite(left)) result[key] = left;
	}
	return result;
}

export function sampleKeyframePose(
	clip: BoardClip,
	localTime: number,
): AnimationPoseValue | null {
	if (clip.keyframes.length === 0) {
		const from = poseRecord(clip.params.from) ?? {};
		const to = poseRecord(clip.params.to);
		if (!to) return poseRecord(clip.params);
		return interpolatePose(
			from,
			to,
			ease(clip.easing, localTime / clip.duration),
		);
	}
	const frames = clip.keyframes;
	const before =
		[...frames].reverse().find((frame) => frame.at <= localTime) ?? frames[0];
	const after = frames.find((frame) => frame.at >= localTime) ?? frames.at(-1);
	if (!before || !after) return null;
	const from = poseRecord(before.value);
	const to = poseRecord(after.value);
	if (!from || !to || before === after) return to ?? from;
	const progress = ease(
		after.easing ?? clip.easing,
		(localTime - before.at) / Math.max(Number.EPSILON, after.at - before.at),
	);
	return interpolatePose(from, to, progress);
}

type PathPoint = { x: number; y: number };

function pathPoints(value: unknown): PathPoint[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((point) => {
		if (!point || typeof point !== "object" || Array.isArray(point)) return [];
		const { x, y } = point as Record<string, unknown>;
		return finite(x) && finite(y) ? [{ x, y }] : [];
	});
}

export function samplePathPose(
	clip: BoardClip,
	localTime: number,
): AnimationPoseValue | null {
	const points = pathPoints(clip.params.points);
	if (points.length < 2) return null;
	const lengths = [0];
	for (let index = 1; index < points.length; index += 1) {
		lengths.push(
			lengths[index - 1] +
				Math.hypot(
					points[index].x - points[index - 1].x,
					points[index].y - points[index - 1].y,
				),
		);
	}
	const total = lengths.at(-1) ?? 0;
	if (total <= 0) return { x: points[0].x, y: points[0].y };
	const distance = ease(clip.easing, localTime / clip.duration) * total;
	let index = 1;
	while (index < lengths.length - 1 && lengths[index] < distance) index += 1;
	const previous = points[index - 1];
	const next = points[index];
	const span = Math.max(1e-6, lengths[index] - lengths[index - 1]);
	const progress = clamp01((distance - lengths[index - 1]) / span);
	const pose: AnimationPoseValue = {
		x: previous.x + (next.x - previous.x) * progress,
		y: previous.y + (next.y - previous.y) * progress,
	};
	if (clip.params.orient === true)
		pose.rotation = Math.atan2(next.y - previous.y, next.x - previous.x);
	return pose;
}

export function createPose(): AnimationPose {
	return { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, alpha: 1 };
}

export function composePose(
	target: AnimationPose,
	value: AnimationPoseValue | null,
): void {
	if (!value) return;
	target.x += value.x ?? 0;
	target.y += value.y ?? 0;
	const scale = value.scale ?? 1;
	target.scaleX *= value.scaleX ?? scale;
	target.scaleY *= value.scaleY ?? scale;
	target.rotation += value.rotation ?? 0;
	target.alpha *= value.alpha ?? 1;
}

export function sequenceRestPoses(
	sequence: BoardSequence | null,
): Map<string, AnimationPoseValue> {
	const result = new Map<string, AnimationPoseValue>();
	if (!sequence) return result;
	for (const [nodeId, value] of Object.entries(sequence.restPose)) {
		const pose = poseRecord(value);
		if (pose) result.set(nodeId, pose);
	}
	return result;
}

export function playbackPosition(
	playback: BoardPlaybackSnapshot,
	now: number,
): number {
	if (playback.status !== "playing") return playback.position;
	return (
		playback.position +
		Math.max(0, now - playback.effectiveAt) * playback.timeScale
	);
}

export function sequencePosition(
	position: number,
	duration: number,
	loop: boolean,
): number {
	if (duration <= 0) return 0;
	if (!loop) return Math.min(duration, Math.max(0, position));
	const normalized = position % duration;
	return normalized < 0 ? normalized + duration : normalized;
}

export function playbackSampleAt(
	playback: BoardPlaybackSnapshot,
	duration: number,
	now: number,
	loop = false,
): { position: number; ended: boolean; waiting: boolean } {
	const waiting = playback.status === "playing" && now < playback.effectiveAt;
	const elapsed = playbackPosition(playback, now);
	return {
		position: sequencePosition(elapsed, duration, loop),
		ended: duration <= 0 || (!loop && elapsed >= duration),
		waiting,
	};
}

export function hashUnit(value: string): number {
	let result = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		result ^= value.charCodeAt(index);
		result = Math.imul(result, 16777619);
	}
	return (result >>> 0) / 0xffffffff;
}
