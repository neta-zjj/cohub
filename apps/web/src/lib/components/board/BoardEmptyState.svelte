<script lang="ts">
import { MousePointer2 } from "lucide-svelte";
</script>

<div class="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
	<div class="flex flex-col items-center gap-2 text-center">
		<div class="flex h-10 w-10 items-center justify-center rounded-xl border border-border-subtle bg-bg-surface text-text-tertiary">
			<MousePointer2 class="h-4 w-4" />
		</div>
		<div class="text-sm font-medium text-text-secondary">Start your board</div>
		<div class="max-w-[260px] text-xs leading-5 text-text-tertiary">
			Double-click to write, drag media from the file tree, or pick a tool below.
		</div>
	</div>
</div>
