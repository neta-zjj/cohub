const IMAGE_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"avif",
	"svg",
]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v", "ogg"]);
const TEXT_EXTENSIONS = new Set([
	"txt",
	"md",
	"json",
	"yaml",
	"yml",
	"csv",
	"ts",
	"tsx",
	"js",
	"jsx",
	"css",
	"html",
	"xml",
	"py",
	"sh",
]);

export type BoardMediaKind = "image" | "video" | "text" | "file";

export function getExtension(value: string) {
	const clean = value.split(/[?#]/, 1)[0] ?? value;
	const name = clean.split("/").pop() ?? clean;
	const index = name.lastIndexOf(".");
	return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
}

export function inferMediaKind(
	value: string,
	mimeType?: string | null,
): BoardMediaKind {
	if (mimeType?.startsWith("image/")) return "image";
	if (mimeType?.startsWith("video/")) return "video";
	if (mimeType?.startsWith("text/") || mimeType === "application/json")
		return "text";
	const ext = getExtension(value);
	if (IMAGE_EXTENSIONS.has(ext)) return "image";
	if (VIDEO_EXTENSIONS.has(ext)) return "video";
	if (TEXT_EXTENSIONS.has(ext)) return "text";
	return "file";
}

export function getResourceTitle(value: string) {
	try {
		const url = new URL(value);
		return decodeURIComponent(
			url.pathname.split("/").filter(Boolean).pop() || url.hostname,
		);
	} catch {
		return value.split("/").filter(Boolean).pop() || value;
	}
}
