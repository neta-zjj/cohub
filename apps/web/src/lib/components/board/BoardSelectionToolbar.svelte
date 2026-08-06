<script lang="ts">
import { BOARD_COLORS, boardColorCssVar } from "@neta-art/cohub/board";
import {
	AlignCenterHorizontal,
	AlignCenterVertical,
	AlignEndHorizontal,
	AlignEndVertical,
	AlignHorizontalDistributeCenter,
	AlignStartHorizontal,
	AlignStartVertical,
	AlignVerticalDistributeCenter,
	ArrowDownToLine,
	ArrowUpToLine,
	Copy,
	Lock,
	LockOpen,
	Trash2,
} from "lucide-svelte";
import { canTapSelectWithHand } from "$lib/board/board-tool";
import type { BoardEditor } from "$lib/board/editor.svelte";

const { editor }: { editor: BoardEditor } = $props();

const visible = $derived(
	editor.selection.length > 0 &&
		// Direct-pointer Hand taps can safely select without enabling canvas edits.
		(editor.tool === "select" ||
			(editor.tool === "hand" && canTapSelectWithHand(editor.pointerType))) &&
		editor.interaction.type !== "brushing" &&
		editor.interaction.type !== "drawing" &&
		editor.interaction.type !== "creatingArrow" &&
		!editor.editingId,
);

const canAlign = $derived(editor.selection.length >= 2);
const canDistribute = $derived(editor.selection.length >= 3);

const position = $derived.by(() => {
	const bounds = editor.bounds;
	if (!bounds) return null;
	const camera = editor.camera;
	// Keep the toolbar near the selection, clamped away from the top edge.
	const left = (bounds.x + bounds.width / 2) * camera.zoom + camera.x;
	const top = Math.max(36, bounds.y * camera.zoom + camera.y);
	return { left, top };
});

/**
 * The selection's color state for the palette:
 * - `undefined` — no color-bearing shape selected (hide the palette);
 * - a color id — every color-bearing shape shares it (highlight that swatch);
 * - `null` — mixed colors (no highlight).
 */
const currentColor = $derived.by<string | null | undefined>(() => {
	const colors = editor.selectedItems
		.filter(
			(item) =>
				item.type === "text" ||
				item.type === "geo" ||
				item.type === "draw" ||
				item.type === "arrow" ||
				item.type === "frame",
		)
		.map((item) => ("color" in item ? item.color : null));
	if (colors.length === 0) return undefined;
	return colors.every((color) => color === colors[0])
		? (colors[0] ?? null)
		: null;
});
</script>

