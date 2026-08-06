import assert from "node:assert/strict";
import {
  isSandboxConnectRetryable,
  isSandboxEndpointUnreachable,
} from "@cohub/sandbox-client";
import { getSandboxPromptRecoveryReason } from "@cohub/sandbox-controller";

/**
 * Documents the agent sandbox connect wait policy:
 * - kick recover only when the prompt recovery gate says so
 * - missing endpoint is waitable, not an immediate hard failure
 * - endpoint unreachable recovers once then waits
 * - do not thrash recover while already provisioning
 */

assert.equal(
  getSandboxPromptRecoveryReason({ status: "stopped", provider: "cloud", meta: {} }),
  "auto_resume",
  "auto-stopped sandboxes should resume on next dial",
);

assert.equal(
  getSandboxPromptRecoveryReason({ status: "provisioning", provider: "cloud", meta: {} }),
  null,
  "in-flight recover/provision must not thrash another recreate",
);

assert.equal(
  getSandboxPromptRecoveryReason({
    status: "running",
    provider: "cloud",
    meta: { recoveryStatus: "recreating", podIp: null },
  }),
  null,
  "endpoint report grace after recover should wait, not recreate",
);

assert.equal(
  getSandboxPromptRecoveryReason({ status: "stopping", provider: "cloud", meta: {} }),
  "auto_resume",
  "stopping is resume-eligible once stop finishes; dial path skips recover until stopped",
);

const missingEndpoint = new Error("sandbox is not ready for requests yet: missing endpoint for abc");
assert.equal(isSandboxEndpointUnreachable(missingEndpoint), false, "missing endpoint must not hard-recover");
assert.equal(isSandboxConnectRetryable(missingEndpoint), true, "missing endpoint must wait/poll");

const refused = new Error("connect ECONNREFUSED 10.0.0.1:8788");
assert.equal(isSandboxEndpointUnreachable(refused), true, "dead coordinates recover once");
assert.equal(isSandboxConnectRetryable(refused), true, "then wait for the new endpoint");

const authError = new Error("forbidden");
assert.equal(isSandboxConnectRetryable(authError), false, "auth/logic errors fail fast");
