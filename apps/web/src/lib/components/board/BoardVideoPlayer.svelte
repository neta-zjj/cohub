<script lang="ts">
import type { BoardAssetSource } from "$lib/board/board-asset-source";
import type { BoardEditor } from "$lib/board/editor.svelte";

const {
	editor,
	assetSource,
	active = true,
}: {
	editor: BoardEditor;
	assetSource: BoardAssetSource;
	active?: boolean;
} = $props();

let videoEl: HTMLVideoElement | null = $state(null);
let src = $state<string | null>(null);
let loading = $state(false);
let error = $state<string | null>(null);

const item = $derived.by(() => {
	const id = editor.editingId;
	if (!id) return null;
	const found = editor.itemById(id);
	return found?.type === "video" ? found : null;
});

const path = $derived(item?.ref.path ?? null);

const layout = $derived.by(() => {
	const video = item;
	if (!video) return null;
	const camera = editor.camera;
	const zoom = camera.zoom;
	const width = video.frame.width * zoom;
	const height = video.frame.height * zoom;
	const left = video.frame.x * zoom + camera.x;
	const top = video.frame.y * zoom + camera.y;
	return {
		left,
		top,
		width,
		height,
		rotation: video.frame.rotation || 0,
	};
});

// Resolve URL keyed only by `path`. Always clear the previous src on switch so
// the player never keeps showing video A after opening B.
$effect(() => {
	const nextPath = path;
	if (!nextPath) {
		src = null;
		error = null;
		loading = false;
		return;
	}

	src = null;
	error = null;
	loading = true;
	let cancelled = false;

	void assetSource
		.resolveFileUrl(nextPath)
		.then((url) => {
			if (cancelled) return;
			if (!url) {
				error = "Could not load video";
				src = null;
				return;
			}
			src = url;
		})
		.catch(() => {
			if (cancelled) return;
			error = "Could not load video";
			src = null;
		})
		.finally(() => {
			if (!cancelled) loading = false;
		});

	return () => {
		cancelled = true;
	};
});

$effect(() => {
	// Focus the player when it mounts so keyboard space works.
	if (active && videoEl && src) {
		queueMicrotask(() => videoEl?.focus());
	}
});

$effect(() => {
	if (!active) videoEl?.pause();
});

function stopPropagation(event: Event) {
	event.stopPropagation();
}

function close() {
	editor.editingId = null;
}
</script>

{#if item && layout}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="board-video-player"
		style:left="{layout.left}px"
		style:top="{layout.top}px"
		style:width="{layout.width}px"
		style:height="{layout.height}px"
		style:transform="rotate({layout.rotation}deg)"
		onpointerdown={stopPropagation}
		onwheel={stopPropagation}
		data-drawer-swipe-ignore
	>
		{#if src}
			<!-- svelte-ignore a11y_media_has_caption -->
			<!-- key forces a fresh media element when the path changes -->
			{#key path}
				<video
					bind:this={videoEl}
					class="board-video-el"
					src={src}
					controls
					playsinline
					preload="metadata"
					aria-label={item.snapshot?.title ?? "Video"}
				></video>
			{/key}
		{:else}
			<div class="board-video-status">
				{#if loading}
					Loading…
				{:else}
					{error ?? "Unavailable"}
				{/if}
			</div>
		{/if}
		<button
			type="button"
			class="board-video-close"
			title="Close player"
			aria-label="Close player"
			onclick={close}
		>
			×
		</button>
	</div>
{/if}

<style>
	.board-video-player {
		position: absolute;
		z-index: 28;
		transform-origin: top left;
		overflow: hidden;
		border-radius: 6px;
		border: 1.5px solid var(--brand-border);
		background: var(--bg-primary);
		box-shadow: 0 10px 28px color-mix(in srgb, var(--overlay-scrim-strong) 20%, transparent);
	}

	.board-video-el {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
		background: var(--bg-primary);
		/* Let native controls receive pointer events. */
		pointer-events: auto;
	}

	.board-video-status {
		display: flex;
		height: 100%;
		align-items: center;
		justify-content: center;
		color: var(--text-tertiary);
		font-size: 12px;
	}

	.board-video-close {
		position: absolute;
		top: 6px;
		right: 6px;
		display: inline-flex;
		width: 24px;
		height: 24px;
		align-items: center;
		justify-content: center;
		border: 0;
		border-radius: 6px;
		background: color-mix(in srgb, var(--bg-elevated) 88%, transparent);
		color: var(--text-secondary);
		font-size: 16px;
		line-height: 1;
		cursor: pointer;
	}
	.board-video-close:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}
</style>
