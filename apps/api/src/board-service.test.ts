import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BoardCreateInputSchema,
  BoardInspectInputSchema,
  BoardPlaybackCommandSchema,
  type BoardOperation,
} from "@cohub/protocol";
import {
  BoardServiceError,
  contextualValidation,
  normalizeBoardOperation,
  normalizeBoardTransaction,
  normalizeNodes,
  normalizePlaybackPosition,
  structuralValidation,
  MAX_BOARD_NODES,
  NODE_WRITE_CHUNK,
} from "./board-ops.js";

const boardId = "11111111-1111-4111-8111-111111111111";

function operation(value: BoardOperation) {
  return normalizeBoardOperation(value);
}

test("normalizes Board metadata and title", () => {
  assert.deepEqual(operation({
    opId: "patch-1",
    type: "board.patch",
    payload: { patch: { title: "  Battle  ", metadata: { theme: "night" } } },
  }), {
    opId: "patch-1",
    type: "board.patch",
    payload: { patch: { title: "Battle", metadata: { theme: "night" } } },
  });
});

test("validates selective viewport inspection", () => {
  assert.deepEqual(BoardInspectInputSchema.parse({
    include: ["nodes", "effects"],
    viewport: { x: -100, y: -50, width: 200, height: 100 },
  }), {
    include: ["nodes", "effects"],
    viewport: { x: -100, y: -50, width: 200, height: 100 },
  });
  assert.equal(BoardInspectInputSchema.safeParse({
    viewport: { x: 0, y: 0, width: 0, height: 100 },
  }).success, false);
});

test("rejects malformed playback commands before persistence", () => {
  assert.equal(BoardPlaybackCommandSchema.safeParse({
    commandId: "seek-1",
    type: "seek",
    playbackId: "22222222-2222-4222-8222-222222222222",
    position: Number.NaN,
  }).success, false);
  assert.equal(BoardPlaybackCommandSchema.safeParse({
    commandId: "unknown-1",
    type: "rewind",
    playbackId: "22222222-2222-4222-8222-222222222222",
  }).success, false);
});

test("normalizes shared playback positions", () => {
  assert.equal(normalizePlaybackPosition(1_250, 1_000), 1_000);
  assert.equal(normalizePlaybackPosition(-250, 1_000), 0);
  assert.equal(normalizePlaybackPosition(250, 0), 0);
});

test("requires an exact base version", () => {
  assert.throws(
    () => normalizeBoardTransaction({ txId: "tx-1", boardId, operations: [{ type: "node.delete", payload: { nodeId: "n1" } }] }),
    (error) => error instanceof BoardServiceError && error.status === 400,
  );
  assert.equal(normalizeBoardTransaction({
    txId: "tx-1",
    boardId,
    baseVersion: 0,
    operations: [{ type: "node.delete", payload: { nodeId: "n1" } }],
  }).baseVersion, 0);
});

test("allows data URLs and ordinary js fields while rejecting executable source", () => {
  const node = {
    nodeId: "n1",
    type: "image",
    parentId: null,
    orderKey: null,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    refKind: null,
    refPath: null,
    refUrl: null,
    view: {},
    style: {},
    data: { source: "https://cdn.example/image.png", js: "business-value" },
  };
  assert.deepEqual(
    operation({ type: "node.create", payload: { node } }).payload,
    { node },
  );
  assert.doesNotThrow(() => operation({
    type: "board.patch",
    payload: {
      patch: {
        metadata: {
          appearance: {
            background: { kind: "image", imageUrl: "https://cdn.example/background.png" },
          },
        },
      },
    },
  }));
  assert.throws(
    () => operation({ type: "board.patch", payload: { patch: { metadata: { wgsl: "@fragment fn main() {}" } } } }),
    (error) => error instanceof BoardServiceError && error.code === "UNTRUSTED_CODE",
  );
});

test("validates Board create input before side effects", () => {
  assert.equal(BoardCreateInputSchema.safeParse({ path: "battle.board", title: 42 }).success, false);
  assert.equal(BoardCreateInputSchema.safeParse({ path: "battle.board", effects: {} }).success, false);
  assert.equal(BoardCreateInputSchema.safeParse({ path: "battle.board", sequences: {} }).success, false);
  assert.equal(BoardCreateInputSchema.safeParse({ path: "battle.board" }).success, true);
  assert.equal(BoardCreateInputSchema.safeParse({ path: "battle.board", mutationId: "mutation-1" }).success, true);
  assert.equal(BoardCreateInputSchema.safeParse({ path: "battle.board", mutationId: "x".repeat(129) }).success, false);
});

