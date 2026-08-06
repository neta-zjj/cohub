<script lang="ts">
import type {
	MessageToolCallsFile,
	SessionTurnRecord,
	StoredIntermediateMessage,
} from "@cohub/protocol/model";
import { Loader2 } from "lucide-svelte";
import ChatMessageBubble from "$lib/components/ChatMessageBubble.svelte";
import CompactionDivider from "$lib/components/CompactionDivider.svelte";
import GenerationRuntimeStatusRow from "$lib/components/GenerationRuntimeStatusRow.svelte";
import ProcessCard from "$lib/components/ProcessCard.svelte";
import ToolExecutionCard from "$lib/components/ToolExecutionCard.svelte";
import { getModelDisplayName, type ModelCatalogItem } from "$lib/model-catalog";
import type { ChatMessage, TimelineItem } from "$lib/session-tree";
import type { OpenWorkspaceFileTarget } from "$lib/workspace-file-links";

type Props = {
	timeline: TimelineItem[];
	bindListEl?: HTMLDivElement | null;
	/** Number of unseen items at the visual top before triggering preload */
	preloadThreshold?: number;
	onFirstVisible?: (index: number) => void;
	/** Whether the initial/tail turn window is loading */
	loading?: boolean;
	/** Whether older turns are currently being loaded (scroll-up pagination) */
	loadingOlder?: boolean;
	modelsCatalog?: ModelCatalogItem[];
	onMarkdownRenderStart?: (message: ChatMessage) => void;
	onMarkdownRendered?: (message: ChatMessage) => void;
	onLoadIntermediate?: (
		turn: SessionTurnRecord,
	) => Promise<StoredIntermediateMessage[]>;
	onRequestIntermediateSync?: (
		turn: SessionTurnRecord,
	) => Promise<boolean | undefined>;
	onLoadToolCalls?: (input: {
		turn: SessionTurnRecord;
		message: StoredIntermediateMessage;
	}) => Promise<MessageToolCallsFile | null>;
	onOpenFile?: (target: OpenWorkspaceFileTarget) => void;
	onForkTurn?: (turn: SessionTurnRecord) => void;
	forkingTurnId?: string | null;
};

let {
	timeline,
	bindListEl = $bindable(null),
	preloadThreshold = 10,
	onFirstVisible,
	loading = false,
	loadingOlder = false,
	modelsCatalog,
	onMarkdownRenderStart,
	onMarkdownRendered,
	onLoadIntermediate,
	onRequestIntermediateSync,
	onLoadToolCalls,
	onOpenFile,
	onForkTurn,
	forkingTurnId = null,
}: Props = $props();

let observedNodes = new Map<HTMLElement, number>();
let observer: IntersectionObserver | null = null;
let prevScrollHeight = $state(0);

export function preparePrepend() {
	if (!bindListEl) return;
	prevScrollHeight = bindListEl.scrollHeight;
}

export function finalizePrepend() {
	if (!bindListEl || prevScrollHeight === 0) return;
	const newScrollHeight = bindListEl.scrollHeight;
	const addedHeight = newScrollHeight - prevScrollHeight;
	if (addedHeight > 0) {
		bindListEl.scrollTop += addedHeight;
	}
	prevScrollHeight = 0;
}

function observeItem(node: HTMLElement, originalIndex: number) {
	observedNodes.set(node, originalIndex);
	if (observer) {
		observer.observe(node);
	}
	return {
		destroy() {
			observedNodes.delete(node);
			observer?.unobserve(node);
		},
		update(newIndex: number) {
			observedNodes.set(node, newIndex);
		},
	};
}

$effect(() => {
	const _root = bindListEl;

	observer = new IntersectionObserver(
		(entries) => {
			let minIdx = Number.POSITIVE_INFINITY;
			for (const entry of entries) {
				if (entry.isIntersecting) {
					const idx = Number((entry.target as HTMLElement).dataset.idx);
					if (idx < minIdx) minIdx = idx;
				}
			}
			if (minIdx !== Number.POSITIVE_INFINITY) {
				onFirstVisible?.(minIdx);
			}
		},
		{
			root: bindListEl,
			rootMargin: "0px",
			threshold: 0,
		},
	);

	for (const [node] of observedNodes) {
		observer.observe(node);
	}

	return () => {
		observer?.disconnect();
		observer = null;
	};
});
</script>

