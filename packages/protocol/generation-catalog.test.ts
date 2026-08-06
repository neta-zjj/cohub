import assert from "node:assert/strict";
import { test } from "node:test";
import {
  filterDiscoverableGenerationModels,
  isGenerationModelHidden,
} from "./dist/generation/index.js";

const models = [
  { model: "visible" },
  { model: "hidden", hidden: true },
  { model: "explicit", hidden: true },
];

test("hidden generation models are excluded from default discovery", () => {
  assert.equal(isGenerationModelHidden(models[0]), false);
  assert.equal(isGenerationModelHidden(models[1]), true);
  assert.deepEqual(
    filterDiscoverableGenerationModels(models).map((model) => model.model),
    ["visible"],
  );
});

test("explicit generation model ids remain discoverable", () => {
  assert.deepEqual(
    filterDiscoverableGenerationModels(models, {
      includeModelIds: ["explicit", "missing"],
    }).map((model) => model.model),
    ["visible", "explicit"],
  );
});

test("generation model discovery preserves source data and order", () => {
  const snapshot = structuredClone(models);
  const filtered = filterDiscoverableGenerationModels(models, {
    includeModelIds: new Set(["hidden"]),
  });

  assert.deepEqual(models, snapshot);
  assert.deepEqual(filtered, [models[0], models[1]]);
});
