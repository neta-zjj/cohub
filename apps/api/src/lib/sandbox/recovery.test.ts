import assert from "node:assert/strict";

const { classifySandboxInfraError } = await import("./recovery.js");

assert.equal(
  classifySandboxInfraError("stat /workspace/apps/web/node_modules/dompurify: no such file or directory"),
  null,
  "path lookup failures should not be treated as recoverable infra errors",
);

assert.equal(
  classifySandboxInfraError("transport endpoint is not connected: /workspace")?.code,
  "CRITICAL_MOUNT_IO",
  "definitive mount transport failures should still be classified",
);
