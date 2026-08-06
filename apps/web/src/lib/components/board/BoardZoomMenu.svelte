<script lang="ts">
import { LocateFixed, Minus, Plus } from "lucide-svelte";
import type { BoardEditor } from "$lib/board/editor.svelte";

const {
	editor,
	immersive = false,
}: { editor: BoardEditor; immersive?: boolean } = $props();

const zoomPercent = $derived(Math.round(editor.camera.zoom * 100));
</script>

<div class="board-zoom-menu" class:board-zoom-menu--immersive={immersive}>
	<button type="button" class="zoom-btn" title="Zoom out" aria-label="Zoom out" onclick={() => editor.zoomOut()}>
		<Minus class="h-3.5 w-3.5" />
	</button>
	<button
		type="button"
		class="zoom-value"
		title="Reset to 100%"
		aria-label="Reset zoom to 100%"
		onclick={() => editor.resetZoom()}
	>
		{zoomPercent}%
	</button>
	<button type="button" class="zoom-btn" title="Zoom in" aria-label="Zoom in" onclick={() => editor.zoomIn()}>
		<Plus class="h-3.5 w-3.5" />
	</button>
	<div class="divider"></div>
	<button type="button" class="zoom-btn" title="Zoom to fit" aria-label="Zoom to fit" onclick={() => editor.fitView()}>
		<LocateFixed class="h-3.5 w-3.5" />
	</button>
</div>

<style>
	.board-zoom-menu {
		position: absolute;
		right: 14px;
		bottom: 14px;
		z-index: 25;
		display: flex;
		align-items: center;
		gap: 2px;
		border-radius: 9px;
		border: 1px solid var(--border-subtle);
		background: color-mix(in srgb, var(--bg-elevated) 94%, transparent);
		padding: 4px;
		box-shadow: 0 8px 20px color-mix(in srgb, var(--overlay-scrim-strong) 14%, transparent);
		backdrop-filter: blur(12px);
	}

	.board-zoom-menu--immersive {
		right: var(--preview-safe-right, 10px);
	}

	/* Touch: park zoom top-right so it never collides with the tool dock. */
	@media (pointer: coarse) {
		.board-zoom-menu {
			top: calc(12px + env(safe-area-inset-top, 0px));
			right: 10px;
			bottom: auto;
			padding: 5px;
		}
		.zoom-btn { width: 34px; height: 34px; }
		.zoom-value { min-width: 48px; height: 34px; font-size: 12px; }
	}

	@media (pointer: coarse) and (max-width: 480px) {
		.board-zoom-menu {
			/* Compact: hide "fit" on the narrowest phones via order if needed later */
			max-width: calc(100vw - 20px);
		}
	}

	.zoom-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: 6px;
		color: var(--text-secondary);
		cursor: pointer;
		transition: background-color 100ms ease, color 100ms ease;
	}
	.zoom-btn:hover { background: var(--bg-hover); color: var(--text-primary); }

	.zoom-value {
		min-width: 44px;
		height: 26px;
		border-radius: 6px;
		color: var(--text-tertiary);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		cursor: pointer;
		transition: background-color 100ms ease, color 100ms ease;
	}
	.zoom-value:hover { background: var(--bg-hover); color: var(--text-primary); }

	.divider {
		width: 1px;
		height: 16px;
		margin: 0 3px;
		background: var(--border-subtle);
	}
</style>
