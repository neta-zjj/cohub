import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COHUB_SOURCE_HEADER,
  hasRequestSourceIdentity,
  isRequestSourceEmpty,
  mergeRequestSourceIntoMeta,
  normalizeRequestSource,
  parseRequestSourceFromHeaders,
  readRequestSourceFromEnv,
  requestSourceToHeaders,
  resolveRequestSourceChannel,
} from "./dist/provenance.js";

const SPACE = "11111111-1111-1111-1111-111111111111";
const SESSION = "22222222-2222-2222-2222-222222222222";

test("via-only is a valid channel source", () => {
  assert.deepEqual(normalizeRequestSource({ via: "cli" }), { via: "cli" });
  assert.equal(isRequestSourceEmpty({ via: "cli" }), false);
  assert.equal(hasRequestSourceIdentity({ via: "cli" }), false);
  assert.equal(resolveRequestSourceChannel({ via: "cli" }), "cli");
  assert.equal(resolveRequestSourceChannel(null), "public_api");
  // Control chars stripped; length capped.
  assert.deepEqual(normalizeRequestSource({ via: "cli\r\n" }), { via: "cli" });
  assert.equal(
    normalizeRequestSource({ via: `x${"a".repeat(100)}` })?.via?.length,
    64,
  );
});

test("normalizeRequestSource keeps valid fields and drops junk", () => {
  assert.deepEqual(
    normalizeRequestSource({
      spaceId: SPACE,
      sessionId: "nope",
      via: "cli",
      extra: 1,
    }),
    { spaceId: SPACE, via: "cli" },
  );
  assert.equal(normalizeRequestSource(null), null);
  assert.equal(normalizeRequestSource({}), null);
});

test("header round-trip includes via-only", () => {
  const headers = requestSourceToHeaders({ via: "web" });
  assert.deepEqual(headers, { [COHUB_SOURCE_HEADER.via]: "web" });
  const map = new Map(Object.entries(headers));
  assert.deepEqual(
    parseRequestSourceFromHeaders((name) => map.get(name) ?? null),
    { via: "web" },
  );
});

test("readRequestSourceFromEnv applies default via even without identity", () => {
  assert.deepEqual(readRequestSourceFromEnv({}, { via: "cli" }), { via: "cli" });
  assert.deepEqual(
    readRequestSourceFromEnv({ COHUB_SPACE_ID: SPACE }, { via: "cli" }),
    { spaceId: SPACE, via: "cli" },
  );
  assert.equal(readRequestSourceFromEnv({ COHUB_SPACE_ID: "not-a-uuid" }), null);
});

test("mergeRequestSourceIntoMeta stores identity only", () => {
  const withIdentity = mergeRequestSourceIntoMeta(
    { presentation: { hideCohubBar: true }, source: { spaceId: SESSION, via: "api" } },
    { spaceId: SPACE, via: "cli" },
  );
  assert.deepEqual(withIdentity, {
    presentation: { hideCohubBar: true },
    source: { spaceId: SPACE, via: "cli" },
  });

  const viaOnly = mergeRequestSourceIntoMeta(
    { presentation: { hideCohubBar: true }, source: { spaceId: SESSION } },
    { via: "cli" },
  );
  assert.deepEqual(viaOnly, { presentation: { hideCohubBar: true } });

  assert.deepEqual(
    mergeRequestSourceIntoMeta(
      { note: "ship it", source: { spaceId: SESSION } },
      { spaceId: SPACE, via: "cli" },
    ),
    { note: "ship it", source: { spaceId: SPACE, via: "cli" } },
  );
});
