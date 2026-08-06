import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ContentBlock } from "@cohub/protocol/core";
import type { SessionStreamEvent } from "@cohub/protocol/realtime";
import { buildPatchOpsForContentDelta } from "../stream/patch-delta.js";

function event(input: {
  spaceId: string;
  sessionId: string;
  turnId: string;
  sourceMessageId: string;
  seq: number;
  baseSeq: number;
  content: ContentBlock[];
}): SessionStreamEvent {
  return {
    type: "stream_update",
    spaceId: input.spaceId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    seq: input.seq,
    baseSeq: input.baseSeq,
    content: input.content,
    snapshotContent: input.content,
    sourceMessageId: input.sourceMessageId,
    timestamp: Date.now(),
  };
}

function runningTool(partialResult: string): ContentBlock {
  return {
    type: "tool_use",
    id: "tool-partial",
    name: "bash",
    input: { command: "pnpm test" },
    _meta: {
      streamIndex: 0,
      toolStatus: "running",
      partialResult,
    },
  };
}

{
  const spaceId = randomUUID();
  const sessionId = randomUUID();
  const turnId = randomUUID();
  const sourceMessageId = randomUUID();
  buildPatchOpsForContentDelta(
    event({
      spaceId,
      sessionId,
      turnId,
      sourceMessageId,
      seq: 1,
      baseSeq: 0,
      content: [runningTool("line 1")],
    }),
  );

  const appendOps = buildPatchOpsForContentDelta(
    event({
      spaceId,
      sessionId,
      turnId,
      sourceMessageId,
      seq: 2,
      baseSeq: 1,
      content: [runningTool("line 1\nline 2")],
    }),
  );

  assert.deepEqual(appendOps, [
    {
      o: "append",
      p: "/message/content/blocks/0/_meta/partialResult",
      v: "\nline 2",
    },
  ]);

  const replaceOps = buildPatchOpsForContentDelta(
    event({
      spaceId,
      sessionId,
      turnId,
      sourceMessageId,
      seq: 3,
      baseSeq: 2,
      content: [runningTool("reset")],
    }),
  );

  assert.deepEqual(replaceOps, [
    {
      o: "replace",
      p: "/message/content/blocks/0/_meta/partialResult",
      v: "reset",
    },
  ]);
}
