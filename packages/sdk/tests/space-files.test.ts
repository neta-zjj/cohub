import assert from "node:assert/strict";
import { test } from "node:test";
import { CohubHttpClient } from "../src/http.js";
import type { Fetch } from "../src/transport.js";

function jsonResponse(body: unknown = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("space file mutations forward client mutation ids", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetch: Fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return jsonResponse();
  };
  const files = new CohubHttpClient({ baseUrl: "https://api.example.test", fetch })
    .space("space-1")
    .files;

  await files.createDir("docs", "mutation-dir");
  await files.delete("docs", true, "mutation-delete");
  await files.move({ fromPath: "a.txt", toPath: "b.txt", mutationId: "mutation-move" });

  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    path: "docs",
    mutationId: "mutation-dir",
  });

  const deleteUrl = new URL(requests[1]?.url ?? "");
  assert.equal(deleteUrl.pathname, "/api/spaces/space-1/fs/node");
  assert.equal(deleteUrl.searchParams.get("path"), "docs");
  assert.equal(deleteUrl.searchParams.get("recursive"), "true");
  assert.equal(deleteUrl.searchParams.get("mutationId"), "mutation-delete");

  assert.deepEqual(JSON.parse(String(requests[2]?.init?.body)), {
    fromPath: "a.txt",
    toPath: "b.txt",
    mutationId: "mutation-move",
  });
});

test("board creation forwards its mutation id", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetch: Fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return jsonResponse();
  };
  const boards = new CohubHttpClient({ baseUrl: "https://api.example.test", fetch })
    .space("space-1")
    .boards;

  await boards.create({ path: "plan.board", mutationId: "mutation-board" });

  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    path: "plan.board",
    mutationId: "mutation-board",
  });
});
