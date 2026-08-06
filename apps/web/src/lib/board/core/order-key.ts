/**
 * Stable z-order keys for board nodes.
 *
 * A node's position in the document is stored as an `orderKey` string, and the
 * server returns nodes sorted by it lexicographically. The keys therefore have to
 * satisfy exactly one property:
 *
 *     a < b as strings  iff  a sits before b in the document
 *
 * The obvious encoding — the node's array index, zero-padded — satisfies that, but
 * it makes every key a function of every other node: inserting or deleting one
 * node shifts every later index, so one delete rewrites the key of every node
 * after it. On a large board that turns a single edit into thousands of node
 * patches, and past the server's per-transaction operation cap, into an edit that
 * cannot be saved at all.
 *
 * So keys are minted *between their neighbours* instead. A delete leaves every
 * remaining key untouched and still correctly ordered; an insert mints one key
 * between two others and touches nothing else. The number of keys an edit rewrites
 * is proportional to the edit, not to the board.
 *
 * Keys are decimal-digit strings, so they interoperate with the zero-padded index
 * keys written by earlier versions: a midpoint between two legacy keys is just a
 * longer digit string that sorts between them, and no migration is needed.
 *
 * The one trap worth naming, because it is easy to reintroduce: with lexicographic
 * comparison a *shorter* string can be numerically larger yet sort first ("4101"
 * sorts before "5"). So arithmetic on a key is only order-preserving while the
 * width stays constant. Every numeric step below is width-checked for that reason.
 */

/** Width of a freshly minted sparse key; matches the legacy padded format. */
const KEY_WIDTH = 8;
/**
 * Gap between freshly assigned keys. Leaves room for several successive midpoint
 * insertions at the same spot before a key needs to grow a digit.
 */
const STEP = 4096;
/** Mid digit, appended when a key only has to sort after a given prefix. */
const MID = "5";
/**
 * Length past which a minted key is treated as a failure and the run is
 * renumbered instead.
 *
 * Bisecting a narrow gap grows keys one digit at a time, so minting a long run
 * into a tight gap costs O(run²) in string work. Renumbering is O(n) with uniform
 * width, so past this bound it is both faster and tidier. The bound is generous:
 * normal editing never approaches it (measured max is ~13 digits after thousands
 * of random edits).
 */
const MAX_MINTED_KEY_LENGTH = 48;

/**
 * Width needed to hold `count` sparse keys without any of them growing a digit.
 *
 * Fixed-width is what makes the sparse numbering sort correctly, so the width has
 * to be chosen for the whole run up front: a run that overflows its width would
 * wrap around into a *smaller* string and invert the order ("100004096" sorts
 * before "99999744").
 */
function sparseWidth(count: number): number {
	const largest = Math.max(1, count) * STEP;
	return Math.max(KEY_WIDTH, String(largest).length);
}

/** The sparse key for `index`, encoded at `width` digits. */
function sparseKeyAt(index: number, width: number): string {
	return String((index + 1) * STEP).padStart(width, "0");
}

/**
 * The sparse key for position `index` in a fresh numbering of `count` nodes.
 * `count` is required because the width depends on the whole run (see above).
 */
export function sparseOrderKey(index: number, count = index + 1): string {
	return sparseKeyAt(index, sparseWidth(count));
}

/** Digit at `index`, or -1 past the end (a shorter string sorts first). */
function digitAt(key: string, index: number): number {
	return index >= key.length ? -1 : key.charCodeAt(index) - 48;
}

/** Numeric value of a key, or null when it is not a plain digit string. */
function numericValue(key: string): number | null {
	if (key === "" || !/^[0-9]+$/.test(key)) return null;
	const value = Number(key);
	return Number.isSafeInteger(value) ? value : null;
}

/**
 * Re-encode `value` at exactly `width` digits, or null if it does not fit.
 * Same-width encodings are the only ones where numeric order matches string order.
 */
function atWidth(value: number, width: number): string | null {
	if (value < 0) return null;
	const text = String(value);
	return text.length <= width ? text.padStart(width, "0") : null;
}

