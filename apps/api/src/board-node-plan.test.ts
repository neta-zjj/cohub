import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardNodeInput, BoardOperation } from "@cohub/protocol";
import {
  collectTouchedNodeIds,
  type ExistingNodeRow,
  planNodeWrites,
} from "./board-node-plan.js";
import { BoardServiceError, normalizeBoardOperation } from "./board-ops.js";

function node(nodeId: string, overrides: Partial<BoardNodeInput> = {}): BoardNodeInput {
  return {
    nodeId,
    type: "file",
    parentId: null,
    orderKey: "00004096",
    x: 0,
    y: 0,
    width: 240,
    height: 160,
    rotation: 0,
    refKind: "space-file",
    refPath: `docs/${nodeId}.md`,
    refUrl: null,
    view: {},
    style: {},
    data: {},
    ...overrides,
  };
}

function existing(
  nodeId: string,
  overrides: Partial<ExistingNodeRow> = {},
): ExistingNodeRow {
  return { ...node(nodeId), deleted: false, ...overrides };
}

function context(rows: ExistingNodeRow[] = []) {
  return { existing: new Map(rows.map((row) => [row.nodeId, row])) };
}

const op = (value: BoardOperation) => normalizeBoardOperation(value);

test("plans a create as a new row", () => {
  const plan = planNodeWrites(
    [op({ type: "node.create", payload: { node: node("a") } })],
    context(),
  );
  assert.equal(plan.writes.length, 1);
  assert.equal(plan.writes[0]?.isNew, true);
  assert.equal(plan.writes[0]?.deleted, false);
  assert.equal(plan.writes[0]?.fields.refPath, "docs/a.md");
  // Undo of a create is a delete.
  assert.deepEqual(plan.journal.get(0)?.inverse, {
    type: "node.delete",
    payload: { nodeId: "a" },
  });
});

test("a patch keeps unpatched fields and inverts to the previous values", () => {
  const plan = planNodeWrites(
    [op({ type: "node.patch", payload: { nodeId: "a", patch: { x: 50 } } })],
    context([existing("a", { x: 10, y: 20 })]),
  );
  const write = plan.writes[0];
  assert.equal(write?.isNew, false);
  assert.equal(write?.fields.x, 50);
  // Untouched fields survive: the planner writes whole rows, so losing one here
  // would silently reset it in the database.
  assert.equal(write?.fields.y, 20);
  assert.equal(write?.fields.refPath, "docs/a.md");
  assert.deepEqual(plan.journal.get(0)?.inverse, {
    type: "node.patch",
    payload: { nodeId: "a", patch: { x: 10 } },
  });
});

test("a delete is a soft delete whose inverse restores the whole row", () => {
  const plan = planNodeWrites(
    [op({ type: "node.delete", payload: { nodeId: "a" } })],
    context([existing("a", { x: 7 })]),
  );
  assert.equal(plan.writes[0]?.deleted, true);
  const inverse = plan.journal.get(0)?.inverse as { type: string; payload: { node: BoardNodeInput } };
  assert.equal(inverse.type, "node.create");
  assert.equal(inverse.payload.node.x, 7);
  assert.equal(inverse.payload.node.refPath, "docs/a.md");
});

test("operations fold in order within one transaction", () => {
  // create → patch → the row must end up with the patch applied, once.
  const plan = planNodeWrites(
    [
      op({ type: "node.create", payload: { node: node("a", { x: 1 }) } }),
      op({ type: "node.patch", payload: { nodeId: "a", patch: { x: 99 } } }),
    ],
    context(),
  );
  assert.equal(plan.writes.length, 1, "one row touched, so one write");
  assert.equal(plan.writes[0]?.fields.x, 99);
  assert.equal(plan.writes[0]?.isNew, true);
  // The patch's inverse must see the value the create wrote, not a stale one.
  assert.deepEqual(plan.journal.get(1)?.inverse, {
    type: "node.patch",
    payload: { nodeId: "a", patch: { x: 1 } },
  });
});

test("create then delete in one transaction ends deleted", () => {
  const plan = planNodeWrites(
    [
      op({ type: "node.create", payload: { node: node("a") } }),
      op({ type: "node.delete", payload: { nodeId: "a" } }),
    ],
    context(),
  );
  assert.equal(plan.writes.length, 1);
  assert.equal(plan.writes[0]?.deleted, true);
});