<div
	bind:this={bindListEl}
	class="chat-timeline-scroll relative flex-1 min-h-0 overflow-y-auto bg-bg-content px-4 sm:px-6"
>
	<div class={`mx-auto max-w-4xl flex flex-col [&>*]:mt-2 pt-6 pb-6`}>
		{#if loading && timeline.length === 0}
			<div class="flex min-h-[42vh] items-center justify-center gap-2 text-[12px] text-text-tertiary">
				<Loader2 class="h-4 w-4 animate-spin" aria-label="Loading turns" />
				<span>Loading turns…</span>
			</div>
		{/if}
		{#each timeline as item, idx (item.id)}
			{@const originalIdx = idx}
			<div
				data-idx={originalIdx}
				data-kind={item.kind}
				data-sequence={item.kind === 'message'
					? item.message.sequence
					: item.kind === 'process'
						? item.turn.sequence
						: undefined}
				data-turn-id={item.kind === 'message' && item.message.meta?.messageKind === 'turn_user'
			? item.message.meta.turnId
			: undefined}
		data-turn-anchor={item.kind === 'message' && item.message.meta?.messageKind === 'turn_user'
			? 'user'
			: undefined}
		data-turn-sequence={item.kind === 'message'
					? Math.floor(item.message.sequence / 10)
					: item.kind === 'process'
						? item.turn.sequence
						: undefined}
				use:observeItem={originalIdx}
			>
				{#if item.kind === 'message'}
					{@const forkTurn = item.message.meta?.turn ?? null}
					<ChatMessageBubble
							message={item.message}
							{modelsCatalog}
							{onMarkdownRenderStart}
							{onMarkdownRendered}
							{onOpenFile}
							onForkTurn={onForkTurn && forkTurn ? () => onForkTurn(forkTurn) : undefined}
							forkDisabled={Boolean(forkingTurnId)}
							forking={forkingTurnId === forkTurn?.id}
					/>
				{:else if item.kind === 'process' && item.turn}
						<ProcessCard turn={item.turn} summary={item.summary} intermediateMessages={item.intermediateMessages} streaming={item.streaming} {modelsCatalog} {onLoadIntermediate} {onRequestIntermediateSync} {onLoadToolCalls} {onOpenFile} />
				{:else if item.kind === 'turn_footer'}
					{@const modelName = getModelDisplayName(modelsCatalog, {
						provider: item.runtimeProvider,
						model: item.runtimeModel,
					})}
					{@const footerLabel =
						item.phase === 'waiting_model'
							? modelName
								? `waiting ${modelName}…`
								: 'waiting model…'
							: 'starting agent…'}
					<div class="px-2 py-1">
						<GenerationRuntimeStatusRow label={footerLabel} compact />
					</div>
				{:else if item.kind === 'tool'}
					<ToolExecutionCard tool={item.tool} {onOpenFile} />
				{:else if item.kind === 'compact'}
					<CompactionDivider turn={item.turn} />
				{/if}
			</div>
		{/each}
		{#if loadingOlder}
			<div class="flex items-center justify-center py-3">
				<Loader2 class="w-3.5 h-3.5 animate-spin text-text-tertiary" aria-label="Loading turns" />
			</div>
		{/if}
	</div>
</div>

<style>
	.chat-timeline-scroll {
		scrollbar-width: none;
		-ms-overflow-style: none;
		/*
		 * Mobile WebKit paints native text selection outside overflow:auto bounds,
		 * so long selections can bleed into the header/composer while scrolling.
		 * A solid mask keeps the selection highlight clipped to this scroller.
		 */
		-webkit-mask-image: linear-gradient(#000 0 0);
		mask-image: linear-gradient(#000 0 0);
	}

	.chat-timeline-scroll::-webkit-scrollbar {
		display: none;
	}

	/* Uniform spacing between items via gap on the parent flex container.
	 * The previous column-reverse + :has() approach was fragile and hard to
	 * reason about — a single gap value is cleaner and predictable.
	 */
</style>
