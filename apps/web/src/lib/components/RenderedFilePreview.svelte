<script lang="ts">
import type { WorkRecord } from "@neta-art/cohub";
import { onDestroy, untrack } from "svelte";
import * as publicEnv from "$env/static/public";
import MarkdownView from "$lib/components/MarkdownView.svelte";
import { readWorkCheckoutState } from "$lib/components/work/work-checkout-state";
import type { PreviewCaptureTarget } from "$lib/features/preview-mark";
import { createWorkBridgeHost } from "$lib/features/work/bridge-host.svelte";
import WorkAuthorizeDialog from "$lib/features/work/WorkAuthorizeDialog.svelte";
import WorkPurchaseDialog from "$lib/features/work/WorkPurchaseDialog.svelte";
import {
	createSpacePreviewSessionController,
	type SpacePreviewTarget,
} from "$lib/space-preview-session.svelte";
import type { WorkspaceFileLinkTarget } from "$lib/workspace-file-links";

let {
	name,
	source,
	type,
	path = null,
	spaceId = null,
	readonly = false,
	work = null,
	markTarget = $bindable(null),
	onOpenFile,
}: {
	name: string;
	source: string;
	type: "markdown" | "html";
	path?: string | null;
	spaceId?: string | null;
	readonly?: boolean;
	/** When set, auto-host work runtime APIs for this published file. */
	work?: WorkRecord | null;
	/** Outbound mark capture target for parent chrome. */
	markTarget?: PreviewCaptureTarget | null;
	onOpenFile?: (target: WorkspaceFileLinkTarget) => void | Promise<void>;
} = $props();

const previewOrigin =
	publicEnv.PUBLIC_PREVIEW_ORIGIN?.replace(/\/+$/, "") ?? "";
let frame: HTMLIFrameElement | null = $state(null);
let lastSrcdocFrame: HTMLIFrameElement | null = null;
let lastSrcdoc = "";

const canUsePreviewOrigin = $derived(
	Boolean(type === "html" && !readonly && previewOrigin && spaceId && path),
);
const previewKey = $derived(
	`${type}:${previewOrigin}:${spaceId ?? ""}:${path ?? ""}`,
);
const previewSession = createSpacePreviewSessionController({
	getTarget: (): SpacePreviewTarget | null =>
		canUsePreviewOrigin && spaceId && path
			? { origin: previewOrigin, spaceId, path }
			: null,
	errorMessage: "Preview failed to load.",
});

// Auto-enable work bridge when this HTML file is a published work.
const host = $derived.by(() => {
	if (!work || type !== "html" || !canUsePreviewOrigin) return null;
	return createWorkBridgeHost({
		work,
		reply: (requestId, payload) => {
			frame?.contentWindow?.postMessage(
				{ requestId, ...payload },
				previewOrigin,
			);
		},
		getCheckoutState: () =>
			readWorkCheckoutState(new URL(window.location.href)),
	});
});

function handleFrameMessage(event: MessageEvent) {
	if (
		!host ||
		event.source !== frame?.contentWindow ||
		event.origin !== previewOrigin
	)
		return;
	void host.handleMessage(event);
}

// Publish mark context to parent chrome (button lives in the file header).
$effect(() => {
	if (type !== "html" || !frame || !path) {
		markTarget = null;
		return;
	}
	markTarget = {
		kind: "iframe",
		element: frame,
		source: { kind: "html", path },
	};
});

$effect(() => {
	previewKey;
	if (type !== "html") return;
	void untrack(() => previewSession.reset());
	return previewSession.stop;
});

// Fallback srcdoc path: only rewrite when source or iframe node actually
// changes so panel resizes never reassign iframe.srcdoc and reload the page.
$effect(() => {
	if (type !== "html" || canUsePreviewOrigin) return;
	const nextSource = source;
	const el = frame;
	if (!el) return;
	if (lastSrcdocFrame === el && lastSrcdoc === nextSource) return;
	lastSrcdocFrame = el;
	lastSrcdoc = nextSource;
	el.srcdoc = nextSource;
});

$effect(() => {
	window.addEventListener("message", handleFrameMessage);
	return () => window.removeEventListener("message", handleFrameMessage);
});

onDestroy(() => {
	markTarget = null;
	previewSession.stop();
});
</script>

{#if type === "markdown"}
	<MarkdownView {source} variant="document" baseFilePath={path} {onOpenFile} />
{:else if canUsePreviewOrigin}
	<div class="relative flex h-full min-h-0 flex-col bg-white">
		{#if previewSession.error}
			<div class="flex flex-1 items-center justify-center p-4 text-xs text-error-soft">{previewSession.error}</div>
		{:else if previewSession.src}
			<iframe
				bind:this={frame}
				class="min-h-0 flex-1 border-0 bg-white"
				title={`HTML preview: ${name}`}
				sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
				src={previewSession.src}
			></iframe>
		{:else}
			<div class="flex flex-1 items-center justify-center p-4 text-xs text-text-tertiary">Loading preview…</div>
		{/if}
	</div>
	{#if host}
		<WorkPurchaseDialog
			open={host.purchaseOpen && !!host.pendingPurchase}
			pending={host.pendingPurchase}
			error={host.purchaseError}
			saving={host.purchaseSaving}
			onConfirm={() => void host.confirmPurchase()}
			onCancel={host.cancelPurchase}
		/>
		<WorkAuthorizeDialog
			open={host.authOpen && !!host.pendingAuth}
			pending={host.pendingAuth}
			error={host.authError}
			saving={host.authSaving}
			workName={work?.slug ?? "Preview"}
			authorName="Cohub"
			onConfirm={() => void host.confirmAuth()}
			onCancel={host.cancelAuth}
		/>
	{/if}
{:else}
	<div class="relative h-full w-full">
		<iframe
			bind:this={frame}
			class="h-full w-full border-0 bg-white"
			title={`HTML preview: ${name}`}
			sandbox="allow-scripts"
		></iframe>
	</div>
{/if}
