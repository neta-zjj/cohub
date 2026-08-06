import type {
	BoardClip,
	BoardEffect,
	BoardPlaybackSnapshot,
	BoardSequence,
} from "@neta-art/cohub";
import type { BoardItem } from "@neta-art/cohub/board";
import { sampleRadius } from "@neta-art/cohub/board";
import {
	ColorMatrixFilter,
	Container,
	type Filter,
	Graphics,
	Mesh,
	MeshGeometry,
	MeshRope,
	Particle,
	ParticleContainer,
	Point,
	Rectangle,
	Shader,
	Texture,
	UniformGroup,
} from "pixi.js";
import {
	type AnimationPose,
	clipSampleAt,
	composePose,
	createPose,
	hashUnit,
	playbackSampleAt,
	sampleKeyframePose,
	samplePathPose,
	sequencePosition,
	sequenceRestPoses,
} from "$lib/board/runtime/animation-core";
import type { BoardRuntimeData } from "$lib/board/runtime/board-runtime";

type BasePose = {
	x: number;
	y: number;
	scaleX: number;
	scaleY: number;
	rotation: number;
	alpha: number;
};

type RuntimeNode = {
	item: BoardItem;
	container: Container;
};

type RuntimeOptions = {
	getNode: (nodeId: string) => RuntimeNode | null;
	getWorld: () => Container | null;
	getLayers: () => {
		behind: Container;
		front: Container;
		screen: Container;
	} | null;
	getScreen: () => { width: number; height: number };
	getAccentColor: () => number;
	render: () => void;
};

type ParticleResource = {
	container: ParticleContainer;
	particles: Particle[];
	indexes: number[];
};

type TrailResource = {
	rope: MeshRope;
	points: Point[];
};

type RevealResource = {
	mesh: Mesh<MeshGeometry, Shader>;
	shader: Shader;
	geometry: MeshGeometry;
	original: Container;
	originalRenderable: boolean;
};

type FilterResource = {
	filter: ColorMatrixFilter;
};

type FilterRestore = {
	container: Container;
	filters: Filter[] | null;
	filterArea: Rectangle | undefined;
};

const finite = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

function poseOf(node: Container): BasePose {
	return {
		x: node.x,
		y: node.y,
		scaleX: node.scale.x,
		scaleY: node.scale.y,
		rotation: node.rotation,
		alpha: node.alpha,
	};
}

function restore(node: Container, pose: BasePose) {
	node.position.set(pose.x, pose.y);
	node.scale.set(pose.scaleX, pose.scaleY);
	node.rotation = pose.rotation;
	node.alpha = pose.alpha;
}

function applyPose(node: Container, base: BasePose, pose: AnimationPose) {
	node.position.set(base.x + pose.x, base.y + pose.y);
	node.scale.set(base.scaleX * pose.scaleX, base.scaleY * pose.scaleY);
	node.rotation = base.rotation + pose.rotation;
	node.alpha = Math.max(0, Math.min(1, base.alpha * pose.alpha));
}

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function boundsParam(value: unknown): Rectangle {
	const bounds = record(value);
	return new Rectangle(
		finite(bounds?.x) ? bounds.x : -256,
		finite(bounds?.y) ? bounds.y : -256,
		finite(bounds?.width) ? Math.max(1, bounds.width) : 512,
		finite(bounds?.height) ? Math.max(1, bounds.height) : 512,
	);
}

function layerForClip(
	clip: BoardClip,
	layers: NonNullable<ReturnType<RuntimeOptions["getLayers"]>>,
): Container {
	if (clip.layer === "screen") return layers.screen;
	if (clip.layer === "behind") return layers.behind;
	return layers.front;
}

const REVEAL_VERTEX_GL = `#version 300 es
in vec2 aPosition;
in vec2 aUV;
in float aProgress;
out float vProgress;
out vec4 vColor;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform mat3 uTransformMatrix;
uniform vec4 uColor;
void main(void) {
  mat3 matrix = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((matrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vProgress = aProgress;
  vColor = uColor * uWorldColorAlpha;
}`;

const REVEAL_FRAGMENT_GL = `#version 300 es
precision highp float;
in float vProgress;
in vec4 vColor;
out vec4 finalColor;
uniform float uProgress;
uniform float uSoftness;
void main(void) {
  float revealed = 1.0 - smoothstep(uProgress, uProgress + uSoftness, vProgress);
  finalColor = vec4(vColor.rgb, vColor.a * revealed);
}`;

