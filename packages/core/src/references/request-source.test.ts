import assert from "node:assert/strict";
import { test } from "node:test";
import { crossSpaceRequestReference } from "./request-source.js";

const SPACE_A = "11111111-1111-1111-1111-111111111111";
const SPACE_B = "44444444-4444-4444-4444-444444444444";
const SESSION = "22222222-2222-2222-2222-222222222222";
const TURN = "33333333-3333-3333-3333-333333333333";
const TOOL = "66666666-6666-6666-6666-666666666666";

test("skips when source is missing, same-space, or lacks turn", () => {
  assert.equal(
    crossSpaceRequestReference({
      requestSource: { via: "cli" },
      targetSpaceId: SPACE_B,
    }),
    null,
  );
  assert.equal(
    crossSpaceRequestReference({
      requestSource: { spaceId: SPACE_B, turnId: TURN, via: "cli" },
      targetSpaceId: SPACE_B,
    }),
    null,
  );
  assert.equal(
    crossSpaceRequestReference({
      requestSource: { spaceId: SPACE_A },
      targetSpaceId: "not-a-uuid",
    }),
    null,
  );
  assert.equal(
    crossSpaceRequestReference({
      requestSource: { spaceId: SPACE_A, via: "cli" },
      targetSpaceId: SPACE_B,
    }),
    null,
  );
  assert.equal(
    crossSpaceRequestReference({
      requestSource: { spaceId: SPACE_A, sessionId: SESSION, via: "cli" },
      targetSpaceId: SPACE_B,
    }),
    null,
  );
});

test("builds an incrementing turn-sourced edge with route meta", () => {
  const ref = crossSpaceRequestReference({
    requestSource: {
      spaceId: SPACE_A,
      sessionId: SESSION,
      turnId: TURN,
      toolCallId: TOOL,
      via: "cli",
    },
    targetSpaceId: SPACE_B,
    route: {
      method: "post",
      path: `/api/spaces/${SPACE_B}/prompt`,
      pattern: "/:id/prompt",
    },
  });
  assert.ok(ref);
  assert.equal(ref.kind, "tool_call");
  assert.equal(ref.sourceType, "turn");
  assert.equal(ref.sourceId, TURN);
  assert.equal(ref.sourceSpaceId, SPACE_A);
  assert.equal(ref.sourceSessionId, SESSION);
  assert.equal(ref.targetType, "space");
  assert.equal(ref.targetId, SPACE_B);
  assert.equal(ref.count, 1);
  assert.equal(ref.countMode, "increment");
  assert.deepEqual(ref.meta, {
    via: "cli",
    toolCallId: TOOL,
    method: "POST",
    path: `/api/spaces/${SPACE_B}/prompt`,
    pattern: "/:id/prompt",
  });
});

test("defaults via and is deterministic", () => {
  const input = {
    requestSource: {
      spaceId: SPACE_A,
      sessionId: SESSION,
      turnId: TURN,
    },
    targetSpaceId: SPACE_B,
    route: { method: "GET", path: `/api/spaces/${SPACE_B}`, pattern: "/:id" },
  };
  const ref = crossSpaceRequestReference(input);
  assert.equal(ref?.meta?.via, "cli");
  assert.equal(ref?.meta?.method, "GET");
  assert.equal(ref?.countMode, "increment");
  assert.deepEqual(ref, crossSpaceRequestReference(input));
});
