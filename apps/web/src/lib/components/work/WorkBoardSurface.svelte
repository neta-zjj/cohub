<script lang="ts">
import type { WorkBoardArtifactManifest, WorkContent } from "@neta-art/cohub";
import { createWorkBoardAssetSource } from "$lib/board/board-asset-source";
import { boardBootstrapToDocument } from "$lib/board/board-document";
import {
	boardRuntimeDataFromBootstrap,
	resolveBoardRuntime,
} from "$lib/board/runtime/board-runtime";
import CenteredLoading from "$lib/components/CenteredLoading.svelte";

const {
	content,
	isMobile = false,
}: {
	content: Extract<WorkContent, { kind: "board" }>;
	isMobile?: boolean;
} = $props();

type LoadedBoard = {
	url: string;
	manifest: WorkBoardArtifactManifest;
};

let loaded = $state<LoadedBoard | null>(null);
let error = $state<string | null>(null);

const manifest = $derived(loaded?.url === content.url ? loaded.manifest : null);
// The published snapshot is the whole document: no Space, no realtime, no reads.
const board = $derived.by(() => {
	if (!manifest) return null;
	const bootstrap = manifest.snapshot;
	return {
		document: boardBootstrapToDocument(bootstrap),
		runtime: boardRuntimeDataFromBootstrap(bootstrap),
		assetSource: createWorkBoardAssetSource({
			manifestUrl: content.url,
			assets: manifest.assets,
		}),
	};
});
const runtimeModule = $derived.by(() =>
	board ? resolveBoardRuntime(board.document).load() : null,
);

$effect(() => {
	const url = content.url;
	let cancelled = false;
	error = null;
	void fetch(url)
		.then(async (response) => {
			if (!response.ok)
				throw new Error(`Failed to load board (${response.status})`);
			return (await response.json()) as WorkBoardArtifactManifest;
		})
		.then((value) => {
			if (cancelled) return;
			if (value?.kind !== "cohub.work.board" || !value.snapshot?.board) {
				throw new Error("Board artifact is invalid.");
			}
			loaded = { url, manifest: value };
		})
		.catch((cause: unknown) => {
			if (cancelled) return;
			error = cause instanceof Error ? cause.message : "Failed to load board.";
		});
	return () => {
		cancelled = true;
	};
});
</script>

<div class="work-board-surface">
	{#if error}
		<div class="board-message error">{error}</div>
	{:else if !board || !runtimeModule}
		<CenteredLoading label="Loading board…" size="page" />
	{:else}
		{#await runtimeModule}
			<CenteredLoading label="Loading board…" size="page" />
		{:then module}
			{@const BoardRuntime = module.default}
			{#key content.url}
				<BoardRuntime
					mode="view"
					path={content.path}
					boardId={content.boardId}
					document={board.document}
					runtime={board.runtime}
					spaceId={manifest?.snapshot.board.spaceId ?? ""}
					assetSource={board.assetSource}
					{isMobile}
				/>
			{/key}
		{:catch}
			<div class="board-message error">Board failed to load.</div>
		{/await}
	{/if}
</div>

<style>
	.work-board-surface {
		height: 100%;
		min-height: 0;
		background: var(--bg-primary);
	}

	.board-message {
		display: flex;
		height: 100%;
		min-height: 240px;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
		font-size: 0.8125rem;
	}

	.board-message.error {
		color: var(--error-soft);
	}
</style>
