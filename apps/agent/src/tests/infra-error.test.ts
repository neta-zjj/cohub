import assert from "node:assert/strict";

const {
  classifySandboxInfrastructureError,
  isSandboxConnectRetryable,
  isSandboxEndpointUnreachable,
} = await import("@cohub/sandbox-client");

assert.equal(
  classifySandboxInfrastructureError("stat /workspace/node_modules/lucide-svelte/dist/icons: no such file or directory"),
  null,
  "ordinary missing-path errors should not trigger sandbox recovery",
);

assert.equal(
  classifySandboxInfrastructureError("open /workspace: input/output error")?.code,
  "CRITICAL_MOUNT_IO",
  "definitive I/O errors on critical mounts should still be classified",
);

assert.equal(
  classifySandboxInfrastructureError("stale file handle on /sessions")?.code,
  "STALE_MOUNT",
  "stale mount failures should remain recoverable infra errors",
);

assert.equal(
  isSandboxEndpointUnreachable(new Error("connect ETIMEDOUT 10.187.125.231:8788")),
  true,
  "TCP timeouts against a stale pod IP should be treated as endpoint unreachable",
);

assert.equal(
  isSandboxEndpointUnreachable(new Error("Timed out waiting for sandbox connection for abc after 30000ms")),
  true,
  "attach wait timeouts should be treated as endpoint unreachable",
);

assert.equal(
  isSandboxEndpointUnreachable(new Error("connect ECONNREFUSED 10.0.0.1:8788")),
  true,
  "connection refused should be treated as endpoint unreachable",
);

assert.equal(
  isSandboxEndpointUnreachable(new Error("socket hang up")),
  false,
  "transient hang-ups should not recreate the pod",
);

assert.equal(
  isSandboxEndpointUnreachable(new Error("sandbox is not ready for requests yet: missing endpoint for abc")),
  false,
  "missing endpoint during provisioning must not thrash recover",
);

assert.equal(
  isSandboxConnectRetryable(new Error("sandbox is not ready for requests yet: missing endpoint for abc")),
  true,
  "after recover, missing endpoint should keep polling",
);

assert.equal(
  isSandboxConnectRetryable(new Error("forbidden")),
  false,
  "non-network errors should not spin for 60s",
);
