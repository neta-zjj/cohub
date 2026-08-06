import {
  BOARD_BUILTIN_CLIP_KINDS,
  BOARD_BUILTIN_EFFECT_KINDS,
  BoardClipSchema,
  BoardEffectSchema,
  BoardPlaybackPolicySchema,
  BoardSequenceSchema,
  DEFAULT_BOARD_RENDER_LIMITS,
  type BoardClip,
  type BoardDiagnostic,
  type BoardEffect,
  type BoardNodeInput,
  type BoardOperation,
  type BoardRenderCost,
  type BoardTransaction,
  type BoardValidationResult,
} from "@cohub/protocol";

export class BoardServiceError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "BoardServiceError";
  }
}

/**
 * Ceiling on nodes in a board, and on operations in one transaction.
 *
 * These two are deliberately equal. Any lower operation cap would create edits a
 * user can make but not save: selecting every node and deleting it is one
 * operation per node, and a transaction is one undo step, so the client cannot
 * split it without splitting undo and making a partial edit visible to everyone
 * else. So the invariant is: whatever you are allowed to create, you are allowed
 * to edit in one go.
 *
 * The real guard is MAX_TRANSACTION_BYTES below - an operation count says nothing
 * about cost, whereas bytes bound both the request and the work it implies.
 */
export const MAX_BOARD_NODES = 50_000;
export const MAX_BOARD_OPERATIONS = 50_000;
export const MAX_NODE_ID_LENGTH = 160;
export const MAX_NODE_TYPE_LENGTH = 40;
export const MAX_REF_LENGTH = 4096;
export const MAX_JSON_FIELD_BYTES = 64 * 1024;
/**
 * Ceiling on one transaction's JSON payload.
 *
 * Sized from the measured cost of the operations that actually reach this limit:
 * a delete or a geometry patch is ~110 B on the wire, so the worst realistic bulk
 * edit (touch all 50k nodes) is ~6 MB. Bulk *creates* are ~480 B each and come
 * through boards.create instead, bounded by MAX_NODES_BYTES.
 */
export const MAX_TRANSACTION_BYTES = 16 * 1024 * 1024;
/**
 * Ceiling on the nodes array of one boards.create.
 *
 * A created node measures ~480 B, so 50k of them is ~23 MB; 32 MB leaves headroom
 * without letting a single request become unbounded.
 */
export const MAX_NODES_BYTES = 32 * 1024 * 1024;
/**
 * Rows per node INSERT/UPSERT statement.
 *
 * Postgres allows 65535 bind parameters per statement and a node row binds ~18, so
 * anything above ~3600 rows fails outright. 500 keeps a wide margin and bounds the
 * size of a single statement's parameter list.
 */
export const NODE_WRITE_CHUNK = 500;

const BUILTIN_CLIP_KINDS = new Set<string>(BOARD_BUILTIN_CLIP_KINDS);
const BUILTIN_EFFECT_KINDS = new Set<string>(BOARD_BUILTIN_EFFECT_KINDS);

export const ZERO_BOARD_COST: BoardRenderCost = {
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value ?? {}), "utf8");

function assertSafeJson(value: unknown, path: string): void {
  if (typeof value === "string") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertSafeJson(item, `${path}.${index}`);
    });
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && /^(?:glsl|wgsl|shaderSource|sourceCode)$/i.test(key)) {
      throw new BoardServiceError(400, `${path}.${key} is not allowed`, "UNTRUSTED_CODE");
    }
    assertSafeJson(item, `${path}.${key}`);
  }
}

function cleanRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (value == null) return {};
  if (!isRecord(value)) throw new BoardServiceError(400, `${fieldName} must be an object`);
  if (jsonBytes(value) > MAX_JSON_FIELD_BYTES) throw new BoardServiceError(413, `${fieldName} is too large`);
  assertSafeJson(value, fieldName);
  return value;
}

