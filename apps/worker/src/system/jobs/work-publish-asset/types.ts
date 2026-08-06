import type { WorkPublishExtractedPageMeta } from "@cohub/core/works";
import type { WorkArtifactDescriptor } from "@cohub/protocol";

export const WORK_PUBLISH_ASSET_JOB = "work.publish_asset";

export type WorkPublishAssetJobData = {
  spaceId: string;
  slug: string;
  targetType: "file" | "directory";
  targetRef: string;
  requestId?: string | null;
  trace?: Record<string, unknown>;
};

export type { WorkPublishExtractedPageMeta };

export type WorkPublishAssetJobResult = {
  ok: true;
  assetKey: string;
  sizeBytes: number;
  fileCount?: number;
  extracted?: WorkPublishExtractedPageMeta | null;
  artifact?: WorkArtifactDescriptor;
} | {
  ok: false;
  status: number;
  message: string;
  code?: string;
};
