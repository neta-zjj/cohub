import assert from "node:assert/strict";
import { test } from "node:test";
import { isRuntimeModelAvailable, type ModelsConfig } from "./models.js";

const platform: ModelsConfig = {
  providers: {
    cohub: {
      api: "openai-responses",
      baseUrl: "https://example.test",
      models: [{ id: "default" }, { id: "hidden", hidden: true }],
    },
    incomplete: {
      models: [{ id: "missing-runtime" }],
    },
  },
};

test("isRuntimeModelAvailable follows runtime provider defaults", () => {
  assert.equal(isRuntimeModelAvailable([platform], "cohub", "default"), true);
  assert.equal(isRuntimeModelAvailable([platform], "cohub", "hidden"), true);
  assert.equal(isRuntimeModelAvailable([platform], "cohub", "missing"), false);
  assert.equal(isRuntimeModelAvailable([platform], "incomplete", "missing-runtime"), false);
});

test("isRuntimeModelAvailable honors user model overrides", () => {
  const user: ModelsConfig = {
    providers: {
      cohub: {
        models: [{ id: "default", baseUrl: "https://user.example.test" }],
      },
    },
  };
  assert.equal(isRuntimeModelAvailable([platform, user], "cohub", "default"), true);
});
