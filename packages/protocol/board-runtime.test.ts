import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BoardPlaybackCommandSchema,
  parseBoardPlaybackPolicy,
} from "./src/board.js";

test("Board playback metadata parses into an autoplay policy", () => {
  assert.deepEqual(
    parseBoardPlaybackPolicy({
      playback: { sequenceId: "ambient", delayMs: 500, loop: true },
    }),
    { sequenceId: "ambient", delayMs: 500, loop: true },
  );
  assert.deepEqual(
    parseBoardPlaybackPolicy({ playback: { sequenceId: "ambient" } }),
    { sequenceId: "ambient", delayMs: 0, loop: false },
  );
  assert.deepEqual(parseBoardPlaybackPolicy({}), null);
  assert.deepEqual(parseBoardPlaybackPolicy({ playback: { delayMs: 10 } }), null);
});

test("explicit play commands stay independent from autoplay policy", () => {
  const command = BoardPlaybackCommandSchema.parse({
    commandId: "play-1",
    type: "play",
    sequenceId: "ambient",
  });
  assert.equal(command.type, "play");
  assert.equal("loop" in command, false);
  assert.equal("options" in command, false);
});
