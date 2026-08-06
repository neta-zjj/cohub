import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	classifyChatDraftDrop,
	hasExternalFileDrag,
	readCohubPathFromDataTransfer,
} from "../lib/drag/chat-draft-drop";
import { COHUB_PATH_MIME } from "../lib/drag/cohub-resource-drag";

function mockDataTransfer(options: {
	types?: string[];
	items?: Array<{ kind: string }>;
	data?: Record<string, string>;
}): DataTransfer {
	const types = options.types ?? [];
	const items = options.items ?? [];
	const data = options.data ?? {};
	return {
		types,
		items: items as unknown as DataTransferItemList,
		getData: (type: string) => data[type] ?? "",
	} as unknown as DataTransfer;
}

describe("classifyChatDraftDrop", () => {
	it("returns null for empty transfer", () => {
		assert.equal(classifyChatDraftDrop(null), null);
		assert.equal(
			classifyChatDraftDrop(mockDataTransfer({ types: ["text/plain"] })),
			null,
		);
	});

	it("classifies external files as files", () => {
		assert.equal(
			classifyChatDraftDrop(
				mockDataTransfer({
					types: ["Files"],
					items: [{ kind: "file" }],
				}),
			),
			"files",
		);
	});

	it("classifies cohub path payloads as path", () => {
		assert.equal(
			classifyChatDraftDrop(
				mockDataTransfer({
					types: [COHUB_PATH_MIME, "text/plain"],
				}),
			),
			"path",
		);
	});

	it("prefers files when both files and path types are present", () => {
		assert.equal(
			classifyChatDraftDrop(
				mockDataTransfer({
					types: ["Files", COHUB_PATH_MIME],
					items: [{ kind: "file" }],
				}),
			),
			"files",
		);
	});
});

describe("hasExternalFileDrag", () => {
	it("requires a file-kind item", () => {
		assert.equal(hasExternalFileDrag(null), false);
		assert.equal(
			hasExternalFileDrag(mockDataTransfer({ items: [{ kind: "string" }] })),
			false,
		);
		assert.equal(
			hasExternalFileDrag(mockDataTransfer({ items: [{ kind: "file" }] })),
			true,
		);
	});
});

describe("readCohubPathFromDataTransfer", () => {
	it("reads and trims path mime data", () => {
		assert.equal(readCohubPathFromDataTransfer(null), null);
		assert.equal(
			readCohubPathFromDataTransfer(
				mockDataTransfer({ data: { [COHUB_PATH_MIME]: "  src/a.ts  " } }),
			),
			"src/a.ts",
		);
		assert.equal(
			readCohubPathFromDataTransfer(
				mockDataTransfer({ data: { [COHUB_PATH_MIME]: "   " } }),
			),
			null,
		);
	});
});
