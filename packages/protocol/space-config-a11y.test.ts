import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isDecorativeNewChatBackground,
  parseSpaceConfig,
} from "./src/space-config.js";

function background(value: unknown) {
  const config = parseSpaceConfig(
    JSON.stringify({ version: 1, ui: { newChat: { background: value } } }),
  );
  const parsed = config?.ui?.newChat?.background;
  assert.ok(parsed, "expected the background to parse");
  return parsed;
}

describe("New Chat background decorative classification", () => {
  it("treats image and video backgrounds as decoration", () => {
    assert.equal(
      isDecorativeNewChatBackground(
        background({ type: "image", url: "https://example.com/bg.png" }),
      ),
      true,
    );
    assert.equal(
      isDecorativeNewChatBackground(
        background({ type: "video", url: "https://example.com/bg.mp4" }),
      ),
      true,
    );
  });

  it("treats a space-local html board as content, not decoration", () => {
    const parsed = background({ type: "html", url: "onboarding/index.html" });
    assert.deepEqual(parsed.source, {
      kind: "space",
      path: "onboarding/index.html",
    });
    // Regression guard: hiding this pruned focusable CTAs from the
    // accessibility tree while they stayed keyboard-reachable (WCAG 4.1.2).
    assert.equal(isDecorativeNewChatBackground(parsed), false);
  });

  it("treats an external html background as content too", () => {
    assert.equal(
      isDecorativeNewChatBackground(
        background({ type: "html", url: "https://example.com/board.html" }),
      ),
      false,
    );
  });

  it("defaults an unknown type to html, so it stays exposed", () => {
    // parseBackground falls back to type "html" for unrecognized values;
    // that fallback must not become a way to hide interactive content.
    assert.equal(
      isDecorativeNewChatBackground(
        background({ type: "canvas", url: "onboarding/index.html" }),
      ),
      false,
    );
  });
});
