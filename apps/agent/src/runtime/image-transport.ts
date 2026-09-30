import type { Api, Context, ImageContent, Model, TextContent } from "@earendil-works/pi-ai";
import { getRemoteImageUrl, isUrlMarkerImage, supportsRemoteImageUrls } from "@cohub/model-runtime/image-content";
import { imageOmittedText, normalizeAgentImage } from "../image-normalizer.js";
import { readPublicAssetImageUrl } from "../public-asset-storage.js";
import { RemoteImageCache } from "./image-cache.js";

type ReadImage = (url: string, signal?: AbortSignal) => Promise<{ data: Buffer; mimeType: string } | null>;
const imageCache = new RemoteImageCache();

export function clearRemoteImageCache(owner: object): void {
  imageCache.retain(owner, new Set());
}

/** Resolve only the request copy: history must remain usable after switching providers. */
export async function prepareRemoteImagesForModel(
  context: Context,
  model: Model<Api>,
  options: { read?: ReadImage; cacheKey?: object; signal?: AbortSignal } = {},
): Promise<Context> {
  const signal = options.signal;
  signal?.throwIfAborted();
  const read = options.read ?? readPublicAssetImageUrl;
  const cacheKey = options.cacheKey;
  if (!model.input.includes("image") || supportsRemoteImageUrls(model.api)) {
    if (cacheKey) clearRemoteImageCache(cacheKey);
    return context;
  }

  const urls = new Set<string>();
  for (const message of context.messages) {
    if (message.role !== "user" && message.role !== "toolResult" || typeof message.content === "string") continue;
    for (const block of message.content) {
      if (block.type !== "image") continue;
      const url = getRemoteImageUrl(block);
      if (url) urls.add(url);
    }
  }
  // Match cache lifetime to retained history, so compaction also releases decoded image bytes.
  if (cacheKey) imageCache.retain(cacheKey, urls);

  const omitted: TextContent = { type: "text", text: imageOmittedText("image could not be loaded or processed") };
  const resolved = new Map<string, ImageContent | TextContent>();
  const pending = [...urls];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
    while (cursor < pending.length) {
      signal?.throwIfAborted();
      const url = pending[cursor++];
      if (url === undefined) continue;
      const cached = cacheKey ? imageCache.get(cacheKey, url) : undefined;
      if (cached) { resolved.set(url, cached); continue; }
      const image = await read(url, signal).catch(() => {
        signal?.throwIfAborted();
        return null;
      });
      signal?.throwIfAborted();
      const normalized = image && await normalizeAgentImage({
        ...image, sourceKind: "public_asset", originalSource: "url", originalUrl: url,
      });
      signal?.throwIfAborted();
      if (normalized) {
        const image: ImageContent = { type: "image", data: normalized.data, mimeType: normalized.mimeType };
        if (cacheKey) imageCache.set(cacheKey, url, image);
        resolved.set(url, image);
      } else {
        resolved.set(url, omitted);
      }
    }
  }));
  signal?.throwIfAborted();

  return {
    ...context,
    messages: context.messages.map((message) => {
      if (message.role !== "user" && message.role !== "toolResult" || typeof message.content === "string") return message;
      return {
        ...message,
        content: message.content.map((block) => block.type === "image" && isUrlMarkerImage(block.mimeType)
          ? resolved.get(getRemoteImageUrl(block) ?? "") ?? omitted
          : block),
      };
    }),
  };
}
