/**
 * Where a Board's referenced media comes from.
 *
 * A Board node stores a workspace path, but that path only resolves against the
 * Space it was authored in. A published Board is read by viewers who have no
 * access to that Space, so the renderer never resolves paths itself — it asks a
 * source. Live boards resolve through the Space file API; a published Work
 * resolves against the immutable assets captured into its artifact.
 */

import type { WorkBoardAsset } from "@neta-art/cohub";

export type BoardAssetSource = {
	/** Displayable URL for a space-file reference, or null when unavailable. */
	resolveFileUrl: (path: string) => Promise<string | null>;
};

export function createSpaceBoardAssetSource(spaceId: string): BoardAssetSource {
	return {
		resolveFileUrl: async (path) => {
			const { resolveSpaceFileImageUrl } = await import(
				"$lib/board/board-image-urls"
			);
			return resolveSpaceFileImageUrl(spaceId, path);
		},
	};
}

/**
 * Resolve against a published Board artifact.
 *
 * Assets are addressed by the path recorded at publish time, so a node whose
 * asset was missing or rejected during capture resolves to null and renders as
 * unavailable — the viewer is never sent back to the origin Space.
 */
export function createWorkBoardAssetSource(input: {
	manifestUrl: string;
	assets: WorkBoardAsset[];
}): BoardAssetSource {
	const base = new URL(".", input.manifestUrl);
	const byPath = new Map(
		input.assets
			.filter((asset) => asset.status === "captured" && asset.artifactPath)
			.map((asset) => [asset.sourcePath, asset.artifactPath as string]),
	);
	return {
		resolveFileUrl: async (path) => {
			const artifactPath = byPath.get(path);
			return artifactPath ? new URL(artifactPath, base).toString() : null;
		},
	};
}
