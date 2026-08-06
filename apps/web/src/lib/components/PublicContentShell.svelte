<script lang="ts">
import type { Snippet } from "svelte";

const {
	sidebarLabel,
	sidebar,
	children,
}: {
	sidebarLabel: string;
	sidebar: Snippet;
	children: Snippet;
} = $props();
</script>

<div
	class="mx-auto flex w-full max-w-7xl gap-0 px-0 lg:gap-10 lg:px-8 lg:pb-16 lg:pt-2"
>
	<aside
		class="sticky top-12 hidden h-[calc(100vh-3rem)] w-56 shrink-0 overflow-y-auto overscroll-contain py-8 pr-2 [scrollbar-width:thin] lg:block"
		aria-label={sidebarLabel}
	>
		{@render sidebar()}
	</aside>

	<div class="min-w-0 flex-1">
		{@render children()}
	</div>
</div>