const REVEAL_WGSL = `
struct GlobalUniforms {
  uProjectionMatrix: mat3x3<f32>,
  uWorldTransformMatrix: mat3x3<f32>,
  uWorldColorAlpha: vec4<f32>,
  uResolution: vec2<f32>,
}
@group(0) @binding(0) var<uniform> globalUniforms: GlobalUniforms;

struct LocalUniforms {
  uTransformMatrix: mat3x3<f32>,
  uColor: vec4<f32>,
  uRound: f32,
}
@group(1) @binding(0) var<uniform> localUniforms: LocalUniforms;

struct RevealUniforms {
  uProgress: f32,
  uSoftness: f32,
  padding0: f32,
  padding1: f32,
}
@group(2) @binding(0) var<uniform> revealUniforms: RevealUniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) progress: f32,
  @location(1) color: vec4<f32>,
}

@vertex
fn mainVertex(
  @location(0) aPosition: vec2<f32>,
  @location(1) aUV: vec2<f32>,
  @location(2) aProgress: f32,
) -> VertexOutput {
  var output: VertexOutput;
  let matrix = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
  output.position = vec4<f32>((matrix * vec3<f32>(aPosition, 1.0)).xy, 0.0, 1.0);
  output.progress = aProgress;
  output.color = localUniforms.uColor * globalUniforms.uWorldColorAlpha;
  return output;
}

@fragment
fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let revealed = 1.0 - smoothstep(revealUniforms.uProgress, revealUniforms.uProgress + revealUniforms.uSoftness, input.progress);
  return vec4<f32>(input.color.rgb, input.color.a * revealed);
}`;

function createRevealShader() {
	const revealUniforms = new UniformGroup({
		uProgress: { value: 0, type: "f32" },
		uSoftness: { value: 0.015, type: "f32" },
		padding0: { value: 0, type: "f32" },
		padding1: { value: 0, type: "f32" },
	});
	return Shader.from({
		gl: { vertex: REVEAL_VERTEX_GL, fragment: REVEAL_FRAGMENT_GL },
		gpu: {
			vertex: { source: REVEAL_WGSL, entryPoint: "mainVertex" },
			fragment: { source: REVEAL_WGSL, entryPoint: "mainFragment" },
		},
		resources: { revealUniforms },
	});
}

function drawRevealGeometry(item: Extract<BoardItem, { type: "draw" }>) {
	const count = item.points.length;
	if (count < 2) return null;
	const positions = new Float32Array(count * 4);
	const uvs = new Float32Array(count * 4);
	const progress = new Float32Array(count * 2);
	const lengths = new Float32Array(count);
	for (let index = 1; index < count; index += 1) {
		lengths[index] =
			lengths[index - 1] +
			Math.hypot(
				item.points[index].x - item.points[index - 1].x,
				item.points[index].y - item.points[index - 1].y,
			);
	}
	const total = Math.max(1e-6, lengths[count - 1]);
	for (let index = 0; index < count; index += 1) {
		const previous = item.points[Math.max(0, index - 1)];
		const next = item.points[Math.min(count - 1, index + 1)];
		const dx = next.x - previous.x;
		const dy = next.y - previous.y;
		const length = Math.hypot(dx, dy) || 1;
		const normalX = -dy / length;
		const normalY = dx / length;
		const radius = sampleRadius(item.size, item.points[index].p);
		const offset = index * 4;
		positions[offset] = item.points[index].x + normalX * radius;
		positions[offset + 1] = item.points[index].y + normalY * radius;
		positions[offset + 2] = item.points[index].x - normalX * radius;
		positions[offset + 3] = item.points[index].y - normalY * radius;
		uvs[offset] = lengths[index] / total;
		uvs[offset + 1] = 0;
		uvs[offset + 2] = lengths[index] / total;
		uvs[offset + 3] = 1;
		progress[index * 2] = lengths[index] / total;
		progress[index * 2 + 1] = lengths[index] / total;
	}
	const indices = new Uint32Array((count - 1) * 6);
	for (let index = 0; index < count - 1; index += 1) {
		const vertex = index * 2;
		const offset = index * 6;
		indices.set(
			[vertex, vertex + 1, vertex + 2, vertex + 1, vertex + 3, vertex + 2],
			offset,
		);
	}
	const geometry = new MeshGeometry({ positions, uvs, indices });
	geometry.batchMode = "no-batch";
	geometry.addAttribute("aProgress", { buffer: progress, format: "float32" });
	return geometry;
}