/**
 * The smallest sensible key strictly greater than `key`.
 *
 * Steps numerically while the width allows, so a board that only ever appends
 * keeps short, evenly spaced keys. Once the width is exhausted it falls back to
 * appending a digit, which always sorts after the original.
 */
function keyAbove(key: string | null): string {
	if (key === null || key === "") return MID;
	const value = numericValue(key);
	if (value !== null) {
		const stepped = atWidth(value + STEP, key.length);
		if (stepped !== null) return stepped;
	}
	return `${key}${MID}`;
}

/**
 * A key strictly between `before` and `after`, or null when none exists.
 *
 * Null is only reachable immediately below an all-zeros key (nothing sorts between
 * "" and "0"); callers treat it as "renumber this run instead".
 */
export function orderKeyBetween(
	before: string | null,
	after: string | null,
): string | null {
	if (before !== null && after !== null && before >= after) return null;
	if (after === null) return keyAbove(before);

	if (before === null) {
		// Halve towards zero at constant width.
		const value = numericValue(after);
		if (value !== null && value > 1) {
			const half = atWidth(Math.floor(value / 2), after.length);
			if (half !== null && half < after) return half;
		}
		// All zeros (or not numeric): the only way down is a shorter string.
		const shorter = after.slice(0, -1);
		return shorter !== "" && shorter < after ? shorter : null;
	}

	// Both bounds set and same width: an integer midpoint keeps the key short.
	if (before.length === after.length) {
		const low = numericValue(before);
		const high = numericValue(after);
		if (low !== null && high !== null && high - low >= 2) {
			const mid = atWidth(Math.floor((low + high) / 2), before.length);
			if (mid !== null && mid > before && mid < after) return mid;
		}
	}

	// Otherwise walk the shared prefix and split at the first differing digit.
	let index = 0;
	let prefix = "";
	for (;;) {
		const low = digitAt(before, index);
		const high = digitAt(after, index);
		if (low === high) {
			prefix += before[index];
			index += 1;
			continue;
		}
		if (high - low >= 2) {
			// Room for a digit strictly between them; the key ends here.
			return prefix + String(Math.floor((low + high) / 2));
		}
		// Adjacent digits (or `before` ran out). Keep `before`'s digit and extend its
		// tail: anything above that tail is still below `after`, which has already
		// diverged upwards at this position.
		const digit = low < 0 ? "0" : String(low);
		return `${prefix}${digit}${keyAbove(before.slice(index + 1) || null)}`;
	}
}

/**
 * Assign order keys for a document, preserving existing keys wherever possible.
 *
 * Returns only the keys that *changed* — usually none, and the caller already has
 * the current key on each node, so returning a full map would allocate an entry
 * per node on every commit for no reason.
 *
 * Nodes are read through accessors rather than arrays so the common path (keys
 * already in order) allocates nothing at all: it is a single scan and an empty map.
 *
 * For an append, a delete, or an edit that does not change z-order, the result is
 * empty or holds a single entry. A reorder re-keys only the nodes that genuinely
 * had to move past another. Only when a gap is too tight to hold the keys it needs
 * does this renumber everything — which is what every edit used to do
 * unconditionally.
 */
