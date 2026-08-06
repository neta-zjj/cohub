import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveBoardManifestText } from "../lib/board/board-manifest-text.ts";

const manifest = `{
  "kind": "cohub.board.manifest",
  "version": 1,
  "boardId": "doc_123",
  "title": "Untitled.board"
}
`;

describe("resolveBoardManifestText", () => {
	it("returns utf-8 content for text responses", () => {
		const content = resolveBoardManifestText({
			path: "board.board",
			name: "board.board",
			size: manifest.length,
			mimeType: "application/json",
			mtimeMs: Date.now(),
			kind: "text",
			encoding: "utf-8",
			content: manifest,
			delivery: "inline",
		});
		assert.equal(content, manifest);
	});

	it("recovers JSON text from base64 binary .board responses", () => {
		const content = resolveBoardManifestText({
			path: "board.board",
			name: "board.board",
			size: manifest.length,
			mimeType: null,
			mtimeMs: Date.now(),
			kind: "binary",
			encoding: "base64",
			content: Buffer.from(manifest, "utf8").toString("base64"),
			delivery: "inline",
		});
		assert.equal(content, manifest);
	});

	it("rejects non-JSON binary payloads", () => {
		const content = resolveBoardManifestText({
			path: "board.board",
			name: "board.board",
			size: 4,
			mimeType: null,
			mtimeMs: Date.now(),
			kind: "binary",
			encoding: "base64",
			content: Buffer.from("\0\0\0\0").toString("base64"),
			delivery: "inline",
		});
		assert.equal(content, null);
	});
});