function cleanBoardMetadata(value: unknown): Record<string, unknown> {
  const metadata = cleanRecord(value, "board.metadata");
  if (metadata.playback !== undefined) {
    const parsed = BoardPlaybackPolicySchema.safeParse(metadata.playback);
    if (!parsed.success) {
      throw new BoardServiceError(
        400,
        parsed.error.issues[0]?.message ?? "invalid Board playback metadata",
        "INVALID_PLAYBACK_POLICY",
      );
    }
    return { ...metadata, playback: parsed.data };
  }
  return metadata;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function normalizePlaybackPosition(position: number, duration: number): number {
  if (duration <= 0) return 0;
  return Math.min(duration, Math.max(0, position));
}

function optionalString(value: unknown, fieldName: string, maxLength = MAX_REF_LENGTH): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new BoardServiceError(400, `${fieldName} must be a string`);
  const result = value.trim();
  if (result.length > maxLength) throw new BoardServiceError(400, `${fieldName} is too long`);
  return result || null;
}

export function normalizeNode(input: BoardNodeInput): BoardNodeInput {
  if (!isRecord(input) || typeof input.nodeId !== "string" || !input.nodeId.trim()) {
    throw new BoardServiceError(400, "nodeId is required");
  }
  if (input.nodeId.length > MAX_NODE_ID_LENGTH) throw new BoardServiceError(400, "nodeId is too long");
  if (typeof input.type !== "string" || !input.type.trim()) throw new BoardServiceError(400, "node type is required");
  if (input.type.length > MAX_NODE_TYPE_LENGTH) throw new BoardServiceError(400, "node type is too long");
  const refUrl = optionalString(input.refUrl, "refUrl");
  if (refUrl && /^https?:\/\//i.test(refUrl)) {
    throw new BoardServiceError(400, "refUrl cannot contain a network URL", "UNTRUSTED_URL");
  }
  return {
    nodeId: input.nodeId.trim(),
    type: input.type.trim(),
    parentId: optionalString(input.parentId, "parentId"),
    orderKey: optionalString(input.orderKey, "orderKey"),
    x: finite(input.x, 0),
    y: finite(input.y, 0),
    width: Math.max(1, finite(input.width, 240)),
    height: Math.max(1, finite(input.height, 160)),
    rotation: finite(input.rotation, 0),
    refKind: optionalString(input.refKind, "refKind", 40),
    refPath: optionalString(input.refPath, "refPath"),
    refUrl,
    view: cleanRecord(input.view, "view"),
    style: cleanRecord(input.style, "style"),
    data: cleanRecord(input.data, "data"),
  };
}

export function normalizeNodes(input: BoardNodeInput[]): BoardNodeInput[] {
  if (!Array.isArray(input)) throw new BoardServiceError(400, "nodes must be an array");
  if (input.length > MAX_BOARD_NODES) throw new BoardServiceError(413, "too many board nodes");
  // Bounded by bytes as well as count, for the same reason transactions are: a node
  // carries free-form view/style/data, so a legal count says nothing about the size
  // of the request behind it.
  if (jsonBytes(input) > MAX_NODES_BYTES) throw new BoardServiceError(413, "board nodes are too large");
  const nodes = input.map(normalizeNode);
  const ids = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.nodeId)) throw new BoardServiceError(400, `duplicate nodeId: ${node.nodeId}`);
    ids.add(node.nodeId);
  }
  return nodes;
}

export type NormalizedNodePatch = Partial<Omit<BoardNodeInput, "nodeId">>;

