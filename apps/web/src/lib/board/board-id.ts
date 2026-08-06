export function createBoardItemId() {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return `item_${crypto.randomUUID()}`;
	}
	return `item_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
