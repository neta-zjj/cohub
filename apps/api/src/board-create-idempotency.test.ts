import assert from "node:assert/strict";
import test from "node:test";
import { buildBoardCreateIdentity } from "./board-create-idempotency.js";

const input = {
  spaceId: "space-1",
  mutationId: "mutation-1",
  payload: {
    path: "plan.board",
    metadata: { z: 1, a: 2 },
    nodes: [{ id: "node-1", x: 1 }],
  },
};

test("Board create identity is stable across equivalent object key order", () => {
  const first = buildBoardCreateIdentity(input);
  const second = buildBoardCreateIdentity({
    ...input,
    payload: {
      nodes: [{ x: 1, id: "node-1" }],
      metadata: { a: 2, z: 1 },
      path: "plan.board",
    },
  });

  assert.deepEqual(second, first);
  assert.match(first?.boardId ?? "", /^[0-9a-f-]{36}$/);
  assert.notEqual(first?.boardId, first?.transactionId);
});

test("Board create identity changes when the request payload changes", () => {
  const first = buildBoardCreateIdentity(input);
  const changed = buildBoardCreateIdentity({
    ...input,
    payload: { ...input.payload, path: "other.board" },
  });

  assert.notEqual(changed?.boardId, first?.boardId);
  assert.equal(buildBoardCreateIdentity({ ...input, mutationId: undefined }), null);
});
