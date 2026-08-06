import type { BoardSnapshot } from "./board.js";

export type WorkContentKind = "web" | "file" | "board";

export type WorkArtifactDescriptor =
  | {
      kind: "web";
      mimeType: "text/html";
      sizeBytes: number;
      fileCount: number;
    }
  | {
      kind: "file";
      name: string;
      mimeType: string | null;
      sizeBytes: number;
      sha256: string;
    }
  | {
      kind: "board";
      boardId: string;
      boardVersion: number;
      sizeBytes: number;
      fileCount: number;
    };

export type WorkBoardAsset = {
  sourcePath: string;
  status: "captured" | "missing" | "rejected";
  reason?: string;
  artifactPath?: string;
  mimeType?: string | null;
  sizeBytes?: number;
  sha256?: string;
};

export type WorkBoardArtifactManifest = {
  kind: "cohub.work.board";
  version: 1;
  sourcePath: string;
  snapshot: BoardSnapshot;
  assets: WorkBoardAsset[];
};
