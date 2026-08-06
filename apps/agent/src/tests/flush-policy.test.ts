import assert from "node:assert/strict";
import {
  resolveStreamFlushDelayMs,
  shouldReplaceStreamFlushTimer,
  STREAM_TEXT_DEBOUNCE_MS,
  STREAM_TOOL_DEBOUNCE_MS,
} from "../stream/flush-policy.js";

assert.equal(STREAM_TEXT_DEBOUNCE_MS, 24);
assert.equal(STREAM_TOOL_DEBOUNCE_MS, 250);

assert.equal(resolveStreamFlushDelayMs("immediate"), 0);
assert.equal(resolveStreamFlushDelayMs("text"), STREAM_TEXT_DEBOUNCE_MS);
assert.equal(resolveStreamFlushDelayMs("tool"), STREAM_TOOL_DEBOUNCE_MS);

assert.equal(shouldReplaceStreamFlushTimer(null, 24), true);
assert.equal(shouldReplaceStreamFlushTimer(undefined, 250), true);
assert.equal(shouldReplaceStreamFlushTimer(250, 24), true);
assert.equal(shouldReplaceStreamFlushTimer(24, 250), false);
assert.equal(shouldReplaceStreamFlushTimer(24, 24), false);
assert.equal(shouldReplaceStreamFlushTimer(0, 24), false);
