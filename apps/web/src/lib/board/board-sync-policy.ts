export type BoardIdentity = {
	path: string;
	boardId: string | null;
};

export function hasBoardIdentity(
	boards: readonly BoardIdentity[],
	boardId: string,
): boolean {
	return boards.some((board) => board.boardId === boardId);
}

export function boardPathMatchesTarget(
	boardPath: string,
	targetPath: string,
	recursive: boolean,
): boolean {
	return (
		boardPath === targetPath ||
		(recursive && boardPath.startsWith(`${targetPath}/`))
	);
}

export function canAdoptBoardVersion(
	currentVersion: number | null,
	incomingVersion: number,
): boolean {
	return currentVersion == null || incomingVersion >= currentVersion;
}
