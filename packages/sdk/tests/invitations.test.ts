import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSpaceInvitePath, buildSpacePath } from "../src/apis/invitations.js";

test("space paths prefer the friendly owner and slug pair", () => {
  assert.equal(
    buildSpacePath({
      spaceId: "space-id",
      ownerUsername: "alice",
      spaceSlug: "product team",
    }),
    "/alice/product%20team",
  );
});

test("space paths fall back to the stable space id", () => {
  assert.equal(
    buildSpacePath({
      spaceId: "space/id",
      ownerUsername: "alice",
      spaceSlug: null,
    }),
    "/spaces/space%2Fid",
  );
});

test("invite paths append an encoded code to the resolved space path", () => {
  assert.equal(
    buildSpaceInvitePath({
      spaceId: "space-id",
      ownerUsername: "alice",
      spaceSlug: "research",
      inviteCode: "inv_a/b",
    }),
    "/alice/research/join/inv_a%2Fb",
  );
});

test("space path builders reject missing stable identifiers", () => {
  assert.throws(() => buildSpacePath({ spaceId: " " }), /spaceId is required/);
  assert.throws(
    () => buildSpaceInvitePath({ spaceId: "space-id", inviteCode: "" }),
    /inviteCode is required/,
  );
});