test("rejects clips outside their sequence", () => {
  assert.throws(
    () => operation({
      type: "sequence.upsert",
      payload: {
        sequence: { id: "fight", name: "Fight", duration: 100, seed: "seed", restPose: {}, metadata: {} },
        clips: [{
          id: "impact",
          kind: "effects.impact",
          kindVersion: 1,
          target: { type: "board" },
          start: 90,
          duration: 20,
          layer: "front",
          fill: "none",
          easing: "linear",
          params: {},
          keyframes: [],
          assetRefs: [],
          seed: "impact",
          metadata: {},
        }],
      },
    }),
    (error) => error instanceof BoardServiceError && error.status === 400,
  );
});

test("validates Board playback metadata and its final sequence reference", () => {
  assert.throws(
    () => operation({
      type: "board.patch",
      payload: {
        patch: {
          metadata: {
            playback: {
              sequenceId: "ambient",
              loop: "forever",
            },
          },
        },
      },
    }),
    (error) => error instanceof BoardServiceError && error.code === "INVALID_PLAYBACK_POLICY",
  );

  const transaction = normalizeBoardTransaction({
    txId: "tx-autoplay",
    boardId,
    baseVersion: 0,
    operations: [
      {
        type: "board.patch",
        payload: {
          patch: {
            metadata: {
              playback: {
                sequenceId: "ambient",
                delayMs: 250,
                loop: true,
              },
            },
          },
        },
      },
      {
        type: "sequence.upsert",
        payload: {
          sequence: {
            id: "ambient",
            name: "Ambient",
            duration: 1_000,
            seed: "ambient",
            restPose: {},
            metadata: {},
          },
          clips: [],
        },
      },
    ],
  });
  const context = {
    boardVersion: 0,
    metadata: {},
    nodeIds: [],
    effects: [],
    sequences: [],
  };
  assert.deepEqual(errorsOf(contextualValidation(transaction, context)), []);

  const missingSequence = normalizeBoardTransaction({
    ...transaction,
    txId: "tx-missing-autoplay",
    operations: transaction.operations.slice(0, 1),
  });
  assert.deepEqual(
    errorsOf(contextualValidation(missingSequence, context)),
    ["INVALID_REFERENCE"],
  );
});

test("requires bounded deterministic particle clips", () => {
  const sequence = {
    id: "fight",
    name: "Fight",
    duration: 1_000,
    seed: "seed",
    restPose: {},
    metadata: {},
  };
  const particleClip = {
    id: "sparks",
    kind: "effects.particles",
    kindVersion: 1,
    target: { type: "board" as const },
    start: 0,
    duration: 800,
    layer: "front" as const,
    fill: "none" as const,
    easing: "linear",
    params: { count: 420 },
    keyframes: [],
    assetRefs: [],
    seed: "sparks",
    metadata: {},
  };
  assert.throws(
    () => operation({ type: "sequence.upsert", payload: { sequence, clips: [particleClip] } }),
    (error) => error instanceof BoardServiceError && error.status === 400,
  );

  const transaction = normalizeBoardTransaction({
    txId: "tx-particles",
    boardId,
    baseVersion: 0,
    operations: [{
      type: "sequence.upsert",
      payload: {
        sequence,
        clips: [{
          ...particleClip,
          params: { count: 420, bounds: { x: -200, y: -100, width: 400, height: 200 } },
        }],
      },
    }],
  });
  assert.equal(structuralValidation(transaction).peakCost.particles, 420);
});

test("contextual validation simulates operation order and references", () => {
  const transaction = normalizeBoardTransaction({
    txId: "tx-context",
    boardId,
    baseVersion: 2,
    operations: [
      {
        type: "effect.upsert",
        payload: {
          effect: {
            id: "pulse",
            target: { type: "node", nodeId: "created-first" },
            kind: "effects.pulse",
            kindVersion: 1,
            enabled: true,
            lifecycle: "persistent",
            timeOrigin: "board",
            layer: "front",
            seed: "pulse",
            params: {},
            assetRefs: [],
            metadata: {},
          },
        },
      },
      {
        type: "node.create",
        payload: {
          node: {
            nodeId: "created-first",
            type: "text",
            parentId: null,
            orderKey: null,
            x: 0,
            y: 0,
            width: 100,
            height: 40,
            rotation: 0,
            refKind: null,
            refPath: null,
            refUrl: null,
            view: {},
            style: {},
            data: {},
          },
        },
      },
    ],
  });
  const validation = contextualValidation(transaction, {
    boardVersion: 3,
    nodeIds: [],
    effects: [],
    sequences: [],
  });
  assert.equal(validation.valid, false);
  assert.deepEqual(
    validation.diagnostics.filter((diagnostic) => diagnostic.severity === "error").map((diagnostic) => diagnostic.code),
    ["VERSION_CONFLICT", "INVALID_REFERENCE"],
  );
});

