export type Point = { x: number; y: number };

export type MarkTool = "pen" | "arrow" | "rect" | "crop";

export type MarkColor = "brand" | "red" | "yellow" | "white";

export const MARK_COLOR_HEX = {
	brand: "#FF3E00",
	red: "#EF4444",
	yellow: "#EAB308",
	white: "#F8FAFC",
} satisfies Record<MarkColor, `#${string}`>;

export type FrameSource =
	| { kind: "image"; path: string }
	| { kind: "html"; path: string }
	| { kind: "port"; port: string; url: string }
	| { kind: "viewport" }
	| { kind: "unknown" };

export type CaptureQuality =
	| "element"
	| "region"
	| "cropped-window"
	| "full"
	| "image";

export type FrozenFrame = {
	bitmap: ImageBitmap;
	width: number;
	height: number;
	dpr: number;
	capturedAt: number;
	quality: CaptureQuality;
	source: FrameSource;
};

export type CaptureFailureReason =
	| "permission-denied"
	| "unsupported"
	| "iframe-not-ready"
	| "capture-failed";

export type CaptureResult =
	| { ok: true; frame: FrozenFrame }
	| { ok: false; reason: CaptureFailureReason; message: string };

export type Stroke =
	| {
			id: string;
			tool: "pen";
			color: MarkColor;
			points: Point[];
			width: number;
	  }
	| {
			id: string;
			tool: "arrow";
			color: MarkColor;
			from: Point;
			to: Point;
			width: number;
	  }
	| {
			id: string;
			tool: "rect";
			color: MarkColor;
			a: Point;
			b: Point;
			width: number;
	  };

export type CropRect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type PreviewCaptureTarget =
	| {
			kind: "image";
			src: string;
			path: string;
	  }
	| {
			kind: "iframe";
			element: HTMLIFrameElement;
			source: Extract<FrameSource, { kind: "html" | "port" }>;
	  };

export function suggestedMarkedName(source: FrameSource): string {
	if (source.kind === "port") return `port-${source.port}-marked.webp`;
	if (source.kind === "html" || source.kind === "image") {
		const base =
			source.path
				.split("/")
				.filter(Boolean)
				.pop()
				?.replace(/\.[^.]+$/, "") || "preview";
		return `${base}-marked.webp`;
	}
	if (source.kind === "viewport") return "screen-marked.webp";
	return "preview-marked.webp";
}