function normalizeNodePatch(input: unknown): NormalizedNodePatch {
  if (!isRecord(input)) throw new BoardServiceError(400, "node.patch requires patch");
  const sentinel: BoardNodeInput = {
    nodeId: "patch",
    type: typeof input.type === "string" ? input.type : "patch",
    parentId: input.parentId as string | null,
    orderKey: input.orderKey as string | null,
    x: input.x as number,
    y: input.y as number,
    width: input.width as number,
    height: input.height as number,
    rotation: input.rotation as number,
    refKind: input.refKind as string | null,
    refPath: input.refPath as string | null,
    refUrl: input.refUrl as string | null,
    view: input.view as Record<string, unknown>,
    style: input.style as Record<string, unknown>,
    data: input.data as Record<string, unknown>,
  };
  const normalized = normalizeNode(sentinel);
  const patch: NormalizedNodePatch = {};
  for (const key of Object.keys(input)) {
    if (key === "nodeId" || !(key in normalized)) throw new BoardServiceError(400, `unsupported node patch field: ${key}`);
    (patch as Record<string, unknown>)[key] = normalized[key as keyof BoardNodeInput];
  }
  if (Object.keys(patch).length === 0) throw new BoardServiceError(400, "node.patch is empty");
  return patch;
}

function requireFiniteParam(value: unknown, path: string, options: { min?: number; max?: number; integer?: boolean } = {}): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new BoardServiceError(400, `${path} must be finite`);
  if (options.integer && !Number.isSafeInteger(value)) throw new BoardServiceError(400, `${path} must be an integer`);
  if (options.min != null && value < options.min) throw new BoardServiceError(400, `${path} must be at least ${options.min}`);
  if (options.max != null && value > options.max) throw new BoardServiceError(400, `${path} must be at most ${options.max}`);
  return value;
}

function requireBounds(value: unknown, path: string): { x: number; y: number; width: number; height: number } {
  if (!isRecord(value)) throw new BoardServiceError(400, `${path} is required`);
  return {
    x: requireFiniteParam(value.x, `${path}.x`),
    y: requireFiniteParam(value.y, `${path}.y`),
    width: requireFiniteParam(value.width, `${path}.width`, { min: 1 }),
    height: requireFiniteParam(value.height, `${path}.height`, { min: 1 }),
  };
}

function validateBuiltinClip(clip: Omit<BoardClip, "sequenceId">, path: string): void {
  if (!BUILTIN_CLIP_KINDS.has(clip.kind)) return;
  if ((clip.kind.startsWith("motion.") || clip.kind.startsWith("draw.") || clip.kind === "text.reveal" || clip.kind === "effects.trail") && clip.target.type !== "node") {
    throw new BoardServiceError(400, `${path}.target must be a node for ${clip.kind}`);
  }
  if (clip.kind.startsWith("camera.") && clip.target.type !== "camera") {
    throw new BoardServiceError(400, `${path}.target must be the camera for ${clip.kind}`);
  }
  if (clip.kind === "motion.path") {
    if (!Array.isArray(clip.params.points) || clip.params.points.length < 2 || clip.params.points.length > 10_000) {
      throw new BoardServiceError(400, `${path}.params.points must contain 2 to 10000 points`);
    }
    for (const [index, point] of clip.params.points.entries()) {
      if (!isRecord(point)) throw new BoardServiceError(400, `${path}.params.points.${index} must be an object`);
      requireFiniteParam(point.x, `${path}.params.points.${index}.x`);
      requireFiniteParam(point.y, `${path}.params.points.${index}.y`);
    }
  }
  if (clip.kind === "effects.particles") {
    requireFiniteParam(clip.params.count, `${path}.params.count`, { min: 1, max: DEFAULT_BOARD_RENDER_LIMITS.particles, integer: true });
    requireBounds(clip.params.bounds, `${path}.params.bounds`);
  }
  if (clip.kind === "effects.color" && clip.target.type !== "node") {
    throw new BoardServiceError(400, `${path}.target must be a node for effects.color`);
  }
}

function parseEffect(value: unknown) {
  const parsed = BoardEffectSchema.omit({ boardId: true, revision: true }).safeParse(value);
  if (!parsed.success) throw new BoardServiceError(400, parsed.error.issues[0]?.message ?? "invalid effect");
  assertSafeJson(parsed.data.params, "effect.params");
  assertSafeJson(parsed.data.metadata, "effect.metadata");
  for (const ref of parsed.data.assetRefs) {
    if (ref.type === "extension" && !ref.digest) throw new BoardServiceError(400, "extension assets require a digest");
  }
  if (BUILTIN_EFFECT_KINDS.has(parsed.data.kind) && parsed.data.target.type !== "node") {
    throw new BoardServiceError(400, `effect target must be a node for ${parsed.data.kind}`);
  }
  return parsed.data;
}

