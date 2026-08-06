import assert from "node:assert/strict";
import {
  buildSandboxIdleCheckJobId,
  computeSandboxIdleCheckDelayMs,
  resolveSandboxIdleCheckReschedule,
} from "./index.js";

assert.equal(buildSandboxIdleCheckJobId("abc"), "sandbox-idle-check-abc");

const now = Date.UTC(2026, 0, 1, 0, 0, 0);
assert.equal(computeSandboxIdleCheckDelayMs(new Date(now + 5_000), now), 5_000);
assert.equal(computeSandboxIdleCheckDelayMs(new Date(now - 1_000), now), 0);

const delay = resolveSandboxIdleCheckReschedule({
  ok: true,
  skipped: true,
  reason: "not_due",
  dueAt: "2026-01-01T01:00:00.000Z",
});
assert.equal(delay.action, "delay");
if (delay.action === "delay") {
  assert.equal(delay.dueAt.toISOString(), "2026-01-01T01:00:00.000Z");
}

assert.deepEqual(
  resolveSandboxIdleCheckReschedule({ ok: true, skipped: true, reason: "never" }),
  { action: "none", reason: "never" },
);
assert.deepEqual(
  resolveSandboxIdleCheckReschedule({ ok: true, skipped: true, reason: "not_usable" }),
  { action: "none", reason: "not_usable" },
);
assert.deepEqual(
  resolveSandboxIdleCheckReschedule({ ok: true, status: "stopped" } as { ok: boolean }),
  { action: "none", reason: "completed" },
);
assert.deepEqual(
  resolveSandboxIdleCheckReschedule({
    ok: true,
    skipped: true,
    reason: "not_due",
    dueAt: "not-a-date",
  }),
  { action: "none", reason: "not_due" },
);
