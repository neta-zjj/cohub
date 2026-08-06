<script lang="ts">
import {
	formatViewportContextLabel,
	type ViewportContext,
	viewportContextId,
} from "@cohub/protocol";
import { FileText, LayoutGrid, Radio } from "lucide-svelte";

type Props = {
	contexts: ViewportContext[];
	removable?: boolean;
	onRemove?: (id: string) => void;
};

const { contexts, removable = false, onRemove }: Props = $props();

function iconFor(kind: ViewportContext["kind"]) {
	if (kind === "file") return FileText;
	if (kind === "board") return LayoutGrid;
	return Radio;
}

function titleFor(context: ViewportContext) {
	if (context.kind === "file") {
		const lines = context.visibleLines
			? context.visibleLines.start === context.visibleLines.end
				? `L${context.visibleLines.start}`
				: `L${context.visibleLines.start}-${context.visibleLines.end}`
			: null;
		return lines ? `${context.path} · ${lines}` : context.path;
	}
	if (context.kind === "board") {
		const parts = [context.path];
		if (context.selectedNodes?.length) {
			parts.push(
				`${context.selectedNodes.length} selected: ${context.selectedNodes
					.map((node) => node.title || node.id)
					.join(", ")}`,
			);
		}
		if (context.visibleRect) {
			parts.push(
				`view ${Math.round(context.visibleRect.width)}×${Math.round(context.visibleRect.height)}`,
			);
		}
		return parts.join(" · ");
	}
	return context.url
		? `port ${context.port} · ${context.url}`
		: `port ${context.port}`;
}
</script>

{#if contexts.length > 0}
	<div class="flex flex-wrap gap-1.5">
		{#each contexts as context (viewportContextId(context))}
			{@const Icon = iconFor(context.kind)}
			{@const id = viewportContextId(context)}
			<div
				class="group inline-flex max-w-full items-center gap-1.5 rounded-full border border-border-subtle bg-bg-content px-2.5 py-1 text-[11px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
				title={titleFor(context)}
			>
				<Icon class="h-3 w-3 shrink-0 text-text-tertiary" />
				<span class="min-w-0 truncate font-medium tracking-tight">
					{formatViewportContextLabel(context)}
				</span>
				{#if removable}
					<button
						type="button"
						class="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
						title="Remove viewport context"
						aria-label="Remove viewport context"
						onclick={() => onRemove?.(id)}
					>
						×
					</button>
				{/if}
			</div>
		{/each}
	</div>
{/if}
