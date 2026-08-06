import assert from "node:assert/strict";
import type { ContentBlock } from "@cohub/protocol/core";
import {
  applyAssistantMessageEvent,
  applyToolExecutionEnd,
  applyToolExecutionStart,
  applyToolExecutionUpdate,
  createAssistantStreamState,
  mergeFinalAssistantContentWithStreamOrder,
  projectAssistantStreamState,
} from "../stream/assistant-stream-state.js";

{
  let state = createAssistantStreamState();
  state = applyAssistantMessageEvent(state, {
    type: "toolcall_start",
    contentIndex: 0,
    partial: {
      content: [{ type: "toolCall", id: "t0", name: "read", arguments: { path: "/tmp/early" } }],
    },
  });

  const content = projectAssistantStreamState(state);
  assert.deepEqual(
    content.map((block) => block.type),
    ["tool_use"],
    "should project tool_use early when partial already contains toolCall details",
  );
  const toolUse = content[0] as Extract<ContentBlock, { type: "tool_use" }>;
  assert.equal(toolUse.id, "t0");
  assert.equal(toolUse.name, "read");
  assert.deepEqual(toolUse.input, { path: "/tmp/early" });
}

{
  let state = createAssistantStreamState();
  state = applyAssistantMessageEvent(state, { type: "toolcall_start", contentIndex: 0 });

  const content = projectAssistantStreamState(state);
  assert.deepEqual(content, [], "should not project empty shell tool_use blocks");
}

{
  let state = createAssistantStreamState();
  state = applyAssistantMessageEvent(state, { type: "thinking_start", contentIndex: 0 });
  state = applyAssistantMessageEvent(state, { type: "thinking_delta", contentIndex: 0, delta: "need " });
  state = applyAssistantMessageEvent(state, { type: "thinking_delta", contentIndex: 0, delta: "files" });
  state = applyAssistantMessageEvent(state, {
    type: "thinking_end",
    contentIndex: 0,
    content: "need files",
  });
  state = applyAssistantMessageEvent(state, { type: "text_start", contentIndex: 1 });
  state = applyAssistantMessageEvent(state, { type: "text_delta", contentIndex: 1, delta: "hello" });
  state = applyAssistantMessageEvent(state, { type: "text_end", contentIndex: 1, content: "hello" });
  state = applyAssistantMessageEvent(state, { type: "text_start", contentIndex: 2 });
  state = applyAssistantMessageEvent(state, { type: "text_delta", contentIndex: 2, delta: "world" });
  state = applyAssistantMessageEvent(state, { type: "text_end", contentIndex: 2, content: "world" });

  const content = projectAssistantStreamState(state);
  assert.deepEqual(
    content.map((block) => block.type),
    ["thinking", "text", "text"],
    "should preserve multiple text blocks and ordering",
  );
  assert.equal((content[0] as Extract<ContentBlock, { type: "thinking" }>).thinking, "need files");
  assert.equal((content[1] as Extract<ContentBlock, { type: "text" }>).text, "hello");
  assert.equal((content[2] as Extract<ContentBlock, { type: "text" }>).text, "world");
}

{
  let state = createAssistantStreamState();
  state = applyAssistantMessageEvent(state, { type: "toolcall_start", contentIndex: 0 });
  state = applyToolExecutionStart(state, { toolCallId: "t1", summary: "/tmp/a" });
  state = applyAssistantMessageEvent(state, {
    type: "toolcall_end",
    contentIndex: 0,
    toolCall: { id: "t1", name: "read", arguments: { path: "/tmp/a" } },
  });
  state = applyToolExecutionEnd(state, { toolCallId: "t1", content: "file content", isError: false });

  const content = projectAssistantStreamState(state);
  assert.deepEqual(
    content.map((block) => block.type),
    ["tool_use", "tool_result"],
    "should insert tool_result directly after tool_use",
  );
  const toolUse = content[0] as Extract<ContentBlock, { type: "tool_use" }>;
  const toolResult = content[1] as Extract<ContentBlock, { type: "tool_result" }>;
  assert.equal(toolUse._meta?.toolStatus, "done");
  assert.equal(toolUse._meta?.summary, "/tmp/a");
  assert.equal(toolUse._meta?.streamIndex, 0);
  assert.equal(toolResult.content, "file content");
  assert.equal(toolResult._meta?.streamIndex, 0);
}

{
  let state = createAssistantStreamState();
  state = applyToolExecutionStart(state, { toolCallId: "t2", summary: "/tmp/b" });
  state = applyAssistantMessageEvent(state, {
    type: "toolcall_end",
    contentIndex: 1,
    toolCall: { id: "t2", name: "read", arguments: { path: "/tmp/b" } },
  });
  state = applyToolExecutionEnd(state, { toolCallId: "t2", content: "boom", isError: true });

  const content = projectAssistantStreamState(state);
  const toolUse = content.find((block) => block.type === "tool_use") as Extract<ContentBlock, { type: "tool_use" }>;
  const toolResult = content.find((block) => block.type === "tool_result") as Extract<ContentBlock, { type: "tool_result" }>;
  assert.equal(toolUse._meta?.toolStatus, "failed", "should preserve failed tool status");
  assert.equal(toolUse._meta?.summary, "/tmp/b", "should preserve summary when tool_use appears after start event");
  assert.equal(toolUse._meta?.streamIndex, 1);
  assert.equal(toolResult.is_error, true);
  assert.equal(toolResult._meta?.streamIndex, 1);
}

