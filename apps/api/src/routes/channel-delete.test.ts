import assert from "node:assert/strict";

const { deleteChannelResponse } = await import("./channel-delete.js");

assert.deepEqual(deleteChannelResponse("not_found"), {
  body: { message: "channel not found" },
  status: 404,
});

assert.deepEqual(deleteChannelResponse("bound"), {
  body: { message: "channel is bound to a space" },
  status: 409,
});

assert.deepEqual(deleteChannelResponse("deleted"), {
  body: { ok: true },
  status: 200,
});
