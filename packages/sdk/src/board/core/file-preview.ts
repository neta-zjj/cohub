/**
 * File-card preview derivation — pure, renderer-agnostic, dependency-free.
 *
 * A board file card is a *thumbnail entry point* to a workspace file, never a
 * second copy of it. So everything here derives display facts from file content
 * that the caller already has, and the resulting snapshot is treated strictly as
 * a cache keyed by the file's mtime: the file on disk stays the single source of
 * truth, and nothing in this module ever writes back to it.
 *
 * Three presentation tiers fall out of which facts are available, so an
 * unrecognised file degrades instead of being rejected:
 *
 * - `cover` — a cover image was declared in markdown frontmatter;
 * - `text`  — text-like content yielded a readable excerpt;
 * - `blank` — anything else (binary, empty, oversized): icon, name and type.
 */

/** Hard cap on a stored excerpt. Board cards show a few lines at most, and the
 * snapshot rides along in every board transaction — so this stays small. */
export const FILE_EXCERPT_MAX_CHARS = 480;

/** Files above this size are shown as `blank`; we never pull them for a preview. */
export const FILE_EXCERPT_MAX_BYTES = 256 * 1024;

/** Frontmatter keys checked for a cover image, in precedence order. */
const COVER_KEYS = [
	"cover",
	"coverImage",
	"cover_image",
	"image",
	"banner",
	"thumbnail",
	"ogImage",
	"og:image",
] as const;

export type FilePreviewKind = "cover" | "text" | "blank";

/**
 * Cached display facts for a file node. Every field is derived from the file and
 * carries `mtimeMs` so a stale snapshot is detectable rather than silently wrong.
 */
export type BoardFileSnapshotFacts = {
	title?: string;
	mimeType?: string;
	size?: number;
	mtimeMs?: number;
	/** Cleaned leading prose, capped at FILE_EXCERPT_MAX_CHARS. */
	excerpt?: string;
	/** Cover declared as a path inside the space, resolved against the file's dir. */
	coverPath?: string;
	/** Cover declared as an absolute `https:` URL. */
	coverUrl?: string;
};

/**
 * Which tier a card renders at. Derived rather than stored: presentation follows
 * from the facts present, so there is no second piece of state to fall out of
 * sync with them.
 */
export function filePreviewKind(
	snapshot: BoardFileSnapshotFacts | undefined,
): FilePreviewKind {
	if (!snapshot) return "blank";
	if (snapshot.coverPath || snapshot.coverUrl) return "cover";
	if (snapshot.excerpt) return "text";
	return "blank";
}

/** Short uppercase type label for the card's meta line (`MD`, `JSON`, `FILE`). */
export function fileTypeLabel(path: string): string {
	// Tolerate a trailing slash so a directory-ish path still labels by name.
	const name = path.split("/").filter(Boolean).pop() ?? path;
	const dot = name.lastIndexOf(".");
	// Dotfiles (`.npmrc`) have no extension — label them by name.
	if (dot <= 0) return (name.replace(/^\./, "") || "file").toUpperCase();
	return name.slice(dot + 1).toUpperCase();
}

