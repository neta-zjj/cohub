<script lang="ts">
import {
	BOARD_COLORS,
	BOARD_STROKE_MAX_SIZE,
	BOARD_STROKE_MIN_SIZE,
	boardColorCssVar,
	DEFAULT_BOARD_TOOL_STYLES,
	GEO_KINDS,
	type GeoKind,
} from "@neta-art/cohub/board";
import {
	ArrowUpRight,
	Circle,
	Diamond,
	Frame,
	Hand,
	MousePointer2,
	Pencil,
	Redo2,
	Square,
	SquareRoundCorner,
	Triangle,
	Type,
	Undo2,
} from "lucide-svelte";
import type { BoardEditor, BoardToolId } from "$lib/board/editor.svelte";
import BoardNumberControl from "$lib/components/board/BoardNumberControl.svelte";

const {
	editor,
	immersive = false,
}: { editor: BoardEditor; immersive?: boolean } = $props();

let styleOpen = $state(false);
let previousTool = $state<BoardToolId | null>(null);

type ToolDef = {
	id: BoardToolId;
	label: string;
	shortcut: string;
	icon: typeof MousePointer2;
	/** Creation tools that expose their contextual style row. */
	hasStyle: boolean;
};

const TOOLS: ToolDef[] = [
	{
		id: "select",
		label: "Select",
		shortcut: "V",
		icon: MousePointer2,
		hasStyle: false,
	},
	{ id: "hand", label: "Hand", shortcut: "H", icon: Hand, hasStyle: false },
	{ id: "draw", label: "Draw", shortcut: "D", icon: Pencil, hasStyle: true },
	{
		id: "arrow",
		label: "Arrow",
		shortcut: "A",
		icon: ArrowUpRight,
		hasStyle: true,
	},
	{ id: "text", label: "Text", shortcut: "T", icon: Type, hasStyle: true },
	{ id: "geo", label: "Shape", shortcut: "G", icon: Square, hasStyle: true },
	{
		id: "frame",
		label: "Frame",
		shortcut: "F",
		icon: Frame,
		hasStyle: true,
	},
];

const activeTool = $derived(
	TOOLS.find((candidate) => candidate.id === editor.tool),
);
const showStyles = $derived(Boolean(activeTool?.hasStyle && styleOpen));

$effect(() => {
	const current = editor.tool;
	if (current === previousTool) return;
	previousTool = current;
	styleOpen = Boolean(
		TOOLS.find((candidate) => candidate.id === current)?.hasStyle,
	);
});

const GEO_OPTIONS: Record<GeoKind, { label: string; icon: typeof Square }> = {
	rectangle: { label: "Rectangle", icon: Square },
	rounded: { label: "Rounded rectangle", icon: SquareRoundCorner },
	ellipse: { label: "Ellipse", icon: Circle },
	diamond: { label: "Diamond", icon: Diamond },
	triangle: { label: "Triangle", icon: Triangle },
};

function selectTool(id: BoardToolId) {
	const tool = TOOLS.find((candidate) => candidate.id === id);
	const styleWasOpen = editor.tool === id && styleOpen;
	editor.tool = id;
	styleOpen = Boolean(tool?.hasStyle && !styleWasOpen);
}

function toolTitle(tool: ToolDef) {
	const stay = tool.id === "draw" ? " · stay active" : "";
	return `${tool.label} (${tool.shortcut})${stay}`;
}
</script>

