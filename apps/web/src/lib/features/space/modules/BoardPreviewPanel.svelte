<script lang="ts">
import type { BoardDocument } from "@neta-art/cohub/board";
import type {
	BoardAutomationActivity,
	BoardCollaboratorProfile,
} from "$lib/board/board-activity";
import {
	type BoardCommitHandler,
	type BoardRuntimeData,
	type BoardRuntimeProps,
	type BoardRuntimeViewState,
	resolveBoardRuntime,
} from "$lib/board/runtime/board-runtime";
import MobilePreviewTabsChrome from "./MobilePreviewTabsChrome.svelte";
import PreviewFloatChrome from "./PreviewFloatChrome.svelte";
import type { PreviewTab } from "./preview-tabs";

type InlineBoardPanelState = {
	path: string;
	boardId: string | null;
	document: BoardDocument | null;
	runtime: BoardRuntimeData | null;
	loading: boolean;
	saving: boolean;
	error: string | null;
	saveError: string | null;
};

type Props = {
	board: InlineBoardPanelState;
	previewTabs: PreviewTab[];
	spaceId: string;
	active?: boolean;
	immersive: boolean;
	isMobile: boolean;
	collaborators?: Map<string, BoardCollaboratorProfile>;
	activities?: BoardAutomationActivity[];
	onOpenActivity?: (activity: BoardAutomationActivity) => void | Promise<void>;
	treeVisible?: boolean;
	onToggleTree?: () => void | Promise<void>;
	onToggleImmersive: () => void | Promise<void>;
	onCommit: (
		boardId: string,
		path: string,
		document: Parameters<BoardCommitHandler>[0],
		ops: Parameters<BoardCommitHandler>[1],
	) => void | Promise<void>;
	onRetrySave: (boardId: string) => void | Promise<void>;
	onActivatePreviewTab: (kind: PreviewTab["kind"], key: string) => void;
	onClosePreviewTab: (kind: PreviewTab["kind"], key: string) => void;
	onViewStateChange?: (state: BoardRuntimeViewState) => void;
	/** Open a workspace file in the preview panel (file cards route here). */
	onOpenFile?: (path: string) => void | Promise<void>;
};

let {
	board,
	previewTabs,
	spaceId,
	active = true,
	immersive,
	isMobile,
	collaborators = new Map(),
	activities = [],
	onOpenActivity,
	treeVisible = true,
	onToggleTree,
	onToggleImmersive,
	onCommit,
	onRetrySave,
	onActivatePreviewTab,
	onClosePreviewTab,
	onViewStateChange,
	onOpenFile,
}: Props = $props();

let boardRuntimeLoadAttempt = $state(0);
const boardRuntimeModulePromise = $derived.by(() => {
	boardRuntimeLoadAttempt;
	if (!board.document) throw new Error("Board data is unavailable.");
	return resolveBoardRuntime(board.document).load();
});
</script>

{#snippet TabsChrome()}
	{#if isMobile}
		<MobilePreviewTabsChrome
			tabs={previewTabs}
			onActivate={onActivatePreviewTab}
			onClose={onClosePreviewTab}
		/>
	{:else if immersive}
		<PreviewFloatChrome
			tabs={previewTabs}
			filesVisible={treeVisible}
			onActivate={onActivatePreviewTab}
			onClose={onClosePreviewTab}
			onToggleFiles={onToggleTree}
			onExit={onToggleImmersive}
		/>
	{/if}
{/snippet}

{#snippet LoadingPanel()}
	<div class="flex h-full min-w-0 flex-col bg-bg-primary">
		{@render TabsChrome()}
		<div class="flex flex-1 items-center justify-center text-xs text-text-tertiary">Loading…</div>
	</div>
{/snippet}

{#if board.loading}
	{@render LoadingPanel()}
{:else if board.error}
	<div class="flex h-full min-w-0 flex-col bg-bg-primary">
		{@render TabsChrome()}
		<div class="m-4 rounded-lg border border-error-soft/30 bg-error-bg p-4 text-sm text-error-soft">{board.error}</div>
	</div>
{:else if board.boardId && board.document && board.runtime}
	{#await boardRuntimeModulePromise}
		{@render LoadingPanel()}
	{:then boardRuntimeModule}
		{@const BoardRuntime = boardRuntimeModule.default}
		<div class="relative flex h-full min-w-0 flex-col bg-bg-primary">
			{@render TabsChrome()}
			<div class="min-h-0 flex-1">
				{#key board.boardId}
					<BoardRuntime
						path={board.path}
						boardId={board.boardId}
						document={board.document}
						runtime={board.runtime}
						spaceId={spaceId}
						{active}
						{immersive}
						{isMobile}
						{collaborators}
						{activities}
						{onOpenActivity}
						syncError={board.saveError}
						onCommit={(document, ops) => onCommit(board.boardId as string, board.path, document, ops)}
						onRetrySync={() => onRetrySave(board.boardId as string)}
						{onViewStateChange}
						{onOpenFile}
					/>
				{/key}
			</div>
		</div>
	{:catch}
		<div class="flex h-full min-w-0 flex-col bg-bg-primary">
			{@render TabsChrome()}
			<div class="m-4 flex flex-col items-start gap-2 rounded-lg border border-error-soft/30 bg-error-bg p-4 text-sm text-error-soft">
				<span>Board failed to load.</span>
				<button type="button" class="action-btn" onclick={() => { boardRuntimeLoadAttempt += 1; }}>Retry</button>
			</div>
		</div>
	{/await}
{:else}
	<div class="flex h-full min-w-0 flex-col bg-bg-primary">
		{@render TabsChrome()}
		<div class="m-4 rounded-lg border border-error-soft/30 bg-error-bg p-4 text-sm text-error-soft">Board data is unavailable.</div>
	</div>
{/if}
