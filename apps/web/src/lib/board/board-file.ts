import { BOARD_EXTENSION, isBoardPath } from "@cohub/protocol";

export const isBoardFile = isBoardPath;

export function ensureBoardExtension(name: string) {
	const trimmed = name.trim();
	return isBoardFile(trimmed) ? trimmed : `${trimmed}${BOARD_EXTENSION}`;
}

export function getBoardTitle(path: string) {
	return path.split("/").pop() || "Untitled.board";
}
