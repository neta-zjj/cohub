<script lang="ts">
import type { SpacePortStatus } from "@cohub/protocol/ports";
import PortPreview from "$lib/components/PortPreview.svelte";
import MobilePreviewTabsChrome from "./MobilePreviewTabsChrome.svelte";

import type { PreviewTab } from "./preview-tabs";

type Props = {
	previewTabs: PreviewTab[];
	port: string;
	url: string;
	status: SpacePortStatus | "unknown";
	observedAt?: number;
	immersive: boolean;
	isMobile: boolean;
	treeVisible?: boolean;
	onToggleTree?: () => void | Promise<void>;
	onToggleImmersive: () => void | Promise<void>;
	onPublish: () => void;
	onActivatePreviewTab: (kind: PreviewTab["kind"], key: string) => void;
	onClosePreviewTab: (kind: PreviewTab["kind"], key: string) => void;
};

let {
	previewTabs,
	port,
	url,
	status,
	observedAt,
	immersive,
	isMobile,
	treeVisible = true,
	onToggleTree,
	onToggleImmersive,
	onPublish,
	onActivatePreviewTab,
	onClosePreviewTab,
}: Props = $props();
</script>

<div class="flex h-full min-w-0 flex-col bg-bg-content" class:preview-stage--immersive={immersive}>
	{#if isMobile}
		<MobilePreviewTabsChrome
			tabs={previewTabs}
			onActivate={onActivatePreviewTab}
			onClose={onClosePreviewTab}
		/>
	{/if}
	<div class="min-h-0 flex-1">
		<PortPreview
			{port}
			{url}
			{status}
			{observedAt}
			{immersive}
			previewTabs={previewTabs}
			filesVisible={treeVisible}
			onActivatePreview={onActivatePreviewTab}
			onClosePreview={onClosePreviewTab}
			onToggleFiles={onToggleTree}
			onExitFloat={onToggleImmersive}
			onPublish={onPublish}
		/>
	</div>
</div>