/** Human-readable byte size for the meta line. */
export function formatFileSize(bytes: number | undefined): string {
	if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "";
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB", "TB"];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

// ─── Cover resolution ───────────────────────────────────────────────

/**
 * A cover reference, classified by how it must be loaded.
 *
 * `http:` is rejected in favour of `https:` (a board should not downgrade the
 * page to mixed content), and `data:`/`blob:` are rejected because they would
 * embed opaque, unbounded bytes into board data that no other client can verify.
 * Everything else is treated as a path inside the space.
 */
export type ResolvedCover =
	| { kind: "url"; url: string }
	| { kind: "path"; path: string }
	| null;

/** Normalise a space-relative path: resolve `.`/`..` against the file's dir. */
export function resolveSpacePath(fromFilePath: string, ref: string): string {
	const base = ref.startsWith("/")
		? []
		: fromFilePath.split("/").slice(0, -1).filter(Boolean);
	const segments = ref.replace(/^\//, "").split("/");
	const out = [...base];
	for (const segment of segments) {
		if (!segment || segment === ".") continue;
		if (segment === "..") {
			out.pop();
			continue;
		}
		out.push(segment);
	}
	return out.join("/");
}

/**
 * Classify a raw cover reference from frontmatter.
 *
 * Remote covers are allowed on purpose — a lot of real markdown points at a CDN.
 * The trade-off is that opening such a board issues a request to that third
 * party; the renderer degrades silently if it fails, and nothing is retried in a
 * loop.
 */
export function resolveCoverRef(
	fromFilePath: string,
	raw: string | undefined | null,
): ResolvedCover {
	const value = (raw ?? "").trim();
	if (!value) return null;

	// Protocol-relative (`//cdn.example/x.png`) is treated as https.
	if (value.startsWith("//")) return { kind: "url", url: `https:${value}` };

	const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]?.toLowerCase();
	if (scheme) {
		if (scheme === "https") return { kind: "url", url: value };
		// http / data / blob / anything else: not a cover we will load.
		return null;
	}

	const path = resolveSpacePath(fromFilePath, value);
	return path ? { kind: "path", path } : null;
}

// ─── Frontmatter ────────────────────────────────────────────────────

/** A frontmatter block's raw body plus the content that followed it. */
type SplitSource = { frontmatter: string | null; body: string };

/**
 * Split leading YAML frontmatter from a markdown source. Deliberately minimal:
 * this only needs the raw block so a handful of scalar keys can be read, not a
 * YAML parser.
 */
export function splitFrontmatter(source: string): SplitSource {
	if (!/^---[ \t]*\r?\n/.test(source))
		return { frontmatter: null, body: source };
	const lines = source.split(/\r?\n/);
	for (let index = 1; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (line === "---" || line === "...") {
			return {
				frontmatter: lines.slice(1, index).join("\n"),
				body: lines.slice(index + 1).join("\n"),
			};
		}
	}
	// Unterminated block: treat the whole thing as body rather than guessing.
	return { frontmatter: null, body: source };
}

function unquote(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length < 2) return trimmed;
	const first = trimmed[0];
	const last = trimmed[trimmed.length - 1];
	if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

/** Read non-empty top-level scalar values from a frontmatter block. */
function readFrontmatterScalars(
	frontmatter: string | null,
): Map<string, string> {
	const found = new Map<string, string>();
	if (!frontmatter) return found;
	for (const line of frontmatter.split(/\r?\n/)) {
		if (!line.trim() || /^\s/.test(line) || line.trimStart().startsWith("#"))
			continue;
		const match = /^([A-Za-z0-9_:.-]+):(.*)$/.exec(line);
		if (!match) continue;
		const key = match[1];
		const value = unquote(match[2] ?? "");
		if (key && value && !found.has(key)) found.set(key, value);
	}
	return found;
}

/** Read the document title declared by top-level frontmatter. */
export function readTitleFromFrontmatter(
	frontmatter: string | null,
): string | null {
	return readFrontmatterScalars(frontmatter).get("title") ?? null;
}

/**
 * Read the first cover-ish scalar from a frontmatter block.
 *
 * Only top-level keys are considered (a leading-space line is nested and skipped)
 * so `cover:` under some other mapping cannot be mistaken for the file's own.
 */
export function readCoverFromFrontmatter(
	frontmatter: string | null,
): string | null {
	const found = readFrontmatterScalars(frontmatter);
	for (const key of COVER_KEYS) {
		const value = found.get(key);
		if (value) return value;
	}
	return null;
}

// ─── Excerpt ────────────────────────────────────────────────────────

/**
 * Reduce source text to a short, readable excerpt.
 *
 * The goal is a card-sized hint of what the file is about, so markdown
 * decoration is flattened rather than rendered: fenced code is dropped whole
 * (it reads as noise at thumbnail size), headings and emphasis lose their
 * markers, links keep their text, and blank runs collapse.
 */
export function buildFileExcerpt(
	source: string,
	limit = FILE_EXCERPT_MAX_CHARS,
): string {
	if (!source) return "";
	const withoutFences = source.replace(/```[\s\S]*?(?:```|$)/g, " ");
	const cleaned = withoutFences
		// HTML comments and tags.
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(/<\/?[a-z][^>]*>/gi, " ")
		// Images first (so their alt text does not survive as a bare link).
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		// Leading block markers.
		.replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
		.replace(/^[ \t]*>[ \t]?/gm, "")
		.replace(/^[ \t]*[-*+][ \t]+/gm, "")
		.replace(/^[ \t]*\d+\.[ \t]+/gm, "")
		// Horizontal rules and table pipes.
		.replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, " ")
		.replace(/\|/g, " ")
		// Inline emphasis / code markers.
		.replace(/[*_`~]/g, "")
		// Whitespace: keep paragraph breaks, drop the rest.
		.replace(/\r\n?/g, "\n")
		.replace(/[ \t]+/g, " ")
		.replace(/\n{2,}/g, "\n")
		.replace(/[ \t]*\n[ \t]*/g, "\n")
		.trim();
	if (cleaned.length <= limit) return cleaned;
	// Prefer cutting at a word boundary so the ellipsis does not split a token.
	const slice = cleaned.slice(0, limit);
	const lastSpace = slice.lastIndexOf(" ");
	const cut = lastSpace > limit * 0.6 ? slice.slice(0, lastSpace) : slice;
	return `${cut.trimEnd()}…`;
}

// ─── Snapshot ───────────────────────────────────────────────────────

export type BuildSnapshotInput = {
	path: string;
	/** File text, when it could be read as text. Omit for binary/oversized. */
	content?: string | null;
	title?: string;
	mimeType?: string | null;
	size?: number;
	mtimeMs?: number;
};

/** Basename of a path, used as the default card title. */
export function fileBaseName(path: string): string {
	return path.split("/").filter(Boolean).pop() ?? path;
}

/**
 * Build the cached display facts for a file node.
 *
 * Content is optional by design: a snapshot built without it still produces a
 * usable `blank` card, so a node can be created the instant a file is dropped
 * and enriched later without blocking on a read.
 */
export function buildFileSnapshot(
	input: BuildSnapshotInput,
): BoardFileSnapshotFacts {
	const snapshot: BoardFileSnapshotFacts = {
		title: input.title?.trim() || fileBaseName(input.path),
	};
	if (input.mimeType) snapshot.mimeType = input.mimeType;
	if (typeof input.size === "number" && Number.isFinite(input.size))
		snapshot.size = input.size;
	if (typeof input.mtimeMs === "number" && Number.isFinite(input.mtimeMs))
		snapshot.mtimeMs = input.mtimeMs;

	const content = input.content;
	if (typeof content !== "string" || content.length === 0) return snapshot;

	const { frontmatter, body } = splitFrontmatter(content);
	const frontmatterTitle = readTitleFromFrontmatter(frontmatter);
	if (frontmatterTitle) snapshot.title = frontmatterTitle;
	const cover = resolveCoverRef(
		input.path,
		readCoverFromFrontmatter(frontmatter),
	);
	if (cover?.kind === "url") snapshot.coverUrl = cover.url;
	else if (cover?.kind === "path") snapshot.coverPath = cover.path;

	const excerpt = buildFileExcerpt(body);
	if (excerpt) snapshot.excerpt = excerpt;
	return snapshot;
}

/** Whether a snapshot's cached facts still describe the file on disk. */
export function isFileSnapshotFresh(
	snapshot: BoardFileSnapshotFacts | undefined,
	file: { mtimeMs?: number; size?: number },
): boolean {
	if (!snapshot) return false;
	if (snapshot.mtimeMs === undefined || file.mtimeMs === undefined)
		return false;
	if (snapshot.mtimeMs !== file.mtimeMs) return false;
	if (
		snapshot.size !== undefined &&
		file.size !== undefined &&
		snapshot.size !== file.size
	)
		return false;
	return true;
}

/** Whether a file is small enough that fetching a text preview is worthwhile. */
export function shouldFetchFileExcerpt(input: {
	mimeType?: string | null;
	size?: number;
}): boolean {
	if (input.size !== undefined && input.size > FILE_EXCERPT_MAX_BYTES)
		return false;
	return true;
}

// ─── Availability ───────────────────────────────────────────────

/**
 * Whether a referenced file could be read, and if not, whether that is known to
 * be permanent.
 *
 * This distinction is the whole point: a board is a long-lived document, and a
 * card should not claim a file is gone because the network blipped. It is also
 * why availability is client-local transient state and never written to the
 * node — see the rationale in board-file-preview-source.
 */
export type FileAvailability = "ok" | "missing" | "unavailable";

/**
 * Classify a failed read.
 *
 * Only a 404 (or 410 Gone) is treated as the file being absent. Everything else
 * — offline, 5xx, timeout, 401/403 — is `unavailable`: the file may well exist and
 * simply not be reachable by this client right now.
 */
export function availabilityFromError(error: unknown): FileAvailability {
	const status =
		typeof error === "object" && error !== null
			? (error as { status?: unknown }).status
			: undefined;
	if (typeof status !== "number") return "unavailable";
	if (status === 404 || status === 410) return "missing";
	return "unavailable";
}

/**
 * Cache key for a file within a space.
 *
 * A path only means anything relative to its space, and identical paths across
 * spaces are the norm ("README.md"), so every preview cache is keyed by both. The
 * separator is NUL because it cannot appear in a space id or a path, so no path can
 * be crafted to collide with another space's entry.
 */
export function filePreviewScope(spaceId: string, path: string): string {
	return `${spaceId}\u0000${path}`;
}

/**
 * Cache key for one *version* of a file. The mtime is part of the key so a changed
 * file misses the cache instead of serving a stale excerpt or cover.
 */
export function filePreviewMemoKey(
	spaceId: string,
	path: string,
	mtimeMs?: number,
): string {
	return `${filePreviewScope(spaceId, path)}@${mtimeMs ?? 0}`;
}

/**
 * Fold a freshly read snapshot into the cached one.
 *
 * `complete` decides whether the incoming facts supersede the cached ones or are
 * merged over them, and the difference is not cosmetic. A snapshot omits fields the
 * file does not have, so merging a complete read would resurrect a cover or an
 * excerpt the file no longer contains — permanently, since the stale value is then
 * committed back. Merging is right only for an incomplete read, where an absent
 * field means "could not establish", not "not there".
 */
export function mergeFileSnapshot(
	cached: BoardFileSnapshotFacts | undefined,
	incoming: BoardFileSnapshotFacts,
	complete: boolean,
): BoardFileSnapshotFacts {
	return complete ? incoming : { ...cached, ...incoming };
}
