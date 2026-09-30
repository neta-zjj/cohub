import type { ContentBlock } from "@cohub/protocol/core";
import type { RuntimeContext } from "@cohub/protocol";
import { normalizeImageContentBlock, type ImageNormalizationOptions } from "../image-normalizer.js";

const IMAGE_CONCURRENCY = 4;
type Image = { data: Buffer; mimeType: string };
type ImageBlock = Extract<ContentBlock, { type: "image" }>;
const imageKey = (block: ImageBlock) => block.source.type === "url" ? block.source.url : block;

/** Revalidate recovered URLs once, sharing the ingress size/format policy and bounded downloads. */
export async function hydrateContextImages(context: RuntimeContext, read: (url: string) => Promise<Image | null>, options: ImageNormalizationOptions = {}): Promise<RuntimeContext> {
  const images = new Map<string | ImageBlock, ImageBlock>();
  const collect = (content: ContentBlock[]) => {
    for (const block of content) {
      if (block.type === "image") images.set(imageKey(block), block);
      else if (block.type === "tool_result" && Array.isArray(block.content)) collect(block.content);
    }
  };
  for (const message of context.messages) collect(message.content);
  const pending = [...images.entries()];
  const cache = new Map<string | ImageBlock, Promise<ContentBlock>>();
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(IMAGE_CONCURRENCY, pending.length) }, async () => {
    while (cursor < pending.length) {
      const entry = pending[cursor++];
      if (!entry) continue;
      const [key, block] = entry;
      // Persisted metadata is not proof that an old URL is still available or within the limits.
      const task = normalizeImageContentBlock({ type: "image", source: block.source }, { ...options, readUrlImage: read });
      cache.set(key, task);
      await task;
    }
  }));
  const blocks = (content: ContentBlock[]): Promise<ContentBlock[]> => Promise.all(content.map(async (block): Promise<ContentBlock> => {
    if (block.type === "image") {
      const image = await cache.get(imageKey(block));
      return image ? { ...image, _meta: { ...block._meta, imageUrlPassthrough: false, ...image._meta } } : block;
    }
    if (block.type === "tool_result" && Array.isArray(block.content)) return { ...block, content: await blocks(block.content) };
    return block;
  }));
  return { ...context, messages: await Promise.all(context.messages.map(async (message) => ({ ...message, content: await blocks(message.content) }))) };
}