{#if visible && position}
	<div
		class="board-selection-toolbar"
		style:left="{position.left}px"
		style:top="{position.top}px"
		role="toolbar"
		aria-label="Selection actions"
	>
		{#if currentColor !== undefined}
			<div class="flex items-center gap-1 px-1">
				{#each BOARD_COLORS as color (color.id)}
					<button
						type="button"
						class="swatch"
						class:swatch--active={currentColor === color.id}
						title={color.label}
						aria-label="Set {color.label} color"
						style:--swatch-color="var({boardColorCssVar(color.id, 'stroke')})"
						onclick={() => editor.setSelectionColor(color.id)}
					></button>
				{/each}
			</div>
			<div class="divider"></div>
		{/if}

		{#if canAlign}
			<button type="button" class="sel-btn" title="Align left" aria-label="Align left" onclick={() => editor.alignSelection("left")}>
				<AlignStartVertical class="h-3.5 w-3.5" />
			</button>
			<button type="button" class="sel-btn" title="Align center" aria-label="Align horizontal center" onclick={() => editor.alignSelection("center-x")}>
				<AlignCenterVertical class="h-3.5 w-3.5" />
			</button>
			<button type="button" class="sel-btn" title="Align right" aria-label="Align right" onclick={() => editor.alignSelection("right")}>
				<AlignEndVertical class="h-3.5 w-3.5" />
			</button>
			<button type="button" class="sel-btn" title="Align top" aria-label="Align top" onclick={() => editor.alignSelection("top")}>
				<AlignStartHorizontal class="h-3.5 w-3.5" />
			</button>
			<button type="button" class="sel-btn" title="Align middle" aria-label="Align vertical center" onclick={() => editor.alignSelection("center-y")}>
				<AlignCenterHorizontal class="h-3.5 w-3.5" />
			</button>
			<button type="button" class="sel-btn" title="Align bottom" aria-label="Align bottom" onclick={() => editor.alignSelection("bottom")}>
				<AlignEndHorizontal class="h-3.5 w-3.5" />
			</button>
			{#if canDistribute}
				<button type="button" class="sel-btn" title="Distribute horizontally" aria-label="Distribute horizontally" onclick={() => editor.distributeSelection("horizontal")}>
					<AlignHorizontalDistributeCenter class="h-3.5 w-3.5" />
				</button>
				<button type="button" class="sel-btn" title="Distribute vertically" aria-label="Distribute vertically" onclick={() => editor.distributeSelection("vertical")}>
					<AlignVerticalDistributeCenter class="h-3.5 w-3.5" />
				</button>
			{/if}
			<div class="divider"></div>
		{/if}

		<button type="button" class="sel-btn" title="Bring to front" aria-label="Bring to front" onclick={() => editor.bringToFront()}>
			<ArrowUpToLine class="h-3.5 w-3.5" />
		</button>
		<button type="button" class="sel-btn" title="Send to back" aria-label="Send to back" onclick={() => editor.sendToBack()}>
			<ArrowDownToLine class="h-3.5 w-3.5" />
		</button>

		<div class="divider"></div>

		<button
			type="button"
			class="sel-btn"
			title={editor.selectionLocked ? "Unlock" : "Lock"}
			aria-label={editor.selectionLocked ? "Unlock selection" : "Lock selection"}
			onclick={() => editor.toggleSelectionLock()}
		>
			{#if editor.selectionLocked}
				<Lock class="h-3.5 w-3.5" />
			{:else}
				<LockOpen class="h-3.5 w-3.5" />
			{/if}
		</button>
		<button type="button" class="sel-btn" title="Duplicate" aria-label="Duplicate" onclick={() => editor.duplicateSelection()}>
			<Copy class="h-3.5 w-3.5" />
		</button>
		<button type="button" class="sel-btn sel-btn--danger" title="Delete" aria-label="Delete" onclick={() => editor.deleteSelection()}>
			<Trash2 class="h-3.5 w-3.5" />
		</button>
	</div>
{/if}

<style>
	.board-selection-toolbar {
		position: absolute;
		z-index: 24;
		display: flex;
		align-items: center;
		gap: 2px;
		max-width: calc(100% - 16px);
		overflow-x: auto;
		transform: translate(-50%, calc(-100% - 12px));
		border-radius: 9px;
		border: 1px solid var(--border-subtle);
		background: color-mix(in srgb, var(--bg-elevated) 94%, transparent);
		padding: 4px;
		box-shadow: 0 8px 20px color-mix(in srgb, var(--overlay-scrim-strong) 14%, transparent);
		backdrop-filter: blur(12px);
		white-space: nowrap;
		scrollbar-width: none;
	}
	.board-selection-toolbar::-webkit-scrollbar { display: none; }

	.swatch {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		border: 1.5px solid var(--border-subtle);
		background: var(--swatch-color);
		cursor: pointer;
		transition: transform 100ms ease, border-color 100ms ease;
		flex-shrink: 0;
	}
	.swatch:hover { transform: scale(1.15); }
	.swatch--active {
		border-color: var(--text-primary);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--swatch-color) 40%, transparent);
	}

	.sel-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: 6px;
		color: var(--text-secondary);
		cursor: pointer;
		transition: background-color 100ms ease, color 100ms ease;
		flex-shrink: 0;
	}
	.sel-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
	.sel-btn--danger:hover { background: var(--error-bg); color: var(--error-700); }

	.divider {
		width: 1px;
		height: 16px;
		margin: 0 3px;
		background: var(--border-subtle);
		flex-shrink: 0;
	}

	@media (pointer: coarse) {
		.board-selection-toolbar {
			/* Leave room for the bottom tool dock + home indicator. */
			max-width: calc(100% - 20px);
			/* Prefer above selection; if near bottom the stage already clamps top. */
		}
		.sel-btn { width: 36px; height: 36px; }
		.swatch { width: 22px; height: 22px; }
	}
</style>