<div class="board-toolbar-wrap" class:board-toolbar-wrap--immersive={immersive}>
	{#if showStyles}
		<div class="board-style-row" role="toolbar" aria-label="{activeTool?.label ?? 'Tool'} style">
			{#if editor.tool === "draw" || editor.tool === "arrow"}
				<span class="style-kind" title="Stroke width" aria-hidden="true">
					{#if editor.tool === "draw"}
						<Pencil class="h-3.5 w-3.5" />
					{:else}
						<ArrowUpRight class="h-3.5 w-3.5" />
					{/if}
				</span>
				<BoardNumberControl
					value={editor.activeStrokeSize}
					fallback={editor.tool === "draw"
						? DEFAULT_BOARD_TOOL_STYLES.draw.size
						: DEFAULT_BOARD_TOOL_STYLES.arrow.size}
					min={BOARD_STROKE_MIN_SIZE}
					max={BOARD_STROKE_MAX_SIZE}
					step={editor.tool === "draw" ? 1 : 0.5}
					label="Stroke width"
					onChange={(value) => { editor.activeStrokeSize = value; }}
				/>
				<div class="style-divider"></div>
			{/if}

			<div class="color-list" role="group" aria-label="Color">
				{#each BOARD_COLORS as color (color.id)}
					<button
						type="button"
						class="color-swatch"
						class:color-swatch--active={editor.activeColor === color.id}
						title={color.label}
						aria-label="Use {color.label}"
						style:--swatch="var({boardColorCssVar(color.id, 'stroke')})"
						onclick={() => { editor.activeColor = color.id; }}
					></button>
				{/each}
			</div>

			{#if editor.tool === "geo"}
				<div class="style-divider"></div>
				{#each GEO_KINDS as geo (geo)}
					{@const option = GEO_OPTIONS[geo]}
					<button
						type="button"
						class="geo-btn"
						class:geo-btn--active={editor.activeGeo === geo}
						title={option.label}
						aria-label="Use {option.label}"
						onclick={() => { editor.activeGeo = geo; }}
					>
						<option.icon class="h-3.5 w-3.5" />
					</button>
				{/each}
			{/if}
		</div>
	{/if}

	<div class="board-floating-toolbar" role="toolbar" aria-label="Board tools">
		{#each TOOLS as tool (tool.id)}
			<button
				type="button"
				class="tool-btn"
				class:tool-btn--active={editor.tool === tool.id}
				title={toolTitle(tool)}
				aria-label="{tool.label} tool"
				aria-pressed={editor.tool === tool.id}
				aria-expanded={tool.hasStyle
					? editor.tool === tool.id && showStyles
					: undefined}
				onclick={() => selectTool(tool.id)}
			>
				<tool.icon class="h-4 w-4" />
			</button>
		{/each}

		<div class="divider history-divider"></div>

		<button
			type="button"
			class="tool-btn history-btn"
			title="Undo"
			aria-label="Undo"
			disabled={!editor.canUndo}
			onclick={() => editor.undo()}
		>
			<Undo2 class="h-4 w-4" />
		</button>
		<button
			type="button"
			class="tool-btn history-btn"
			title="Redo"
			aria-label="Redo"
			disabled={!editor.canRedo}
			onclick={() => editor.redo()}
		>
			<Redo2 class="h-4 w-4" />
		</button>
	</div>
</div>

<style>
	.board-toolbar-wrap {
		position: absolute;
		bottom: 14px;
		left: 50%;
		z-index: 25;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		width: max-content;
		max-width: calc(100% - 20px);
		transform: translateX(-50%);
	}

	.board-toolbar-wrap--immersive {
		left: var(--preview-safe-left, 10px);
		right: var(--preview-safe-right, 10px);
		width: auto;
		max-width: none;
		transform: none;
	}

	.board-style-row {
		display: flex;
		align-items: center;
		gap: 4px;
		max-width: 100%;
		overflow-x: auto;
		border-radius: 9px;
		border: 1px solid var(--border-subtle);
		background: color-mix(in srgb, var(--bg-elevated) 94%, transparent);
		padding: 4px 6px;
		box-shadow: 0 8px 20px color-mix(in srgb, var(--overlay-scrim-strong) 14%, transparent);
		backdrop-filter: blur(12px);
		scrollbar-width: none;
	}
	.board-style-row::-webkit-scrollbar { display: none; }

	.style-kind {
		display: inline-flex;
		width: 18px;
		height: 24px;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		color: var(--text-tertiary);
	}

	.color-list {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.color-swatch {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		border: 1.5px solid var(--border-subtle);
		background: var(--swatch);
		cursor: pointer;
		transition: transform 100ms ease, border-color 100ms ease;
	}
	.color-swatch:hover { transform: scale(1.15); }
	.color-swatch--active {
		border-color: var(--text-primary);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--swatch) 45%, transparent);
	}

	.geo-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: 6px;
		border: 1px solid transparent;
		color: var(--text-secondary);
		cursor: pointer;
		transition: background-color 100ms ease, color 100ms ease;
	}
	.geo-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
	.geo-btn--active {
		background: var(--brand-bg);
		border-color: var(--brand-border);
		color: var(--brand-muted-fg);
	}

	.style-divider {
		width: 1px;
		height: 16px;
		margin: 0 2px;
		background: var(--border-subtle);
	}

	.board-floating-toolbar {
		display: flex;
		align-items: center;
		gap: 2px;
		border-radius: 10px;
		border: 1px solid var(--border-subtle);
		background: color-mix(in srgb, var(--bg-elevated) 94%, transparent);
		padding: 4px;
		box-shadow: 0 10px 24px color-mix(in srgb, var(--overlay-scrim-strong) 16%, transparent);
		backdrop-filter: blur(12px);
	}

	.tool-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: 7px;
		border: 1px solid transparent;
		color: var(--text-secondary);
		cursor: pointer;
		transition: background-color 100ms ease, color 100ms ease, border-color 100ms ease;
	}
	.tool-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
	.tool-btn--active {
		background: var(--brand-bg);
		border-color: var(--brand-border);
		color: var(--brand-muted-fg);
	}
	.tool-btn:disabled { opacity: 0.4; cursor: not-allowed; }

	.divider {
		width: 1px;
		height: 18px;
		margin: 0 3px;
		background: var(--border-subtle);
	}

	/* Mobile: larger targets, safe-area, room for top zoom.
	   Visual sizes stay compact; `::after` grows the hit box to the 44px
	   recommendation without pushing the row wider. */
	@media (pointer: coarse) {
		.board-toolbar-wrap {
			bottom: calc(10px + env(safe-area-inset-bottom, 0px));
			width: calc(100% - 16px);
			max-width: calc(100vw - 16px);
		}
		.tool-btn,
		.color-swatch,
		.geo-btn,
		.style-kind { position: relative; }
		.tool-btn::after,
		.color-swatch::after,
		.geo-btn::after,
		.style-kind::after {
			content: "";
			position: absolute;
			left: 50%;
			top: 50%;
			translate: -50% -50%;
			min-width: 44px;
			min-height: 44px;
			width: 100%;
			height: 100%;
		}
		.board-floating-toolbar {
			max-width: 100%;
			overflow-x: auto;
			scrollbar-width: none;
			-webkit-overflow-scrolling: touch;
			padding: 5px;
			gap: 3px;
		}
		.board-floating-toolbar::-webkit-scrollbar { display: none; }
		.board-style-row {
			max-width: 100%;
			overflow-x: auto;
			scrollbar-width: none;
		}
		.board-style-row::-webkit-scrollbar { display: none; }
		.tool-btn { width: 40px; height: 40px; flex-shrink: 0; }
		.style-kind { width: 24px; height: 32px; }
		.color-list { gap: 6px; }
		.color-swatch { width: 26px; height: 26px; flex-shrink: 0; }
		.geo-btn { width: 32px; height: 32px; flex-shrink: 0; }
	}

	@media (pointer: coarse) and (max-width: 480px) {
		.board-toolbar-wrap {
			bottom: calc(8px + env(safe-area-inset-bottom, 0px));
		}
		/* The row scrolls horizontally, so history stays reachable instead of being
		   dropped — a phone has no keyboard shortcut to fall back on. */
		.tool-btn { width: 38px; height: 38px; }
	}
</style>
