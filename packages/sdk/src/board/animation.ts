import {
  BOARD_BUILTIN_CAPABILITIES,
  DEFAULT_BOARD_RENDER_LIMITS,
  type BoardCapability,
  type BoardRenderCost,
} from "@cohub/protocol/board-constants";
import type {
  BoardAssetRef,
  BoardClip,
  BoardDiagnostic,
  BoardEffect,
  BoardSequence,
  BoardTarget,
  BoardValidationResult,
} from "@cohub/protocol";

export type TimelineClipInput = Omit<BoardClip, "id" | "sequenceId" | "start" | "seed"> & {
  id?: string;
  seed?: string;
};

export type TimelineInput =
  | { type: "clip"; clip: TimelineClipInput }
  | { type: "parallel"; children: TimelineInput[] }
  | { type: "sequence"; children: TimelineInput[] }
  | { type: "stagger"; each: number; children: TimelineInput[] }
  | { type: "delay"; duration: number; child: TimelineInput }
  | { type: "repeat"; count: number; child: TimelineInput };

export type CompiledSequence = {
  sequence: Omit<BoardSequence, "boardId" | "revision">;
  clips: Array<Omit<BoardClip, "sequenceId">>;
  assetRefs: BoardAssetRef[];
};

export type RenderBounds = { x: number; y: number; width: number; height: number };
export type QualityProfile = "low" | "medium" | "high";

export type BoardExtensionDefinition = BoardCapability & {
  validate?: (params: Record<string, unknown>) => BoardDiagnostic[];
  getBounds?: (params: Record<string, unknown>) => RenderBounds | null;
  getAssetRefs?: (params: Record<string, unknown>) => BoardAssetRef[];
  estimateCost: (params: Record<string, unknown>, profile: QualityProfile) => Partial<BoardRenderCost>;
};

export type BoardPresetDefinition = BoardCapability & {
  kind: "preset";
  compile: (params: Record<string, unknown>) => TimelineInput;
};

const ZERO_COST: BoardRenderCost = {
  particles: 0,
  vertices: 0,
  dynamicVertices: 0,
  drawCalls: 0,
  filterPasses: 0,
  renderTexturePixels: 0,
  textureBytes: 0,
  bufferBytes: 0,
  simulationSteps: 0,
};

export const DEFAULT_BOARD_LIMITS = DEFAULT_BOARD_RENDER_LIMITS;

const BUILTIN_CAPABILITIES: BoardCapability[] = BOARD_BUILTIN_CAPABILITIES;