{
  let state = createAssistantStreamState();
  state = applyAssistantMessageEvent(state, {
    type: "toolcall_end",
    contentIndex: 0,
    toolCall: { id: "t-partial", name: "bash", arguments: { command: "pnpm test" } },
  });
  state = applyToolExecutionStart(state, { toolCallId: "t-partial", summary: "pnpm test" });
  state = applyToolExecutionUpdate(state, { toolCallId: "t-partial", content: "running line 1" });

  let content = projectAssistantStreamState(state);
  assert.deepEqual(
    content.map((block) => block.type),
    ["tool_use"],
    "partial tool output should render on tool_use metadata without adding an ambiguous tool_result block",
  );
  let toolUse = content[0] as Extract<ContentBlock, { type: "tool_use" }>;
  assert.equal(toolUse._meta?.toolStatus, "running");
  assert.equal(toolUse._meta?.partialResult, "running line 1");

  state = applyToolExecutionEnd(state, { toolCallId: "t-partial", content: "final output", isError: false });
  content = projectAssistantStreamState(state);
  toolUse = content[0] as Extract<ContentBlock, { type: "tool_use" }>;
  const toolResult = content[1] as Extract<ContentBlock, { type: "tool_result" }>;
  assert.equal(toolUse._meta?.toolStatus, "done");
  assert.equal(toolUse._meta?.partialResult, undefined, "final tool_use should drop partial output metadata");
  assert.equal(toolResult.content, "final output");
}

{
  let state = createAssistantStreamState();
  state = applyAssistantMessageEvent(state, { type: "text_start", contentIndex: 0 });
  state = applyAssistantMessageEvent(state, { type: "text_delta", contentIndex: 0, delta: "before" });
  state = applyAssistantMessageEvent(state, { type: "toolcall_start", contentIndex: 1 });
  state = applyAssistantMessageEvent(state, {
    type: "toolcall_end",
    contentIndex: 1,
    toolCall: { id: "t3", name: "bash", arguments: { command: "pwd" } },
  });
  state = applyToolExecutionStart(state, { toolCallId: "t3", summary: "pwd" });
  state = applyToolExecutionEnd(state, { toolCallId: "t3", content: "/workspace", isError: false });
  state = applyAssistantMessageEvent(state, { type: "text_start", contentIndex: 2 });
  state = applyAssistantMessageEvent(state, { type: "text_end", contentIndex: 2, content: "after" });

  const content = projectAssistantStreamState(state);
  assert.deepEqual(
    content.map((block) => block.type),
    ["text", "tool_use", "tool_result", "text"],
    "full flow should preserve assistant order and injected tool result position",
  );
  assert.equal(content[0]?._meta?.streamIndex, 0);
  assert.equal(content[1]?._meta?.streamIndex, 1);
  assert.equal(content[2]?._meta?.streamIndex, 1);
  assert.equal(content[3]?._meta?.streamIndex, 2);
}

{
  const finalContent = mergeFinalAssistantContentWithStreamOrder(
    [
      { type: "thinking", thinking: "late reasoning" },
      { type: "text", text: "final answer" },
    ],
    [
      { type: "text", text: "final answer", _meta: { streamIndex: 0 } },
      { type: "thinking", thinking: "late reasoning", _meta: { streamIndex: 1 } },
    ],
  );

  assert.deepEqual(
    finalContent.map((block) => block.type),
    ["text", "thinking"],
    "persisted final content should keep stream order when the provider final payload disagrees",
  );
  assert.equal(finalContent[0]?._meta?.streamIndex, undefined, "stream metadata should not leak into persisted content");
}

{
  const finalContent = mergeFinalAssistantContentWithStreamOrder(
    [
      { type: "thinking", thinking: "plan" },
      { type: "toolCall", id: "t1", name: "read", arguments: { path: "/tmp/a" } },
      { type: "tool_result", tool_use_id: "t1", content: "hello", is_error: false },
      { type: "text", text: "done" },
    ],
    [
      { type: "thinking", thinking: "plan", _meta: { streamIndex: 0 } },
      { type: "tool_use", id: "t1", name: "read", input: { path: "/tmp/a" }, _meta: { streamIndex: 1, timing: { startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:01.250Z", durationMs: 1250 } } },
      { type: "tool_result", tool_use_id: "t1", content: "hello", is_error: false, _meta: { streamIndex: 1, timing: { startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:01.250Z", durationMs: 1250 } } },
      { type: "text", text: "done", _meta: { streamIndex: 2 } },
    ],
  );

  assert.deepEqual(
    finalContent.map((block) => block.type),
    ["thinking", "tool_use", "tool_result", "text"],
    "persisted final content should normalize toolCall and preserve streamed tool order",
  );
  const toolUse = finalContent[1] as Extract<ContentBlock, { type: "tool_use" }>;
  const toolResult = finalContent[2] as Extract<ContentBlock, { type: "tool_result" }>;
  assert.equal(toolUse._meta?.streamIndex, undefined, "stream index should be stripped from persisted tool_use");
  assert.equal(toolResult._meta?.streamIndex, undefined, "stream index should be stripped from persisted tool_result");
  assert.deepEqual(toolUse._meta?.timing, { startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:01.250Z", durationMs: 1250 });
  assert.deepEqual(toolResult._meta?.timing, { startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:01.250Z", durationMs: 1250 });
}
