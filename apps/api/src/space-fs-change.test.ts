import assert from "node:assert/strict";
import test from "node:test";
import { buildCreatedDirectoryChanges, buildFileMutationChanges } from "./space-fs-change.js";

test("buildFileMutationChanges includes newly created parents in order", () => {
  assert.deepEqual(buildFileMutationChanges({
    path: "aa/bb/c.txt",
    created: true,
    createdDirs: ["aa", "aa/bb"],
    size: 7,
    mtimeMs: 42,
  }), [
    { path: "aa", kind: "create", nodeType: "dir" },
    { path: "aa/bb", kind: "create", nodeType: "dir" },
    { path: "aa/bb/c.txt", kind: "create", nodeType: "file", size: 7, mtimeMs: 42 },
  ]);
});

test("buildFileMutationChanges marks an overwrite as modify", () => {
  assert.deepEqual(buildFileMutationChanges({
    path: "file.txt",
    created: false,
    size: 3,
    mtimeMs: 7,
  }), [
    { path: "file.txt", kind: "modify", nodeType: "file", size: 3, mtimeMs: 7 },
  ]);
});

test("buildCreatedDirectoryChanges accepts no paths", () => {
  assert.deepEqual(buildCreatedDirectoryChanges(undefined), []);
});
