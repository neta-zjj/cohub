import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	isPdfFile,
	isPdfPath,
} from "../lib/features/space/modules/file-workspace-utils.ts";

describe("file workspace utils", () => {
	it("recognizes PDF paths case-insensitively", () => {
		assert.equal(isPdfPath("docs/report.pdf"), true);
		assert.equal(isPdfPath("REPORT.PDF"), true);
		assert.equal(isPdfPath("report.pdf.txt"), false);
	});

	it("prefers PDF MIME while retaining an extension fallback", () => {
		assert.equal(
			isPdfFile({ path: "download", mimeType: "application/pdf" }),
			true,
		);
		assert.equal(
			isPdfFile({
				path: "docs/report.pdf",
				mimeType: "application/octet-stream",
			}),
			true,
		);
		assert.equal(
			isPdfFile({ path: "docs/report.txt", mimeType: "text/plain" }),
			false,
		);
		assert.equal(isPdfFile(null), false);
	});
});
