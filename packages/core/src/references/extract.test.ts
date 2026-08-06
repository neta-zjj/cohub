import assert from "node:assert/strict";
import { test } from "node:test";
import type { ContentBlock } from "@cohub/protocol/core";
import { extractTurnReferences } from "./extract.js";
import { parseMentions } from "./mentions.js";
import { normalizeFilePath, fileTargetId, parseFileTargetId } from "./paths.js";

const SPACE = "11111111-1111-1111-1111-111111111111";
const SESSION = "22222222-2222-2222-2222-222222222222";
const TURN = "33333333-3333-3333-3333-333333333333";
const OTHER_SPACE = "44444444-4444-4444-4444-444444444444";
const OTHER_SESSION = "55555555-5555-5555-5555-555555555555";
const spaceMentionUri = (spaceId: string, sessionId?: string) =>
  sessionId
    ? `cohub://spaces/${spaceId}/sessions/${sessionId}`
    : `cohub://spaces/${spaceId}`;

test("parseMentions extracts space and session mentions", () => {
  const text = `See @[Core](${spaceMentionUri(OTHER_SPACE)}) and @[Fork](${spaceMentionUri(OTHER_SPACE, OTHER_SESSION)}).`;
  assert.deepEqual(parseMentions(text), [
    { spaceId: OTHER_SPACE, label: "Core" },
    { spaceId: OTHER_SPACE, sessionId: OTHER_SESSION, label: "Fork" },
  ]);
});

test("normalizeFilePath resolves, folds, and keeps absolute paths", () => {
  assert.equal(normalizeFilePath("README.md"), "/workspace/README.md");
  assert.equal(normalizeFilePath("./apps/api/../api/src/a.ts"), "/workspace/apps/api/src/a.ts");
  assert.equal(normalizeFilePath("/workspace/foo"), "/workspace/foo");
  assert.equal(normalizeFilePath("/tmp/out.log"), "/tmp/out.log");
  assert.equal(normalizeFilePath("src/"), "/workspace/src");
  assert.equal(normalizeFilePath("."), "/workspace");
  assert.equal(normalizeFilePath(""), "/workspace");
  assert.equal(normalizeFilePath("/workspace/../etc/passwd"), "/etc/passwd");
  assert.equal(normalizeFilePath(null), null);
  assert.equal(normalizeFilePath("bad\0path"), null);
  assert.equal(normalizeFilePath("a".repeat(2000)), null);
});

test("fileTargetId round-trips through parseFileTargetId", () => {
  const id = fileTargetId(SPACE, "/workspace/a.ts");
  assert.equal(id, `${SPACE}:/workspace/a.ts`);
  assert.deepEqual(parseFileTargetId(id), { spaceId: SPACE, path: "/workspace/a.ts" });
});

test("mentions in user content become turn-sourced edges, self-mention kept", () => {
  const userContent: ContentBlock[] = [
    {
      type: "text",
      text: `Look at @[Core](${spaceMentionUri(OTHER_SPACE)}) and @[Self](${spaceMentionUri(SPACE, SESSION)})`,
    },
  ];
  const refs = extractTurnReferences({
    spaceId: SPACE,
    sessionId: SESSION,
    turnId: TURN,
    userContent,
  });
  const mentions = refs.filter((r) => r.kind === "mention");
  // Full recording now: both the cross-space mention and the self-session one.
  assert.equal(mentions.length, 2);
  for (const m of mentions) {
    assert.equal(m.sourceType, "turn");
    assert.equal(m.sourceId, TURN);
  }
  assert.ok(mentions.some((m) => m.targetType === "space" && m.targetId === OTHER_SPACE));
  assert.ok(mentions.some((m) => m.targetType === "session" && m.targetId === SESSION));
});

test("repeated mention of the same target increments count", () => {
  const userContent: ContentBlock[] = [
    {
      type: "text",
      text: `@[A](${spaceMentionUri(OTHER_SPACE)}) then @[A again](${spaceMentionUri(OTHER_SPACE)})`,
    },
  ];
  const refs = extractTurnReferences({
    spaceId: SPACE,
    sessionId: SESSION,
    turnId: TURN,
    userContent,
  });
  const mentions = refs.filter((r) => r.kind === "mention");
  assert.equal(mentions.length, 1);
  assert.equal(mentions[0]?.count, 2);
});