function numericParam(params: Record<string, unknown>, key: string, fallback: number): number {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function builtinDefinition(capability: BoardCapability): BoardExtensionDefinition {
  return {
    ...capability,
    validate(params) {
      const diagnostics: BoardDiagnostic[] = [];
      if (capability.id === "effects.particles") {
        const count = params.count;
        const bounds = params.bounds;
        if (!Number.isSafeInteger(count) || (count as number) < 1 || (count as number) > DEFAULT_BOARD_LIMITS.particles) {
          diagnostics.push({ severity: "error", code: "INVALID_PARTICLE_COUNT", message: `count must be an integer between 1 and ${DEFAULT_BOARD_LIMITS.particles}`, path: "params.count" });
        }
        if (!bounds || typeof bounds !== "object" || Array.isArray(bounds)) {
          diagnostics.push({ severity: "error", code: "PARTICLE_BOUNDS_REQUIRED", message: "particles require finite bounds", path: "params.bounds" });
        } else {
          const value = bounds as Record<string, unknown>;
          if (![value.x, value.y, value.width, value.height].every((item) => typeof item === "number" && Number.isFinite(item)) || (value.width as number) <= 0 || (value.height as number) <= 0) {
            diagnostics.push({ severity: "error", code: "INVALID_PARTICLE_BOUNDS", message: "particle bounds must have a positive finite size", path: "params.bounds" });
          }
        }
      }
      if (capability.id === "motion.path") {
        const points = params.points;
        if (!Array.isArray(points) || points.length < 2 || points.length > 10_000) {
          diagnostics.push({ severity: "error", code: "INVALID_MOTION_PATH", message: "motion path must contain 2 to 10000 points", path: "params.points" });
        }
      }
      return diagnostics;
    },
    getBounds(params) {
      const bounds = params.bounds;
      if (!bounds || typeof bounds !== "object" || Array.isArray(bounds)) return null;
      const value = bounds as Record<string, unknown>;
      return [value.x, value.y, value.width, value.height].every((item) => typeof item === "number" && Number.isFinite(item))
        ? value as RenderBounds
        : null;
    },
    estimateCost(params) {
      switch (capability.id) {
        case "effects.particles": {
          const particles = Math.max(0, Math.floor(numericParam(params, "count", 0)));
          return { particles, vertices: particles * 4, dynamicVertices: particles * 4, drawCalls: 1, bufferBytes: particles * 48, simulationSteps: particles };
        }
        case "effects.trail":
          return { vertices: 32, dynamicVertices: 32, drawCalls: 1, bufferBytes: 1_024, simulationSteps: 16 };
        case "effects.impact":
        case "effects.flash":
          return { vertices: 64, drawCalls: 1 };
        case "effects.color":
          return { drawCalls: 1, filterPasses: 1 };
        case "draw.reveal":
        case "draw.handwrite":
          return { drawCalls: 1, dynamicVertices: 1 };
        default:
          return {};
      }
    },
  };
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

function stableId(prefix: string, seed: string, path: string): string {
  return `${prefix}_${stableHash(`${seed}:${path}`)}`;
}

function assertDuration(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${field} must be a finite non-negative number`);
}

export const timeline = {
  clip(clip: TimelineClipInput): TimelineInput {
    return { type: "clip", clip };
  },
  parallel(...children: TimelineInput[]): TimelineInput {
    return { type: "parallel", children };
  },
  sequence(...children: TimelineInput[]): TimelineInput {
    return { type: "sequence", children };
  },
  stagger(each: number, ...children: TimelineInput[]): TimelineInput {
    assertDuration(each, "stagger each");
    return { type: "stagger", each, children };
  },
  delay(duration: number, child: TimelineInput): TimelineInput {
    assertDuration(duration, "delay duration");
    return { type: "delay", duration, child };
  },
  repeat(count: number, child: TimelineInput): TimelineInput {
    if (!Number.isSafeInteger(count) || count < 1 || count > 1_000) throw new TypeError("repeat count must be an integer between 1 and 1000");
    return { type: "repeat", count, child };
  },
};

export function clip(input: {
  kind: string;
  target: BoardTarget;
  duration: number;
  params?: Record<string, unknown>;
  keyframes?: BoardClip["keyframes"];
  assetRefs?: BoardAssetRef[];
  easing?: string;
  fill?: BoardClip["fill"];
  layer?: BoardClip["layer"];
  kindVersion?: number;
  id?: string;
  seed?: string;
  metadata?: Record<string, unknown>;
}): TimelineInput {
  assertDuration(input.duration, "clip duration");
  if (input.duration === 0) throw new TypeError("clip duration must be greater than zero");
  return timeline.clip({
    id: input.id,
    kind: input.kind,
    kindVersion: input.kindVersion ?? 1,
    target: input.target,
    duration: input.duration,
    layer: input.layer ?? "content",
    fill: input.fill ?? "none",
    easing: input.easing ?? "linear",
    params: input.params ?? {},
    keyframes: input.keyframes ?? [],
    assetRefs: input.assetRefs ?? [],
    seed: input.seed,
    metadata: input.metadata ?? {},
  });
}

type FlattenResult = { duration: number; clips: Array<Omit<BoardClip, "sequenceId">> };

function flatten(input: TimelineInput, offset: number, sequenceSeed: string, path: string): FlattenResult {
  if (input.type === "clip") {
    const clipSeed = input.clip.seed ?? `${sequenceSeed}:${path}`;
    return {
      duration: input.clip.duration,
      clips: [{ ...input.clip, id: input.clip.id ?? stableId("clip", sequenceSeed, path), start: offset, seed: clipSeed }],
    };
  }
  if (input.type === "delay") {
    const nested = flatten(input.child, offset + input.duration, sequenceSeed, `${path}.child`);
    return { duration: input.duration + nested.duration, clips: nested.clips };
  }
  if (input.type === "repeat") {
    const clips: Array<Omit<BoardClip, "sequenceId">> = [];
    let cursor = offset;
    let total = 0;
    for (let index = 0; index < input.count; index += 1) {
      const nested = flatten(input.child, cursor, sequenceSeed, `${path}.${index}`);
      clips.push(...nested.clips);
      cursor += nested.duration;
      total += nested.duration;
    }
    return { duration: total, clips };
  }
  const clips: Array<Omit<BoardClip, "sequenceId">> = [];
  let duration = 0;
  for (const [index, child] of input.children.entries()) {
    const childOffset = input.type === "sequence" ? duration : input.type === "stagger" ? input.each * index : 0;
    const nested = flatten(child, offset + childOffset, sequenceSeed, `${path}.${index}`);
    clips.push(...nested.clips);
    duration = input.type === "sequence" ? duration + nested.duration : Math.max(duration, childOffset + nested.duration);
  }
  return { duration, clips };
}

export function compileSequence(input: {
  id: string;
  name: string;
  seed: string;
  timeline: TimelineInput;
  restPose?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): CompiledSequence {
  const flattened = flatten(input.timeline, 0, input.seed, "root");
  flattened.clips.sort((left, right) => left.start - right.start || left.id.localeCompare(right.id));
  const refs = new Map<string, BoardAssetRef>();
  for (const item of flattened.clips) {
    for (const ref of item.assetRefs) refs.set(`${ref.type}:${ref.ref}:${ref.digest ?? ""}`, ref);
  }
  return {
    sequence: {
      id: input.id,
      name: input.name,
      duration: flattened.duration,
      seed: input.seed,
      restPose: input.restPose ?? {},
      metadata: input.metadata ?? {},
    },
    clips: flattened.clips,
    assetRefs: [...refs.values()],
  };
}

function addCost(target: BoardRenderCost, source: Partial<BoardRenderCost>): void {
  for (const key of Object.keys(target) as Array<keyof BoardRenderCost>) target[key] += source[key] ?? 0;
}

export class BoardExtensionRegistry {
  readonly #extensions = new Map<string, BoardExtensionDefinition>();
  readonly #presets = new Map<string, BoardPresetDefinition>();

  register(definition: BoardExtensionDefinition | BoardPresetDefinition): this {
    const key = `${definition.kind}:${definition.id}@${definition.version}`;
    const target = definition.kind === "preset" ? this.#presets : this.#extensions;
    if (target.has(key)) throw new Error(`Board extension is already registered: ${key}`);
    target.set(key, definition as never);
    return this;
  }

  capabilities(): BoardCapability[] {
    const extensions = [...this.#extensions.values()].map(
      ({ validate: _validate, getBounds: _bounds, getAssetRefs: _refs, estimateCost: _cost, ...definition }) => definition,
    );
    const presets = [...this.#presets.values()].map(
      ({ compile: _compile, ...definition }) => definition,
    );
    return [...extensions, ...presets];
  }

  compilePreset(id: string, version: number, params: Record<string, unknown>): TimelineInput {
    const preset = this.#presets.get(`preset:${id}@${version}`);
    if (!preset) throw new Error(`Unknown Board preset: ${id}@${version}`);
    return preset.compile(params);
  }

  validate(input: { clips: Array<Omit<BoardClip, "sequenceId">>; effects?: Array<Omit<BoardEffect, "boardId" | "revision">>; profile?: QualityProfile; limits?: BoardRenderCost }): BoardValidationResult {
    const diagnostics: BoardDiagnostic[] = [];
    const events: Array<{ at: number; direction: 1 | -1; cost: BoardRenderCost }> = [];
    const profile = input.profile ?? "high";
    const persistentCost = { ...ZERO_COST };
    for (const [index, effect] of (input.effects ?? []).entries()) {
      const definition = this.#extensions.get(`effect:${effect.kind}@${effect.kindVersion}`);
      if (!definition) {
        diagnostics.push({ severity: "warning", code: "UNKNOWN_EFFECT", message: `No renderer is registered for ${effect.kind}@${effect.kindVersion}`, path: `effects.${index}` });
        continue;
      }
      diagnostics.push(...(definition.validate?.(effect.params) ?? []));
      addCost(persistentCost, definition.estimateCost(effect.params, profile));
    }
    for (const [index, clip] of input.clips.entries()) {
      const definition = this.#extensions.get(`clip:${clip.kind}@${clip.kindVersion}`);
      if (!definition) {
        diagnostics.push({ severity: "warning", code: "UNKNOWN_CLIP", message: `No renderer is registered for ${clip.kind}@${clip.kindVersion}`, path: `clips.${index}` });
        continue;
      }
      diagnostics.push(...(definition.validate?.(clip.params) ?? []));
      const cost = { ...ZERO_COST };
      addCost(cost, definition.estimateCost(clip.params, profile));
      events.push({ at: clip.start, direction: 1, cost }, { at: clip.start + clip.duration, direction: -1, cost });
    }
    events.sort((left, right) => left.at - right.at || left.direction - right.direction);
    const current = { ...persistentCost };
    const peak = { ...persistentCost };
    for (const event of events) {
      for (const key of Object.keys(current) as Array<keyof BoardRenderCost>) {
        current[key] += event.cost[key] * event.direction;
        peak[key] = Math.max(peak[key], current[key]);
      }
    }
    const limits = input.limits ?? DEFAULT_BOARD_LIMITS;
    for (const key of Object.keys(limits) as Array<keyof BoardRenderCost>) {
      if (peak[key] > limits[key]) diagnostics.push({ severity: "warning", code: "RENDER_BUDGET_EXCEEDED", message: `${key} peaks at ${peak[key]}, above ${limits[key]}`, path: key, adaptation: { quality: "lower" } });
    }
    return { valid: !diagnostics.some((item) => item.severity === "error"), diagnostics, peakCost: peak };
  }
}

export function createBoardExtensionRegistry(input: { builtins?: boolean } = {}): BoardExtensionRegistry {
  const registry = new BoardExtensionRegistry();
  if (input.builtins !== false) {
    for (const capability of BUILTIN_CAPABILITIES) registry.register(builtinDefinition(capability));
  }
  return registry;
}