function parseSequence(value: unknown, clipsValue: unknown) {
  const sequence = BoardSequenceSchema.omit({ boardId: true, revision: true }).safeParse(value);
  if (!sequence.success) throw new BoardServiceError(400, sequence.error.issues[0]?.message ?? "invalid sequence");
  if (!Array.isArray(clipsValue)) throw new BoardServiceError(400, "sequence clips must be an array");
  const clips = clipsValue.map((clip, index) => {
    const parsed = BoardClipSchema.omit({ sequenceId: true }).safeParse(clip);
    if (!parsed.success) throw new BoardServiceError(400, `clips.${index}: ${parsed.error.issues[0]?.message ?? "invalid clip"}`);
    assertSafeJson(parsed.data.params, `clips.${index}.params`);
    assertSafeJson(parsed.data.metadata, `clips.${index}.metadata`);
    for (const ref of parsed.data.assetRefs) {
      if (ref.type === "extension" && !ref.digest) throw new BoardServiceError(400, `clips.${index}: extension assets require a digest`);
    }
    if (parsed.data.start + parsed.data.duration > sequence.data.duration) {
      throw new BoardServiceError(400, `clips.${index} exceeds sequence duration`);
    }
    validateBuiltinClip(parsed.data, `clips.${index}`);
    return parsed.data;
  });
  const ids = new Set<string>();
  for (const clip of clips) {
    if (ids.has(clip.id)) throw new BoardServiceError(400, `duplicate clip id: ${clip.id}`);
    ids.add(clip.id);
  }
  return { sequence: sequence.data, clips };
}

export function normalizeBoardOperation(operation: BoardOperation): BoardOperation {
  if (!isRecord(operation) || typeof operation.type !== "string" || !isRecord(operation.payload)) {
    throw new BoardServiceError(400, "invalid board operation");
  }
  const opId = optionalString(operation.opId, "opId", 160) ?? undefined;
  const base = opId ? { opId } : {};
  switch (operation.type) {
    case "board.patch": {
      if (!isRecord(operation.payload.patch)) throw new BoardServiceError(400, "board.patch requires patch");
      const patch: { title?: string; metadata?: Record<string, unknown> } = {};
      if ("title" in operation.payload.patch) {
        if (typeof operation.payload.patch.title !== "string" || !operation.payload.patch.title.trim()) throw new BoardServiceError(400, "board title is required");
        patch.title = operation.payload.patch.title.trim().slice(0, 255);
      }
      if ("metadata" in operation.payload.patch) patch.metadata = cleanBoardMetadata(operation.payload.patch.metadata);
      if (Object.keys(patch).length === 0) throw new BoardServiceError(400, "board.patch is empty");
      return { ...base, type: "board.patch", payload: { patch } };
    }
    case "node.create":
      return { ...base, type: "node.create", payload: { node: normalizeNode(operation.payload.node as BoardNodeInput) } };
    case "node.patch": {
      const nodeId = optionalString(operation.payload.nodeId, "nodeId", MAX_NODE_ID_LENGTH);
      if (!nodeId) throw new BoardServiceError(400, "node.patch requires nodeId");
      return { ...base, type: "node.patch", payload: { nodeId, patch: normalizeNodePatch(operation.payload.patch) } };
    }
    case "node.delete": {
      const nodeId = optionalString(operation.payload.nodeId, "nodeId", MAX_NODE_ID_LENGTH);
      if (!nodeId) throw new BoardServiceError(400, "node.delete requires nodeId");
      const reason = optionalString(operation.payload.reason, "reason", 80) ?? undefined;
      return { ...base, type: "node.delete", payload: { nodeId, ...(reason ? { reason } : {}) } };
    }
    case "effect.upsert":
      return { ...base, type: "effect.upsert", payload: { effect: parseEffect(operation.payload.effect) } };
    case "effect.delete": {
      const effectId = optionalString(operation.payload.effectId, "effectId", 160);
      if (!effectId) throw new BoardServiceError(400, "effect.delete requires effectId");
      return { ...base, type: "effect.delete", payload: { effectId } };
    }
    case "sequence.upsert": {
      const parsed = parseSequence(operation.payload.sequence, operation.payload.clips);
      return { ...base, type: "sequence.upsert", payload: parsed };
    }
    case "sequence.delete": {
      const sequenceId = optionalString(operation.payload.sequenceId, "sequenceId", 160);
      if (!sequenceId) throw new BoardServiceError(400, "sequence.delete requires sequenceId");
      return { ...base, type: "sequence.delete", payload: { sequenceId } };
    }
  }
  throw new BoardServiceError(400, "unsupported board operation");
}