test("recreating a soft-deleted node revives the existing row", () => {
  const plan = planNodeWrites(
    [op({ type: "node.create", payload: { node: node("a", { x: 5 }) } })],
    context([existing("a", { deleted: true })]),
  );
  assert.equal(plan.writes[0]?.deleted, false);
  // Not a new row: an insert would violate the (boardId, nodeId) unique index.
  assert.equal(plan.writes[0]?.isNew, false);
  assert.equal(plan.writes[0]?.fields.x, 5);
});

test("creating a node that already exists is rejected", () => {
  assert.throws(
    () =>
      planNodeWrites(
        [op({ type: "node.create", payload: { node: node("a") } })],
        context([existing("a")]),
      ),
    (error: unknown) =>
      error instanceof BoardServiceError && error.code === "NODE_EXISTS",
  );
});

test("patching a missing or deleted node is rejected", () => {
  const patch = op({ type: "node.patch", payload: { nodeId: "a", patch: { x: 1 } } });
  for (const ctx of [context(), context([existing("a", { deleted: true })])]) {
    assert.throws(
      () => planNodeWrites([patch], ctx),
      (error: unknown) =>
        error instanceof BoardServiceError && error.code === "NODE_NOT_FOUND",
    );
  }
});

test("deleting a node twice is rejected", () => {
  assert.throws(
    () =>
      planNodeWrites(
        [
          op({ type: "node.delete", payload: { nodeId: "a" } }),
          op({ type: "node.delete", payload: { nodeId: "a" } }),
        ],
        context([existing("a")]),
      ),
    (error: unknown) =>
      error instanceof BoardServiceError && error.code === "NODE_NOT_FOUND",
  );
});

test("a parent must exist and not be deleted", () => {
  const create = op({
    type: "node.create",
    payload: { node: node("child", { parentId: "missing" }) },
  });
  assert.throws(
    () => planNodeWrites([create], context()),
    (error: unknown) =>
      error instanceof BoardServiceError && error.code === "INVALID_REFERENCE",
  );
  assert.throws(
    () => planNodeWrites([create], context([existing("missing", { deleted: true })])),
    (error: unknown) =>
      error instanceof BoardServiceError && error.code === "INVALID_REFERENCE",
  );
  // A parent created earlier in the same transaction is a valid target.
  const plan = planNodeWrites(
    [
      op({ type: "node.create", payload: { node: node("parent") } }),
      op({ type: "node.create", payload: { node: node("child", { parentId: "parent" }) } }),
    ],
    context(),
  );
  assert.equal(plan.writes.length, 2);
});

test("non-node operations are left for the caller", () => {
  const plan = planNodeWrites(
    [
      op({ type: "board.patch", payload: { patch: { title: "T" } } }),
      op({ type: "node.patch", payload: { nodeId: "a", patch: { x: 1 } } }),
    ],
    context([existing("a")]),
  );
  // Journal is keyed by operation index, so index 0 stays with the caller and the
  // node operation keeps its position in the transaction's order.
  assert.equal(plan.journal.has(0), false);
  assert.equal(plan.journal.has(1), true);
});

test("a bulk delete collapses to one write per node", () => {
  const rows = Array.from({ length: 2000 }, (_, index) => existing(`n${index}`));
  const ops = rows.map((row) =>
    op({ type: "node.delete", payload: { nodeId: row.nodeId } }),
  );
  const plan = planNodeWrites(ops, context(rows));
  assert.equal(plan.writes.length, 2000);
  assert.equal(plan.journal.size, 2000);
  assert.ok(plan.writes.every((write) => write.deleted));
});

test("touched ids include patch and create parents, for the prefetch", () => {
  const ids = collectTouchedNodeIds([
    op({ type: "node.create", payload: { node: node("a", { parentId: "p1" }) } }),
    op({ type: "node.patch", payload: { nodeId: "b", patch: { parentId: "p2" } } }),
    op({ type: "node.delete", payload: { nodeId: "c" } }),
    op({ type: "board.patch", payload: { patch: { title: "T" } } }),
  ]);
  assert.deepEqual([...ids].sort(), ["a", "b", "c", "p1", "p2"]);
});