export function assignOrderKeys(
	count: number,
	idAt: (index: number) => string,
	keyAt: (index: number) => string | null,
): Map<string, string> {
	// Fast path: already strictly increasing with no gaps. One pass, no allocation.
	// Covers any pure geometry or content edit, and any delete.
	let clean = true;
	let previous: string | null = null;
	for (let i = 0; i < count; i += 1) {
		const key = keyAt(i);
		if (key == null || key === "" || (previous !== null && key <= previous)) {
			clean = false;
			break;
		}
		previous = key;
	}
	if (clean) return new Map();

	const ids: string[] = new Array(count);
	const normalized: Array<string | null> = new Array(count);
	for (let i = 0; i < count; i += 1) {
		ids[i] = idAt(i);
		const key = keyAt(i);
		normalized[i] = key == null || key === "" ? null : key;
	}
	const keepable = longestIncreasingRun(normalized);
	const kept: Array<string | null> = normalized.map((key, index) =>
		keepable.has(index) ? key : null,
	);

	const changed = new Map<string, string>();
	let index = 0;
	while (index < count) {
		if (kept[index] != null) {
			index += 1;
			continue;
		}
		// A run of positions needing new keys, bounded by the nearest kept keys.
		let end = index;
		while (end < count && kept[end] == null) end += 1;
		const lower = index > 0 ? (kept[index - 1] ?? null) : null;
		const upper = end < count ? (kept[end] ?? null) : null;
		const minted = mintRun(end - index, lower, upper);
		if (minted === null) return renumberAll(ids, normalized);
		for (let offset = 0; offset < minted.length; offset += 1) {
			const id = ids[index + offset];
			const key = minted[offset];
			if (
				id !== undefined &&
				key !== undefined &&
				key !== normalized[index + offset]
			)
				changed.set(id, key);
		}
		index = end;
	}
	return changed;
}
/**
 * Indices of a longest strictly-increasing subsequence of `values`.
 *
 * This is what makes reordering cheap: every key on the LIS can be kept, so the
 * set that must be rewritten is the smallest possible. Greedily keeping keys from
 * the left would instead rewrite nearly everything when one node moves from the
 * end to the front. O(n log n).
 */
function longestIncreasingRun(values: readonly (string | null)[]): Set<number> {
	// Patience sorting: `tails[k]` is the index ending the best length-(k+1) run.
	const tails: number[] = [];
	const previous = new Array<number>(values.length).fill(-1);
	for (let i = 0; i < values.length; i += 1) {
		const value = values[i];
		if (value === null || value === undefined) continue;
		let lo = 0;
		let hi = tails.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			const tailIndex = tails[mid];
			const tailValue = tailIndex === undefined ? undefined : values[tailIndex];
			if (tailValue != null && tailValue < value) lo = mid + 1;
			else hi = mid;
		}
		previous[i] = lo > 0 ? (tails[lo - 1] ?? -1) : -1;
		tails[lo] = i;
	}
	const result = new Set<number>();
	let cursor = tails.length > 0 ? (tails[tails.length - 1] ?? -1) : -1;
	while (cursor >= 0) {
		result.add(cursor);
		cursor = previous[cursor] ?? -1;
	}
	return result;
}

/** `count` strictly increasing keys between two bounds, or null if impossible. */
function mintRun(
	count: number,
	lower: string | null,
	upper: string | null,
): string[] | null {
	if (count <= 0) return [];
	// Fresh numbering: sparse fixed-width keys, sized for the whole run.
	if (lower === null && upper === null) {
		const width = sparseWidth(count);
		return Array.from({ length: count }, (_, index) =>
			sparseKeyAt(index, width),
		);
	}
	// Bulk insert into a wide same-width gap (paste, duplicate): spread evenly so
	// the whole run stays at one width instead of bisecting into longer keys.
	if (lower !== null && upper !== null && lower.length === upper.length) {
		const low = numericValue(lower);
		const high = numericValue(upper);
		if (low !== null && high !== null && high - low > count) {
			const stride = Math.floor((high - low) / (count + 1));
			const spread: string[] = [];
			for (let i = 1; i <= count; i += 1) {
				const key = atWidth(low + stride * i, lower.length);
				if (key === null) break;
				spread.push(key);
			}
			if (spread.length === count) return spread;
		}
	}
	const result: string[] = [];
	let low = lower;
	for (let i = 0; i < count; i += 1) {
		const key = orderKeyBetween(low, upper);
		// Guard against a midpoint that cannot make further progress, and against a
		// tight gap degenerating into ever-longer keys.
		if (key === null || key.length > MAX_MINTED_KEY_LENGTH) return null;
		if (upper !== null && key >= upper) return null;
		result.push(key);
		low = key;
	}
	return result;
}

/** Fresh sparse numbering for every node. The rare fallback. */
function renumberAll(
	ids: readonly string[],
	currentKeys: readonly (string | null)[],
): Map<string, string> {
	const changed = new Map<string, string>();
	const width = sparseWidth(ids.length);
	ids.forEach((id, index) => {
		const key = sparseKeyAt(index, width);
		if (key !== currentKeys[index]) changed.set(id, key);
	});
	return changed;
}