export function normalizeBoardTransaction(value: unknown): BoardTransaction {
  if (!isRecord(value)) throw new BoardServiceError(400, "invalid board transaction");
  if (jsonBytes(value) > MAX_TRANSACTION_BYTES) throw new BoardServiceError(413, "transaction is too large");
  const txId = optionalString(value.txId, "txId", 160);
  const boardId = optionalString(value.boardId, "boardId", 160);
  if (!txId || !boardId) throw new BoardServiceError(400, "txId and boardId are required");
  if (!Number.isSafeInteger(value.baseVersion) || (value.baseVersion as number) < 0) throw new BoardServiceError(400, "baseVersion must be a non-negative integer");
  if (!Array.isArray(value.operations) || value.operations.length === 0) throw new BoardServiceError(400, "operations are required");
  if (value.operations.length > MAX_BOARD_OPERATIONS) throw new BoardServiceError(413, "too many operations");
  return {
    txId,
    boardId,
    baseVersion: value.baseVersion as number,
    clientId: optionalString(value.clientId, "clientId", 160),
    undoGroupId: optionalString(value.undoGroupId, "undoGroupId", 160),
    operations: value.operations.map((operation) => normalizeBoardOperation(operation as BoardOperation)),
  };
}

function addCost(target: BoardRenderCost, source: Partial<BoardRenderCost>, multiplier = 1): void {
  for (const key of Object.keys(target) as Array<keyof BoardRenderCost>) {
    target[key] += (source[key] ?? 0) * multiplier;
  }
}

