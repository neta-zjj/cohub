import type { SpaceFsChange } from "@cohub/protocol/fs";

export function buildCreatedDirectoryChanges(paths: string[] | undefined): SpaceFsChange[] {
  return (paths ?? []).map((path) => ({
    path,
    kind: "create",
    nodeType: "dir",
  }));
}

export function buildFileMutationChanges(input: {
  path: string;
  created: boolean;
  createdDirs?: string[];
  size: number;
  mtimeMs: number;
}): SpaceFsChange[] {
  return [
    ...buildCreatedDirectoryChanges(input.createdDirs),
    {
      path: input.path,
      kind: input.created ? "create" : "modify",
      nodeType: "file",
      size: input.size,
      mtimeMs: input.mtimeMs,
    },
  ];
}