function particleLimit(): number {
	const cores =
		typeof navigator === "undefined" ? 8 : navigator.hardwareConcurrency || 4;
	return cores <= 4 ? 3_000 : 10_000;
}

export function createBoardAnimationRuntime(options: RuntimeOptions) {
	let data: BoardRuntimeData = {
		effects: [],
		sequences: [],
		clips: [],
		playback: null,
		playbackPolicy: null,
	};
	const basePoses = new Map<string, BasePose>();
	const effectOrigins = new Map<string, number>();
	const effectVisibility = new Map<string, boolean>();
	const impactResources = new Map<string, Graphics>();
	const flashResources = new Map<
		string,
		{ graphics: Graphics; width: number; height: number }
	>();
	const particleResources = new Map<string, ParticleResource>();
	const trailResources = new Map<string, TrailResource>();
	const revealResources = new Map<string, RevealResource>();
	const filterResources = new Map<string, FilterResource>();
	const filterRestores = new Map<string, FilterRestore>();
	let worldPose: BasePose | null = null;
	let frameId = 0;
	let sharedPlayback: BoardPlaybackSnapshot | null = null;
	let autoplayKey: string | null = null;
	let autoplayPlayback: BoardPlaybackSnapshot | null = null;
	let autoplayTimer: ReturnType<typeof setTimeout> | null = null;
	let active = true;
	let destroyed = false;
	let reducedMotion = false;
	const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

	function nodeWithBase(nodeId: string) {
		const entry = options.getNode(nodeId);
		if (!entry) return null;
		let base = basePoses.get(nodeId);
		if (!base) {
			base = poseOf(entry.container);
			basePoses.set(nodeId, base);
		}
		return { ...entry, base };
	}

	function restoreFilters() {
		for (const restoreState of filterRestores.values()) {
			restoreState.container.filters = restoreState.filters;
			restoreState.container.filterArea = restoreState.filterArea;
		}
		filterRestores.clear();
	}

	function restoreSceneState() {
		restoreFilters();
		for (const [nodeId, pose] of basePoses) {
			const node = options.getNode(nodeId)?.container;
			if (node) restore(node, pose);
		}
		for (const graphics of impactResources.values()) graphics.visible = false;
		for (const resource of flashResources.values())
			resource.graphics.visible = false;
		for (const resource of particleResources.values())
			resource.container.visible = false;
		for (const resource of trailResources.values())
			resource.rope.visible = false;
		for (const resource of revealResources.values()) {
			resource.mesh.visible = false;
			resource.original.renderable = resource.originalRenderable;
		}
	}

	function restoreAll() {
		restoreSceneState();
		const world = options.getWorld();
		if (world && worldPose) restore(world, worldPose);
	}

	function clearResources() {
		restoreAll();
		for (const graphics of impactResources.values()) graphics.destroy();
		for (const resource of flashResources.values()) resource.graphics.destroy();
		for (const resource of particleResources.values())
			resource.container.destroy();
		for (const resource of trailResources.values()) resource.rope.destroy();
		for (const resource of revealResources.values()) {
			resource.mesh.destroy();
			resource.shader.destroy();
			resource.geometry.destroy();
		}
		for (const resource of filterResources.values()) resource.filter.destroy();
		impactResources.clear();
		flashResources.clear();
		particleResources.clear();
		trailResources.clear();
		revealResources.clear();
		filterResources.clear();
	}

	function poseFor(poses: Map<string, AnimationPose>, nodeId: string) {
		let pose = poses.get(nodeId);
		if (!pose) {
			pose = createPose();
			poses.set(nodeId, pose);
		}
		return pose;
	}

	function applyEffect(
		effect: BoardEffect,
		now: number,
		poses: Map<string, AnimationPose>,
	): boolean {
		if (
			!effect.enabled ||
			effect.lifecycle === "manual" ||
			effect.target.type !== "node"
		)
			return false;
		const entry = nodeWithBase(effect.target.nodeId);
		if (!entry) return false;
		const visible = entry.container.visible;
		const wasVisible = effectVisibility.get(effect.id) ?? false;
		effectVisibility.set(effect.id, visible);
		if (effect.lifecycle === "when-visible" && !visible) return false;
		if (
			!effectOrigins.has(effect.id) ||
			(effect.timeOrigin === "visible" && visible && !wasVisible)
		) {
			effectOrigins.set(effect.id, now);
		}
		const origin =
			effect.timeOrigin === "board" ? 0 : (effectOrigins.get(effect.id) ?? now);
		const period = finite(effect.params.period)
			? Math.max(100, effect.params.period)
			: 1_800;
		const phase = (((now - origin) % period) / period) * Math.PI * 2;
		const pose = poseFor(poses, effect.target.nodeId);
		if (effect.kind === "effects.pulse") {
			const amount = finite(effect.params.amount) ? effect.params.amount : 0.04;
			composePose(pose, { scale: 1 + Math.sin(phase) * amount });
			return true;
		}
		if (effect.kind === "effects.float") {
			const distance = finite(effect.params.distance)
				? effect.params.distance
				: 6;
			composePose(pose, { y: Math.sin(phase) * distance });
			return true;
		}
		return false;
	}

	function impactResource(
		clip: BoardClip,
		layers: NonNullable<ReturnType<RuntimeOptions["getLayers"]>>,
	) {
		let graphics = impactResources.get(clip.id);
		if (!graphics) {
			graphics = new Graphics()
				.circle(0, 0, 1)
				.stroke({ color: 0xffffff, width: 0.08, alpha: 1 })
				.circle(0, 0, 0.62)
				.stroke({ color: 0xffffff, width: 0.05, alpha: 0.7 });
			graphics.blendMode = "add";
			layerForClip(clip, layers).addChild(graphics);
			impactResources.set(clip.id, graphics);
		}
		return graphics;
	}

	function updateImpact(
		clip: BoardClip,
		progress: number,
		layers: NonNullable<ReturnType<RuntimeOptions["getLayers"]>>,
	) {
		const graphics = impactResource(clip, layers);
		const center = record(clip.params.center);
		const radius = finite(clip.params.radius) ? clip.params.radius : 160;
		graphics.position.set(
			finite(center?.x) ? center.x : 0,
			finite(center?.y) ? center.y : 0,
		);
		graphics.scale.set(Math.max(0.001, radius * (1 - (1 - progress) ** 3)));
		graphics.alpha = (1 - progress) ** 2;
		graphics.tint = finite(clip.params.color)
			? clip.params.color
			: options.getAccentColor();
		graphics.visible = progress < 1;
	}

	function updateFlash(
		clip: BoardClip,
		progress: number,
		layers: NonNullable<ReturnType<RuntimeOptions["getLayers"]>>,
	) {
		let resource = flashResources.get(clip.id);
		const screen = options.getScreen();
		if (!resource) {
			resource = { graphics: new Graphics(), width: 0, height: 0 };
			layers.screen.addChild(resource.graphics);
			flashResources.set(clip.id, resource);
		}
		if (resource.width !== screen.width || resource.height !== screen.height) {
			resource.graphics
				.clear()
				.rect(0, 0, screen.width, screen.height)
				.fill(0xffffff);
			resource.width = screen.width;
			resource.height = screen.height;
		}
		resource.graphics.tint = finite(clip.params.color)
			? clip.params.color
			: options.getAccentColor();
		resource.graphics.alpha =
			Math.sin(progress * Math.PI) *
			(finite(clip.params.alpha) ? clip.params.alpha : 0.45);
		resource.graphics.visible = progress > 0 && progress < 1;
	}

	function createParticles(
		clip: BoardClip,
		layers: NonNullable<ReturnType<RuntimeOptions["getLayers"]>>,
	): ParticleResource {
		const requested = finite(clip.params.count)
			? Math.max(1, Math.floor(clip.params.count))
			: 120;
		const count = Math.min(requested, particleLimit());
		const indexes = Array.from({ length: count }, (_, index) =>
			Math.floor((index * requested) / count),
		);
		const particles = indexes.map(
			() =>
				new Particle({
					texture: Texture.WHITE,
					anchorX: 0.5,
					anchorY: 0.5,
					alpha: 0,
				}),
		);
		const container = new ParticleContainer({
			texture: Texture.WHITE,
			particles,
			boundsArea: boundsParam(clip.params.bounds),
			dynamicProperties: {
				position: true,
				rotation: true,
				vertex: true,
				color: true,
			},
		});
		container.blendMode = "add";
		layerForClip(clip, layers).addChild(container);
		return { container, particles, indexes };
	}

	function updateParticles(
		clip: BoardClip,
		localTime: number,
		playback: BoardPlaybackSnapshot,
		layers: NonNullable<ReturnType<RuntimeOptions["getLayers"]>>,
	) {
		let resource = particleResources.get(clip.id);
		if (!resource) {
			resource = createParticles(clip, layers);
			particleResources.set(clip.id, resource);
		}
		const bounds = boundsParam(clip.params.bounds);
		const center = record(clip.params.center);
		const centerX = finite(center?.x) ? center.x : bounds.x + bounds.width / 2;
		const centerY = finite(center?.y) ? center.y : bounds.y + bounds.height / 2;
		const speed = finite(clip.params.speed)
			? clip.params.speed
			: Math.min(bounds.width, bounds.height) * 0.42;
		const gravity = finite(clip.params.gravity) ? clip.params.gravity : 180;
		const color = finite(clip.params.color)
			? clip.params.color
			: options.getAccentColor();
		for (let index = 0; index < resource.particles.length; index += 1) {
			const particleIndex = resource.indexes[index];
			const key = `${playback.seed}:${clip.seed}:${particleIndex}`;
			const birth = hashUnit(`${key}:birth`) * clip.duration * 0.18;
			const life = clip.duration * (0.55 + hashUnit(`${key}:life`) * 0.45);
			const age = (localTime - birth) / Math.max(1, life);
			const particle = resource.particles[index];
			if (age < 0 || age > 1) {
				particle.alpha = 0;
				continue;
			}
			const angle = hashUnit(`${key}:angle`) * Math.PI * 2;
			const velocity = speed * (0.45 + hashUnit(`${key}:speed`) * 0.85);
			const seconds = (age * life) / 1_000;
			particle.x = centerX + Math.cos(angle) * velocity * seconds;
			particle.y =
				centerY +
				Math.sin(angle) * velocity * seconds +
				gravity * seconds * seconds * 0.5;
			const scale = 2 + hashUnit(`${key}:size`) * 5;
			particle.scaleX = scale * (1 - age * 0.45);
			particle.scaleY = Math.max(1, scale * 0.35);
			particle.rotation = angle + age * 4;
			particle.tint = color;
			particle.alpha = (1 - age) ** 2;
		}
		resource.container.visible = true;
	}

	function nodeTimelinePose(
		nodeId: string,
		sequence: BoardSequence,
		position: number,
		loop: boolean,
	): AnimationPose {
		const pose = createPose();
		const samplePosition = sequencePosition(position, sequence.duration, loop);
		for (const clip of data.clips) {
			if (
				clip.sequenceId !== sequence.id ||
				clip.target.type !== "node" ||
				clip.target.nodeId !== nodeId
			)
				continue;
			if (clip.kind !== "motion.keyframes" && clip.kind !== "motion.path")
				continue;
			const sample = clipSampleAt(clip, samplePosition);
			if (!sample) continue;
			composePose(
				pose,
				clip.kind === "motion.path"
					? samplePathPose(clip, sample.localTime)
					: sampleKeyframePose(clip, sample.localTime),
			);
		}
		return pose;
	}

	function updateTrail(
		clip: BoardClip,
		sequence: BoardSequence,
		position: number,
		progress: number,
		loop: boolean,
		layers: NonNullable<ReturnType<RuntimeOptions["getLayers"]>>,
	) {
		if (clip.target.type !== "node") return;
		const entry = nodeWithBase(clip.target.nodeId);
		if (!entry) return;
		let resource = trailResources.get(clip.id);
		if (!resource) {
			const points = Array.from(
				{ length: 16 },
				() => new Point(entry.base.x, entry.base.y),
			);
			const rope = new MeshRope({
				texture: Texture.WHITE,
				points,
				width: finite(clip.params.width) ? clip.params.width : 16,
			});
			rope.blendMode = "add";
			layerForClip(clip, layers).addChild(rope);
			resource = { rope, points };
			trailResources.set(clip.id, resource);
		}
		const history = finite(clip.params.history)
			? Math.max(16, clip.params.history)
			: 360;
		for (let index = 0; index < resource.points.length; index += 1) {
			const samplePosition =
				position - history * (1 - index / (resource.points.length - 1));
			const pose = nodeTimelinePose(
				clip.target.nodeId,
				sequence,
				samplePosition,
				loop,
			);
			resource.points[index].set(entry.base.x + pose.x, entry.base.y + pose.y);
		}
		resource.rope.tint = finite(clip.params.color)
			? clip.params.color
			: options.getAccentColor();
		resource.rope.alpha =
			Math.sin(progress * Math.PI) *
			(finite(clip.params.alpha) ? clip.params.alpha : 0.48);
		resource.rope.visible = progress > 0 && progress < 1;
	}

	function updateDrawReveal(clip: BoardClip, progress: number): boolean {
		if (clip.target.type !== "node") return false;
		const entry = options.getNode(clip.target.nodeId);
		if (entry?.item.type !== "draw") return false;
		let resource = revealResources.get(clip.id);
		if (!resource) {
			const geometry = drawRevealGeometry(entry.item);
			const original = entry.container.children[0];
			if (!geometry || !(original instanceof Container)) return false;
			const shader = createRevealShader();
			const mesh = new Mesh({ geometry, shader, texture: Texture.WHITE });
			mesh.tint = options.getAccentColor();
			entry.container.addChild(mesh);
			const created: RevealResource = {
				mesh,
				shader,
				geometry,
				original,
				originalRenderable: original.renderable,
			};
			revealResources.set(clip.id, created);
			resource = created;
		}
		resource.original.renderable = false;
		resource.mesh.visible = true;
		resource.mesh.tint = finite(clip.params.color)
			? clip.params.color
			: options.getAccentColor();
		resource.shader.resources.revealUniforms.uniforms.uProgress = progress;
		return true;
	}

	function applyColorFilter(clip: BoardClip, progress: number) {
		if (clip.target.type !== "node") return;
		const entry = nodeWithBase(clip.target.nodeId);
		if (!entry) return;
		let resource = filterResources.get(clip.id);
		if (!resource) {
			resource = { filter: new ColorMatrixFilter() };
			filterResources.set(clip.id, resource);
		}
		if (!filterRestores.has(clip.target.nodeId)) {
			filterRestores.set(clip.target.nodeId, {
				container: entry.container,
				filters: entry.container.filters ? [...entry.container.filters] : null,
				filterArea: entry.container.filterArea?.clone(),
			});
		}
		const filter = resource.filter;
		filter.reset();
		if (finite(clip.params.brightness))
			filter.brightness(1 + (clip.params.brightness - 1) * progress, false);
		if (finite(clip.params.saturation))
			filter.saturate((clip.params.saturation - 1) * progress, true);
		if (finite(clip.params.hue)) filter.hue(clip.params.hue * progress, true);
		filter.alpha = progress;
		entry.container.filters = [...(entry.container.filters ?? []), filter];
		entry.container.filterArea = entry.container.getBounds().rectangle;
	}

	function applyClip(
		clip: BoardClip,
		sequence: BoardSequence,
		position: number,
		playback: BoardPlaybackSnapshot,
		loop: boolean,
		poses: Map<string, AnimationPose>,
		cameraPose: AnimationPose,
		jobs: Array<() => void>,
		layers: NonNullable<ReturnType<RuntimeOptions["getLayers"]>>,
	): boolean {
		const sample = clipSampleAt(clip, position);
		if (!sample) return false;
		const { localTime, progress } = sample;
		if (clip.kind === "motion.keyframes" && clip.target.type === "node") {
			composePose(
				poseFor(poses, clip.target.nodeId),
				sampleKeyframePose(clip, localTime),
			);
			return true;
		}
		if (clip.kind === "motion.path" && clip.target.type === "node") {
			composePose(
				poseFor(poses, clip.target.nodeId),
				samplePathPose(clip, localTime),
			);
			return true;
		}
		if (
			(clip.kind === "draw.reveal" ||
				clip.kind === "draw.handwrite" ||
				clip.kind === "text.reveal") &&
			clip.target.type === "node"
		) {
			if (clip.kind !== "text.reveal" && updateDrawReveal(clip, progress))
				return true;
			composePose(poseFor(poses, clip.target.nodeId), {
				alpha: progress,
				scale: 0.96 + progress * 0.04,
			});
			return true;
		}
		if (clip.kind === "effects.particles") {
			jobs.push(() => updateParticles(clip, localTime, playback, layers));
			return true;
		}
		if (clip.kind === "effects.trail") {
			jobs.push(() =>
				updateTrail(clip, sequence, position, progress, loop, layers),
			);
			return true;
		}
		if (clip.kind === "effects.impact") {
			jobs.push(() => updateImpact(clip, progress, layers));
			return true;
		}
		if (clip.kind === "effects.flash") {
			jobs.push(() => updateFlash(clip, progress, layers));
			return true;
		}
		if (clip.kind === "effects.color") {
			jobs.push(() => applyColorFilter(clip, progress));
			return true;
		}
		if (clip.kind === "camera.pan") {
			composePose(cameraPose, sampleKeyframePose(clip, localTime));
			return true;
		}
		if (clip.kind === "camera.zoom") {
			const value = sampleKeyframePose(clip, localTime);
			composePose(cameraPose, value ?? { scale: 1 });
			return true;
		}
		if (clip.kind === "camera.shake") {
			const amount = finite(clip.params.amount) ? clip.params.amount : 8;
			const frequency = finite(clip.params.frequency)
				? clip.params.frequency
				: 28;
			const phase = hashUnit(`${playback.seed}:${clip.seed}`) * Math.PI * 2;
			const decay = 1 - progress;
			composePose(cameraPose, {
				x: Math.sin((localTime / 1_000) * frequency + phase) * amount * decay,
				y:
					Math.cos((localTime / 1_000) * frequency * 1.17 + phase) *
					amount *
					decay,
			});
			return true;
		}
		return false;
	}

	function renderFrame(now: number): boolean {
		restoreAll();
		const layers = options.getLayers();
		const world = options.getWorld();
		if (!layers || !world) return false;
		worldPose ??= poseOf(world);
		const poses = new Map<string, AnimationPose>();
		const cameraPose = createPose();
		let hasContinuousEffect = false;
		if (!reducedMotion) {
			for (const effect of data.effects) {
				hasContinuousEffect =
					applyEffect(effect, now, poses) || hasContinuousEffect;
			}
		}

		const playback = sharedPlayback ?? autoplayPlayback;
		const sequence = playback
			? (data.sequences.find(
					(item) =>
						item.id === playback.sequenceId &&
						item.revision === playback.sequenceRevision,
				) ?? null)
			: null;
		const loop =
			playback === autoplayPlayback && Boolean(data.playbackPolicy?.loop);
		const sample =
			playback && sequence
				? playbackSampleAt(playback, sequence.duration, now, loop)
				: null;
		const position = sample?.position ?? 0;
		const ended = sample?.ended ?? false;
		const useRestPose = Boolean(
			sequence && (reducedMotion || playback?.status === "stopped" || ended),
		);
		let hasSupportedClip = false;
		const jobs: Array<() => void> = [];
		if (useRestPose) {
			for (const [nodeId, restPose] of sequenceRestPoses(sequence))
				composePose(poseFor(poses, nodeId), restPose);
		} else if (
			playback &&
			playback.status !== "stopped" &&
			sequence &&
			!sample?.waiting
		) {
			for (const clip of data.clips) {
				if (clip.sequenceId !== sequence.id) continue;
				hasSupportedClip =
					applyClip(
						clip,
						sequence,
						position,
						playback,
						loop,
						poses,
						cameraPose,
						jobs,
						layers,
					) || hasSupportedClip;
			}
		}

		for (const [nodeId, pose] of poses) {
			const entry = nodeWithBase(nodeId);
			if (entry) applyPose(entry.container, entry.base, pose);
		}
		applyPose(world, worldPose, cameraPose);
		for (const job of jobs) job();
		options.render();

		const playbackActive =
			!reducedMotion &&
			playback?.status === "playing" &&
			Boolean(sequence) &&
			!ended &&
			!sample?.waiting;
		return (
			hasContinuousEffect ||
			Boolean(
				playbackActive &&
					(hasSupportedClip ||
						Object.keys(sequence?.restPose ?? {}).length > 0),
			)
		);
	}

	function tick() {
		frameId = 0;
		if (destroyed || !active || document.hidden) return;
		if (renderFrame(Date.now())) frameId = requestAnimationFrame(tick);
	}

	function start() {
		if (!frameId && !destroyed && active && !document.hidden)
			frameId = requestAnimationFrame(tick);
	}

	function clearAutoplayTimer() {
		if (autoplayTimer) clearTimeout(autoplayTimer);
		autoplayTimer = null;
	}

	function scheduleAutoplayStart() {
		clearAutoplayTimer();
		if (!autoplayPlayback || destroyed || !active) return;
		const remaining = autoplayPlayback.effectiveAt - Date.now();
		if (remaining <= 0) {
			start();
			return;
		}
		autoplayTimer = setTimeout(
			scheduleAutoplayStart,
			Math.min(remaining, 2_147_483_647),
		);
	}

	function syncPlayback() {
		if (data.playback) {
			clearAutoplayTimer();
			autoplayKey = null;
			autoplayPlayback = null;
			// Server and client clocks may differ. Anchor each shared revision once.
			const effectiveAt =
				sharedPlayback?.playbackId === data.playback.playbackId &&
				sharedPlayback.playbackRevision === data.playback.playbackRevision
					? sharedPlayback.effectiveAt
					: data.playback.status === "playing"
						? Math.min(data.playback.effectiveAt, Date.now())
						: data.playback.effectiveAt;
			sharedPlayback =
				effectiveAt === data.playback.effectiveAt
					? data.playback
					: { ...data.playback, effectiveAt };
			return;
		}
		sharedPlayback = null;
		if (!active) return;
		const policy = data.playbackPolicy;
		const sequence = policy
			? (data.sequences.find((item) => item.id === policy.sequenceId) ?? null)
			: null;
		if (!policy || !sequence || (policy.loop && sequence.duration <= 0)) {
			clearAutoplayTimer();
			autoplayKey = null;
			autoplayPlayback = null;
			return;
		}
		const key = `${sequence.id}:${sequence.revision}:${policy.delayMs}:${policy.loop}`;
		if (key === autoplayKey && autoplayPlayback) return;
		autoplayKey = key;
		autoplayPlayback = {
			boardId: sequence.boardId,
			playbackId: crypto.randomUUID(),
			sequenceId: sequence.id,
			sequenceRevision: sequence.revision,
			playbackRevision: 0,
			status: "playing",
			position: 0,
			effectiveAt: Date.now() + policy.delayMs,
			timeScale: 1,
			seed: sequence.seed,
		};
		scheduleAutoplayStart();
	}

	function setData(next: BoardRuntimeData) {
		if (next.clips !== data.clips) clearResources();
		data = next;
		syncPlayback();
		start();
	}

	function setActive(next: boolean) {
		if (active === next || destroyed) return;
		active = next;
		if (!active) {
			clearAutoplayTimer();
			cancelAnimationFrame(frameId);
			frameId = 0;
			return;
		}
		syncPlayback();
		if (autoplayPlayback && !autoplayTimer) scheduleAutoplayStart();
		start();
	}

	function prepareSceneSync() {
		// Animated transforms are transient. Scene renderers must receive containers
		// at their persisted poses or the next frame will compound pulse/float values.
		restoreSceneState();
	}

	function invalidatePoses() {
		basePoses.clear();
		worldPose = null;
		// Scene sync may materialize the first target after the runtime's initial
		// frame has stopped. Resume only when there is animation data to evaluate.
		if (data.effects.length > 0 || data.playback || autoplayPlayback) start();
	}

	function visibilityChanged() {
		if (document.hidden) {
			cancelAnimationFrame(frameId);
			frameId = 0;
		} else start();
	}

	function motionPreferenceChanged() {
		reducedMotion = motionQuery.matches;
		start();
	}

	reducedMotion = motionQuery.matches;
	document.addEventListener("visibilitychange", visibilityChanged);
	motionQuery.addEventListener("change", motionPreferenceChanged);

	return {
		setData,
		setActive,
		start,
		prepareSceneSync,
		invalidatePoses,
		destroy() {
			destroyed = true;
			clearAutoplayTimer();
			cancelAnimationFrame(frameId);
			frameId = 0;
			document.removeEventListener("visibilitychange", visibilityChanged);
			motionQuery.removeEventListener("change", motionPreferenceChanged);
			clearResources();
			restoreAll();
			basePoses.clear();
			effectOrigins.clear();
			effectVisibility.clear();
		},
	};
}
