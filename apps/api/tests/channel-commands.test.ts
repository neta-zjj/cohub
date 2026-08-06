import { strict as assert } from "node:assert";
import { test } from "node:test";
import { GATEWAY_CHANNEL_COMMAND_SPECS } from "@cohub/protocol/gateway";

test("GATEWAY_CHANNEL_COMMAND_SPECS includes help and models commands", () => {
  const names = GATEWAY_CHANNEL_COMMAND_SPECS.map((spec) => spec.name);
  assert.ok(names.includes("help"));
  assert.ok(names.includes("models"));
  assert.ok(names.includes("model"));
  assert.ok(names.includes("new"));
  assert.ok(names.includes("status"));
});
