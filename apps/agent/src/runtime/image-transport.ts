import type { Api, Context, ImageContent, Model, TextContent } from "@earendil-works/pi-ai";
import { getRemoteImageUrl, isUrlMarkerImage, supportsRemoteImageUrls } from "@cohub/model-runtime/image-content";
import { imageOmittedText, normalizeAgentImage } from "../image-normalizer.js";
import { readPublicAssetImageUrl } from "../public-asset-storage.js";

type ReadImage = (url: string) => Promise<{ data: Buffer; mimeType: string } | null>;
const imageCaches = new WeakMap<object, Map<string, ImageContent>>();

/** Resolve only the request copy: history must remain usable after switching providers. */
export async function prepareRemoteImagesForModel(
  context: Context,
  model: Model<Api>,
  options: { read?: ReadImage; cacheKey?: object } = {},
): Promise<Context> {
  if (!model.input.includes("image") || supportsRemoteImageUrls(model.api)) return context;
  const read = options.read ?? readPublicAssetImageUrl;
  const cacheKey = options.cacheKey ?? context;
  const cache = imageCaches.get(cacheKey) ?? new Map<string, ImageContent>();
  imageCaches.set(cacheKey, cache);

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
  for (const url of cache.keys()) if (!urls.has(url)) cache.delete(url);

  const omitted: TextContent = { type: "text", text: imageOmittedText("image could not be loaded or processed") };
  const resolved = new Map<string, ImageContent | TextContent>();
  const pending = [...urls];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
    while (cursor < pending.length) {
      const url = pending[cursor++];
      if (url === undefined) continue;
      const cached = cache.get(url);
      if (cached) { resolved.set(url, cached); continue; }
      const image = await read(url).catch(() => null);
      const normalized = image && await normalizeAgentImage({
        ...image, sourceKind: "public_asset", originalSource: "url", originalUrl: url,
      });
      if (normalized) {
        const image: ImageContent = { type: "image", data: normalized.data, mimeType: normalized.mimeType };
        cache.set(url, image);
        resolved.set(url, image);
      } else {
        resolved.set(url, omitted);
      }
    }
  }));

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
