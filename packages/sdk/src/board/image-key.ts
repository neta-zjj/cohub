import type { BoardItem } from "@cohub/protocol/board-document";

/**
 * Stable cache key for an item's image resource, or null when it has none.
 *
 * Space files and remote URLs are namespaced so they can never collide, and file
 * cards contribute their cover image — which means covers ride the exact same
 * reference counting, LRU cooling pool and viewport preloading as image nodes,
 * with no second loader to keep in step. The exporter resolves the same keys, so
 * an exported card shows the same picture the editor does.
 */
export function imageAssetKey(item: BoardItem): string | null {
  if (item.type === "image") return `file:${item.ref.path}`;
  if (item.type === "file") {
    const snapshot = item.snapshot;
    if (snapshot?.coverPath) return `file:${snapshot.coverPath}`;
    if (snapshot?.coverUrl) return `url:${snapshot.coverUrl}`;
    return null;
  }
  return null;
}

/** The source a key resolves from, recovered from its namespace prefix. */
export function boardImageKeySource(
  key: string,
): { kind: "file" | "url"; value: string } | null {
  if (key.startsWith("file:")) return { kind: "file", value: key.slice(5) };
  if (key.startsWith("url:")) return { kind: "url", value: key.slice(4) };
  return null;
}