test("requires extension asset digests", () => {
  assert.throws(
    () => operation({
      type: "effect.upsert",
      payload: {
        effect: {
          id: "aura",
          target: { type: "board" },
          kind: "effects.particles",
          kindVersion: 1,
          enabled: true,
          lifecycle: "persistent",
          timeOrigin: "board",
          layer: "front",
          seed: "aura",
          params: {},
          assetRefs: [{ type: "extension", ref: "effects/aura" }],
          metadata: {},
        },
      },
    }),
    (error) => error instanceof BoardServiceError && error.status === 400,
  );
});

/**
 * Reference integrity across entity kinds is validated once, up front, against a
 * simulation of the whole transaction. These cases are the reason it lives there
 * and not in the apply path: each one is only legal *because* of the order its
 * operations appear in, so any check reading a pre-transaction snapshot rejects it.
 */

function nodeInput(nodeId: string) {
  return {
    nodeId,
    type: "test-shape",
    parentId: null,
    orderKey: null,
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    rotation: 0,
    refKind: null,
    refPath: null,
    refUrl: null,
    view: {},
    style: {},
    data: {},
  };
}

function effectInput(id: string, nodeId: string) {
  return {
    id,
    kind: "effects.pulse",
    kindVersion: 1,
    target: { type: "node" as const, nodeId },
    params: {},
    lifecycle: "persistent" as const,
    timeOrigin: "board" as const,
    seed: "seed-1",
    revision: 0,
  };
}

function errorsOf(validation: { diagnostics: Array<{ severity: string; code: string }> }) {
  return validation.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => diagnostic.code);
}

test("an effect may target a node created earlier in the same transaction", () => {
  const transaction = normalizeBoardTransaction({
    txId: "tx-order-1",
    boardId,
    baseVersion: 0,
    operations: [
      { type: "node.create", payload: { node: nodeInput("fresh") } },
      { type: "effect.upsert", payload: { effect: effectInput("fx", "fresh") } },
    ],
  });
  const validation = contextualValidation(transaction, {
    boardVersion: 0,
    nodeIds: [],
    effects: [],
    sequences: [],
  });
  assert.deepEqual(errorsOf(validation), []);
});

test("a node becomes deletable once the effect referencing it is deleted", () => {
  const transaction = normalizeBoardTransaction({
    txId: "tx-order-2",
    boardId,
    baseVersion: 0,
    operations: [
      { type: "effect.delete", payload: { effectId: "fx" } },
      { type: "node.delete", payload: { nodeId: "pinned" } },
    ],
  });
  const validation = contextualValidation(transaction, {
    boardVersion: 0,
    nodeIds: ["pinned"],
    effects: [effectInput("fx", "pinned")],
    sequences: [],
  });
  assert.deepEqual(errorsOf(validation), []);
  // The same two operations in the opposite order are still correctly refused.
  const reversed = normalizeBoardTransaction({
    txId: "tx-order-3",
    boardId,
    baseVersion: 0,
    operations: [
      { type: "node.delete", payload: { nodeId: "pinned" } },
      { type: "effect.delete", payload: { effectId: "fx" } },
    ],
  });
  assert.deepEqual(
    errorsOf(contextualValidation(reversed, {
      boardVersion: 0,
      nodeIds: ["pinned"],
      effects: [effectInput("fx", "pinned")],
      sequences: [],
    })),
    ["NODE_REFERENCED"],
  );
});

test("board nodes are bounded by bytes, not only by count", () => {
  // A node carries free-form view/style/data, so a legal count says nothing about
  // the size of the request behind it.
  const fat = (index: number) => ({
    ...nodeInput(`n${index}`),
    data: { blob: "x".repeat(64 * 1024) },
  });
  assert.throws(
    () => normalizeNodes(Array.from({ length: 600 }, (_, index) => fat(index))),
    (error: unknown) =>
      error instanceof BoardServiceError && error.status === 413,
  );
  // A count above the cap is still refused on count alone.
  assert.throws(
    () => normalizeNodes(Array.from({ length: MAX_BOARD_NODES + 1 }, (_, i) => nodeInput(`n${i}`))),
    (error: unknown) =>
      error instanceof BoardServiceError && error.status === 413,
  );
});

test("a node write chunk cannot exceed Postgres's bind parameter limit", () => {
  // A node row binds ~18 parameters; the ceiling is 65535 per statement.
  const PARAMS_PER_ROW = 20;
  const POSTGRES_MAX_BIND_PARAMS = 65535;
  assert.ok(
    NODE_WRITE_CHUNK * PARAMS_PER_ROW < POSTGRES_MAX_BIND_PARAMS,
    `${NODE_WRITE_CHUNK} rows per statement is too many`,
  );
});
