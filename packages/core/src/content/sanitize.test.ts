import assert from "node:assert/strict";
import { sanitizePostgresJsonValue } from "./sanitize.js";

const value = {
  content: [
    { type: "text", text: "fix(agent)\u0000\u0000 harden\u0000" },
    { type: "tool_use", input: { command: "git commit\u0000" } },
    { type: "text", text: "broken high \ud83d and low \ude00" },
    { type: "text", text: "normal emoji 😀" },
  ],
  meta: {
    thinking: "ok\u0000",
    untouched: "normal",
  },
};

assert.deepEqual(sanitizePostgresJsonValue(value), {
  content: [
    { type: "text", text: "fix(agent) harden" },
    { type: "tool_use", input: { command: "git commit" } },
    { type: "text", text: "broken high � and low �" },
    { type: "text", text: "normal emoji 😀" },
  ],
  meta: {
    thinking: "ok",
    untouched: "normal",
  },
});

assert.equal(sanitizePostgresJsonValue("a\u0000b"), "ab");
assert.equal(sanitizePostgresJsonValue("broken high \ud83d"), "broken high �");
assert.equal(sanitizePostgresJsonValue("broken low \ude00"), "broken low �");
assert.equal(sanitizePostgresJsonValue("normal emoji 😀"), "normal emoji 😀");
