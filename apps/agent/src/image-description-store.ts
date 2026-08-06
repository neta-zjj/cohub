import type { ContentBlock, Usage } from "@cohub/protocol/core";
import { sessionTurns } from "@cohub/db";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db.js";

export type StoredImageDescription = {
  text: string;
  provider: string;
  model: string;
  usage: Usage | null;
  generatedAt: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function readImageDescription(block: Extract<ContentBlock, { type: "image" }>): StoredImageDescription | null {
  const cohub = asRecord(block._meta?.cohub);
  const value = asRecord(cohub?.imageDescription);
  const text = typeof value?.text === "string" ? value.text.trim() : "";
  if (!text) return null;
  return {
    text,
    provider: typeof value?.provider === "string" ? value.provider : "unknown",
    model: typeof value?.model === "string" ? value.model : "unknown",
    usage: asRecord(value?.usage) as Usage | null,
    generatedAt: typeof value?.generatedAt === "string" ? value.generatedAt : new Date(0).toISOString(),
  };
}

function withImageDescription(
  block: Extract<ContentBlock, { type: "image" }>,
  description: StoredImageDescription,
): Extract<ContentBlock, { type: "image" }> {
  const cohub = asRecord(block._meta?.cohub) ?? {};
  return {
    ...block,
    _meta: {
      ...(block._meta ?? {}),
      cohub: { ...cohub, imageDescription: description },
    },
  };
}

function getImageByOrdinal(content: ContentBlock[], imageIndex: number) {
  let current = 0;
  for (const [blockIndex, block] of content.entries()) {
    if (block.type !== "image") continue;
    if (current === imageIndex) return { blockIndex, block };
    current += 1;
  }
  return null;
}

export async function loadTurnImageDescriptions(turnIds: string[]): Promise<Map<string, StoredImageDescription>> {
  if (turnIds.length === 0) return new Map();
  const rows = await db.select({ id: sessionTurns.id, userContent: sessionTurns.userContent })
    .from(sessionTurns)
    .where(inArray(sessionTurns.id, [...new Set(turnIds)]));
  const descriptions = new Map<string, StoredImageDescription>();
  for (const row of rows) {
    let imageIndex = 0;
    for (const block of row.userContent) {
      if (block.type !== "image") continue;
      const description = readImageDescription(block);
      if (description) descriptions.set(`${row.id}:${imageIndex}`, description);
      imageIndex += 1;
    }
  }
  return descriptions;
}

export async function persistTurnImageDescription(input: {
  sessionId: string;
  turnId: string;
  imageIndex: number;
  description: StoredImageDescription;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ userContent: sessionTurns.userContent })
      .from(sessionTurns)
      .where(and(eq(sessionTurns.id, input.turnId), eq(sessionTurns.sessionId, input.sessionId)))
      .for("update")
      .limit(1);
    if (!row) return false;

    const content = structuredClone(row.userContent);
    const image = getImageByOrdinal(content, input.imageIndex);
    if (!image) return false;
    if (readImageDescription(image.block)) return true;
    content[image.blockIndex] = withImageDescription(image.block, input.description);
    await tx.update(sessionTurns)
      .set({ userContent: content })
      .where(and(eq(sessionTurns.id, input.turnId), eq(sessionTurns.sessionId, input.sessionId)));
    return true;
  });
}
