import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import type { ContentBlock } from "@cohub/protocol/core";
import {
  AGENT_IMAGE_URL_PASSTHROUGH_MAX_BYTES,
  AGENT_IMAGE_URL_PASSTHROUGH_MAX_EDGE,
  normalizeImageContentBlock,
} from "../image-normalizer.js";

process.env.DATABASE_URL ??= "postgres://localhost/cohub_test";
process.env.APP_ENCRYPTION_KEY ??= "test-key";
process.env.SESSIONS_NAMESPACE ??= "test";

const sampleUrl = "https://public.cohub.run/spaces/x/chat/a.png";

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 12, g: 34, b: 56 } },
  }).png().toBuffer();
}

function urlBlock(url = sampleUrl): Extract<ContentBlock, { type: "image" }> {
  return { type: "image", source: { type: "url", url } };
}

test("a URL image within the size and dimension caps stays a URL block", async () => {
  const bytes = await png(64, 48);
  const block = await normalizeImageContentBlock(urlBlock(), {
    readUrlImage: async () => ({ data: bytes, mimeType: "image/png" }),
  });

  assert.equal(block.type, "image");
  assert.deepEqual(block.source, { type: "url", url: sampleUrl });
  assert.equal(block._meta?.imageUrlPassthrough, true);
  assert.equal(block._meta?.originalUrl, sampleUrl);
  assert.equal(block._meta?.originalWidth, 64);
  assert.equal(block._meta?.originalHeight, 48);
});

test("an already-approved passthrough block is not re-downloaded", async () => {
  let reads = 0;
  const bytes = await png(64, 48);
  const read = async () => { reads += 1; return { data: bytes, mimeType: "image/png" }; };
  const first = await normalizeImageContentBlock(urlBlock(), { readUrlImage: read });
  assert.equal(first.type, "image");
  const second = await normalizeImageContentBlock(first, { readUrlImage: read });

  assert.equal(reads, 1);
  assert.deepEqual(second, first);
});

test("an oversized URL image falls back to the inline normalized path", async () => {
  const bytes = await png(3000, 40);
  assert.ok(bytes.byteLength < AGENT_IMAGE_URL_PASSTHROUGH_MAX_BYTES, "fixture should be small in bytes");

  const block = await normalizeImageContentBlock(urlBlock(), {
    readUrlImage: async () => ({ data: bytes, mimeType: "image/png" }),
  });

  assert.equal(block.type, "image");
  assert.equal(block.source.type, "base64");
  assert.equal(block._meta?.imageUrlPassthrough, undefined);
  assert.equal(block._meta?.originalUrl, sampleUrl);
});

test("a URL image that fails to load becomes omitted text", async () => {
  const block = await normalizeImageContentBlock(urlBlock(), {
    readUrlImage: async () => null,
  });

  assert.equal(block.type, "text");
  assert.equal(block._meta?.imageNormalizationFailed, true);
  assert.equal(block._meta?.reason, "load_failed");
});

test("an original exceeding the URL byte limit is normalized even when its dimensions fit", async () => {
  const data = Buffer.concat([await png(20, 20), Buffer.alloc(AGENT_IMAGE_URL_PASSTHROUGH_MAX_BYTES)]);
  const block = await normalizeImageContentBlock(urlBlock(), { readUrlImage: async () => ({ data, mimeType: "image/png" }) });
  assert.equal(block.type, "image");
  assert.equal(block.source.type, "base64");
  assert.equal(block.source.media_type, "image/webp");
});

test("passthrough dimension cap is at or below the provider's many-image limit", () => {
  assert.ok(AGENT_IMAGE_URL_PASSTHROUGH_MAX_EDGE <= 2000);
});

test("small SVG and TIFF originals are normalized instead of sent as unsupported remote images", async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>');
  const tiff = await sharp(await png(20, 20)).tiff().toBuffer();
  for (const [data, mimeType] of [[svg, "image/svg+xml"], [tiff, "image/tiff"]] as const) {
    const block = await normalizeImageContentBlock(urlBlock(), { readUrlImage: async () => ({ data, mimeType }) });
    assert.equal(block.type, "image");
    assert.equal(block.source.type, "base64");
    assert.equal(block.source.media_type, "image/webp");
  }
});
