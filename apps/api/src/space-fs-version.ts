export type SpaceFsVersion = {
	size?: number;
	mtimeMs?: number;
};

export function matchesSpaceFsVersion(
	actual: SpaceFsVersion,
	expected: { size: number; mtimeMs: number },
) {
	return actual.size === expected.size && actual.mtimeMs === expected.mtimeMs;
}
