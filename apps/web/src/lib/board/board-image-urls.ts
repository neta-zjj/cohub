import { sdk } from "$lib/sdk";

/**
 * Resolve a displayable URL for a space-file image. Prefers the CDN `url`
 * delivery; falls back to an inline base64 data URL.
 */
export async function resolveSpaceFileImageUrl(
	spaceId: string,
	path: string,
): Promise<string | null> {
	try {
		const file = await sdk.space(spaceId).files.read(path);
		if (!("content" in file)) return null;
		if (file.delivery === "url" && file.url) return file.url;
		if (file.content) {
			const mime = file.mimeType ?? "image/png";
			return `data:${mime};base64,${file.content}`;
		}
		return null;
	} catch {
		return null;
	}
}