function clipCost(clip: Omit<BoardClip, "sequenceId">): Partial<BoardRenderCost> {
  switch (clip.kind) {
    case "effects.particles": {
      const count = clip.params.count as number;
      return {
        particles: count,
        vertices: count * 4,
        dynamicVertices: count * 4,
        drawCalls: 1,
        bufferBytes: count * 48,
        simulationSteps: count,
      };
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
    case "motion.path":
      return { simulationSteps: Array.isArray(clip.params.points) ? clip.params.points.length : 0 };
    case "motion.keyframes":
      return { simulationSteps: clip.keyframes.length };
    default:
      return {};
  }
}

function sequencePeakCost(clips: Array<Omit<BoardClip, "sequenceId">>): BoardRenderCost {
  const events: Array<{ at: number; direction: 1 | -1; cost: BoardRenderCost }> = [];
  for (const clip of clips) {
    const cost = { ...ZERO_BOARD_COST };
    addCost(cost, clipCost(clip));
    events.push({ at: clip.start, direction: 1, cost });
    events.push({ at: clip.start + clip.duration, direction: -1, cost });
  }
  events.sort((left, right) => left.at - right.at || left.direction - right.direction);
  const current = { ...ZERO_BOARD_COST };
  const peak = { ...ZERO_BOARD_COST };
  for (const event of events) {
    addCost(current, event.cost, event.direction);
    for (const key of Object.keys(peak) as Array<keyof BoardRenderCost>) peak[key] = Math.max(peak[key], current[key]);
  }
  return peak;
}

export type BoardValidationContext = {
  boardVersion: number;
  nodeIds: Iterable<string>;
  effects: Iterable<Pick<BoardEffect, "id" | "target">>;
  sequences: Iterable<{ id: string; clips: BoardClip[] }>;
  metadata?: Record<string, unknown>;
};

export function structuralValidation(transaction: BoardTransaction): BoardValidationResult {
  const diagnostics: BoardDiagnostic[] = [];
  const peakCost = { ...ZERO_BOARD_COST };
  for (const [index, operation] of transaction.operations.entries()) {
    if (operation.type === "effect.upsert") {
      if (!BUILTIN_EFFECT_KINDS.has(operation.payload.effect.kind)) {
        diagnostics.push({
          severity: "warning",
          code: "UNKNOWN_EFFECT",
          message: `No built-in renderer is registered for ${operation.payload.effect.kind}@${operation.payload.effect.kindVersion}`,
          path: `operations.${index}.payload.effect`,
        });
      }
      continue;
    }
    if (operation.type !== "sequence.upsert") continue;
    for (const [clipIndex, clip] of operation.payload.clips.entries()) {
      if (!BUILTIN_CLIP_KINDS.has(clip.kind)) {
        diagnostics.push({
          severity: "warning",
          code: "UNKNOWN_CLIP",
          message: `No built-in renderer is registered for ${clip.kind}@${clip.kindVersion}`,
          path: `operations.${index}.payload.clips.${clipIndex}`,
        });
      }
    }
    const sequenceCost = sequencePeakCost(operation.payload.clips);
    for (const key of Object.keys(peakCost) as Array<keyof BoardRenderCost>) peakCost[key] = Math.max(peakCost[key], sequenceCost[key]);
  }
  for (const key of Object.keys(DEFAULT_BOARD_RENDER_LIMITS) as Array<keyof BoardRenderCost>) {
    if (peakCost[key] <= DEFAULT_BOARD_RENDER_LIMITS[key]) continue;
    diagnostics.push({
      severity: "warning",
      code: "RENDER_BUDGET_EXCEEDED",
      message: `${key} peaks at ${peakCost[key]}, above ${DEFAULT_BOARD_RENDER_LIMITS[key]}`,
      path: key,
      adaptation: { quality: "lower" },
    });
  }
  return {
    valid: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    diagnostics,
    peakCost,
  };
}

export function contextualValidation(
  transaction: BoardTransaction,
  context: BoardValidationContext,
): BoardValidationResult {
  const result = structuralValidation(transaction);
  const diagnostics = [...result.diagnostics];
  const nodeIds = new Set(context.nodeIds);
  const effects = new Map([...context.effects].map((effect) => [effect.id, effect.target]));
  const sequences = new Map([...context.sequences].map((sequence) => [sequence.id, sequence.clips]));
  let boardMetadata = context.metadata ?? {};
  const error = (code: string, message: string, path: string) => {
    diagnostics.push({ severity: "error", code, message, path });
  };
  const targetExists = (target: BoardClip["target"], path: string) => {
    if (target.type === "node" && !nodeIds.has(target.nodeId)) error("INVALID_REFERENCE", `target node does not exist: ${target.nodeId}`, path);
    if (target.type === "effect" && !effects.has(target.effectId)) error("INVALID_REFERENCE", `target effect does not exist: ${target.effectId}`, path);
  };

  if (transaction.baseVersion !== context.boardVersion) {
    error("VERSION_CONFLICT", `expected Board version ${context.boardVersion}, received ${transaction.baseVersion}`, "baseVersion");
  }

  for (const [index, operation] of transaction.operations.entries()) {
    const path = `operations.${index}`;
    if (operation.type === "board.patch") {
      boardMetadata = operation.payload.patch.metadata ?? boardMetadata;
      continue;
    }
    if (operation.type === "node.create") {
      if (nodeIds.has(operation.payload.node.nodeId)) error("NODE_EXISTS", `node already exists: ${operation.payload.node.nodeId}`, `${path}.payload.node.nodeId`);
      if (operation.payload.node.parentId && !nodeIds.has(operation.payload.node.parentId)) {
        error("INVALID_REFERENCE", `parent node does not exist: ${operation.payload.node.parentId}`, `${path}.payload.node.parentId`);
      }
      nodeIds.add(operation.payload.node.nodeId);
      continue;
    }
    if (operation.type === "node.patch") {
      if (!nodeIds.has(operation.payload.nodeId)) error("NODE_NOT_FOUND", `node does not exist: ${operation.payload.nodeId}`, `${path}.payload.nodeId`);
      if (operation.payload.patch.parentId && !nodeIds.has(operation.payload.patch.parentId)) {
        error("INVALID_REFERENCE", `parent node does not exist: ${operation.payload.patch.parentId}`, `${path}.payload.patch.parentId`);
      }
      continue;
    }
    if (operation.type === "node.delete") {
      if (!nodeIds.has(operation.payload.nodeId)) error("NODE_NOT_FOUND", `node does not exist: ${operation.payload.nodeId}`, `${path}.payload.nodeId`);
      if ([...effects.values()].some((target) => target.type === "node" && target.nodeId === operation.payload.nodeId)) {
        error("NODE_REFERENCED", "delete node effects before deleting the node", `${path}.payload.nodeId`);
      }
      if ([...sequences.values()].flat().some((clip) => clip.target.type === "node" && clip.target.nodeId === operation.payload.nodeId)) {
        error("NODE_REFERENCED", "delete node clips before deleting the node", `${path}.payload.nodeId`);
      }
      nodeIds.delete(operation.payload.nodeId);
      continue;
    }
    if (operation.type === "effect.upsert") {
      const { effect } = operation.payload;
      if (effect.target.type === "node" && !nodeIds.has(effect.target.nodeId)) {
        error("INVALID_REFERENCE", `target node does not exist: ${effect.target.nodeId}`, `${path}.payload.effect.target`);
      }
      effects.set(effect.id, effect.target);
      continue;
    }
    if (operation.type === "effect.delete") {
      if (!effects.has(operation.payload.effectId)) error("EFFECT_NOT_FOUND", `effect does not exist: ${operation.payload.effectId}`, `${path}.payload.effectId`);
      if ([...sequences.values()].flat().some((clip) => clip.target.type === "effect" && clip.target.effectId === operation.payload.effectId)) {
        error("EFFECT_REFERENCED", "effect is referenced by a sequence", `${path}.payload.effectId`);
      }
      effects.delete(operation.payload.effectId);
      continue;
    }
    if (operation.type === "sequence.upsert") {
      for (const [clipIndex, clip] of operation.payload.clips.entries()) {
        targetExists(clip.target, `${path}.payload.clips.${clipIndex}.target`);
      }
      sequences.set(
        operation.payload.sequence.id,
        operation.payload.clips.map((clip) => ({
          ...clip,
          sequenceId: operation.payload.sequence.id,
        })),
      );
      continue;
    }
    if (operation.type === "sequence.delete") {
      if (!sequences.has(operation.payload.sequenceId)) error("SEQUENCE_NOT_FOUND", `sequence does not exist: ${operation.payload.sequenceId}`, `${path}.payload.sequenceId`);
      sequences.delete(operation.payload.sequenceId);
    }
  }

  const playbackPolicy = BoardPlaybackPolicySchema.safeParse(boardMetadata.playback);
  if (playbackPolicy.success && !sequences.has(playbackPolicy.data.sequenceId)) {
    error(
      "INVALID_REFERENCE",
      `playback sequence does not exist: ${playbackPolicy.data.sequenceId}`,
      "board.metadata.playback.sequenceId",
    );
  }

  return {
    valid: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    diagnostics,
    peakCost: result.peakCost,
  };
}