test("tool calls are recorded in full, including self-space", () => {
  const assistantContent: ContentBlock[] = [
    { type: "tool_use", id: "t1", name: "space_sessions", input: { spaceId: OTHER_SPACE } },
    { type: "tool_use", id: "t3", name: "prompt", input: { spaceId: SPACE, sessionId: OTHER_SESSION } },
    { type: "tool_use", id: "t4", name: "space_self", input: { spaceId: SPACE } },
  ];
  const refs = extractTurnReferences({
    spaceId: SPACE,
    sessionId: SESSION,
    turnId: TURN,
    assistantContent,
  });
  const toolCalls = refs.filter((r) => r.kind === "tool_call");
  // t1 -> other space; t3 -> other session; t4 -> self space (now kept).
  assert.equal(toolCalls.length, 3);
  const targets = toolCalls.map((r) => `${r.targetType}:${r.targetId}`).sort();
  assert.deepEqual(
    targets,
    [`session:${OTHER_SESSION}`, `space:${OTHER_SPACE}`, `space:${SPACE}`].sort(),
  );
});

test("filesystem tools become file_* edges with normalized {spaceId}:path targets", () => {
  const assistantContent: ContentBlock[] = [
    { type: "tool_use", id: "r1", name: "read", input: { path: "README.md" } },
    { type: "tool_use", id: "w1", name: "write", input: { path: "/tmp/out.log" } },
    { type: "tool_use", id: "e1", name: "edit", input: { path: "./src/a.ts" } },
    { type: "tool_use", id: "l1", name: "ls", input: {} },
    { type: "tool_use", id: "x1", name: "read", input: { path: "docs/x.md", space_id: OTHER_SPACE } },
  ];
  const refs = extractTurnReferences({
    spaceId: SPACE,
    sessionId: SESSION,
    turnId: TURN,
    assistantContent,
  });
  const byKind = new Map(refs.map((r) => [`${r.kind}|${r.targetId}`, r]));

  assert.ok(byKind.has(`agent_tool_file_read|${SPACE}:/workspace/README.md`));
  assert.ok(byKind.has(`agent_tool_file_write|${SPACE}:/tmp/out.log`));
  assert.ok(byKind.has(`agent_tool_file_edit|${SPACE}:/workspace/src/a.ts`));
  // ls with no path defaults to the workspace root.
  assert.ok(byKind.has(`agent_tool_file_ls|${SPACE}:/workspace`));
  // cross-space read carries the other space in the target id and meta.
  const crossRead = byKind.get(`agent_tool_file_read|${OTHER_SPACE}:/workspace/docs/x.md`);
  assert.ok(crossRead);
  assert.equal(crossRead?.meta?.targetSpaceId, OTHER_SPACE);

  for (const ref of refs) {
    assert.equal(ref.sourceType, "turn");
    assert.equal(ref.sourceId, TURN);
    assert.equal(ref.sourceSpaceId, SPACE);
    assert.equal(ref.sourceSessionId, SESSION);
  }
});

test("repeated file access to the same path within a turn increments count", () => {
  const assistantContent: ContentBlock[] = [
    { type: "tool_use", id: "r1", name: "read", input: { path: "a.ts" } },
    { type: "tool_use", id: "r2", name: "read", input: { path: "./a.ts" } },
  ];
  const refs = extractTurnReferences({
    spaceId: SPACE,
    sessionId: SESSION,
    turnId: TURN,
    assistantContent,
  });
  const reads = refs.filter((r) => r.kind === "agent_tool_file_read");
  assert.equal(reads.length, 1);
  assert.equal(reads[0]?.count, 2);
});

test("extraction is deterministic and combines all signals", () => {
  const source = {
    spaceId: SPACE,
    sessionId: SESSION,
    turnId: TURN,
    userContent: [
      { type: "text", text: `@[Core](${spaceMentionUri(OTHER_SPACE)})` },
    ] as ContentBlock[],
    assistantContent: [
      { type: "tool_use", id: "t1", name: "space_sessions", input: { sessionId: OTHER_SESSION } },
      { type: "tool_use", id: "r1", name: "read", input: { path: "a.ts" } },
    ] as ContentBlock[],
  };
  const a = extractTurnReferences(source);
  const b = extractTurnReferences(source);
  assert.deepEqual(a, b);
  const kinds = a.map((r) => r.kind).sort();
  assert.deepEqual(kinds, ["agent_tool_file_read", "mention", "tool_call"].sort());
});
