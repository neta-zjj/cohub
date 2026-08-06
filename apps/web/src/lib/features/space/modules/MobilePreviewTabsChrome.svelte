<script lang="ts">
import { Menu, PanelRightOpen } from "lucide-svelte";
import type { Snippet } from "svelte";
import { uiState } from "$lib/stores/ui.svelte";
import PreviewTabs from "./PreviewTabs.svelte";
import type { PreviewTab } from "./preview-tabs";

const {
	tabs,
	onActivate,
	onClose,
	trailing,
}: {
	tabs: PreviewTab[];
	onActivate: (kind: PreviewTab["kind"], key: string) => void;
	onClose: (kind: PreviewTab["kind"], key: string) => void;
	trailing?: Snippet;
} = $props();
</script>

<div class="mobile-preview-tabs-chrome">
	<button
		type="button"
		class="icon-btn"
		title="Open sidebar"
		aria-label="Open sidebar"
		onclick={() => {
			uiState.mobileDrawerOpen = true;
		}}
	>
		<Menu class="h-5 w-5" />
	</button>
	<div class="min-w-0 flex-1 overflow-hidden">
		<PreviewTabs {tabs} {onActivate} {onClose} embedded />
	</div>
	{#if trailing}
		{@render trailing()}
	{/if}
	<button
		type="button"
		class="icon-btn"
		title="Open files"
		aria-label="Open files"
		onclick={() => {
			uiState.mobileRightDrawerOpen = true;
		}}
	>
		<PanelRightOpen class="h-5 w-5" />
	</button>
</div>

<style>
	.mobile-preview-tabs-chrome {
		display: flex;
		height: 2.75rem;
		flex-shrink: 0;
		align-items: center;
		gap: 0.125rem;
		border-bottom: 1px solid var(--border-subtle);
		background: var(--bg-surface);
		padding: 0 0.25rem 0 0.125rem;
	}

	.mobile-preview-tabs-chrome :global(.preview-tabs) {
		flex: 1 1 auto;
		border-bottom: 0;
		background: transparent;
	}
</style>
