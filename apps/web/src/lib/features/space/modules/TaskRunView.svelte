<script lang="ts">
import type { TaskRunRecord, UserProfile } from "@neta-art/cohub";
import { Check, Copy, GitCommitHorizontal } from "lucide-svelte";
import { onDestroy } from "svelte";
import { goto } from "$app/navigation";
import AudioPlayer from "$lib/components/AudioPlayer.svelte";
import CenteredLoading from "$lib/components/CenteredLoading.svelte";
import MessageContentFlow from "$lib/components/MessageContentFlow.svelte";
import UserIdentity from "$lib/components/UserIdentity.svelte";
import {
	buildSpaceCheckpointRoute,
	buildSpaceCronjobRoute,
} from "$lib/space-routes";
import { displayUserName, formatDateTime } from "../space-utils";
import {
	createTaskRunDetailController,
	type TaskRealtimeEvent,
} from "./task-run-detail-controller.svelte";
import {
	checkpointIdFromTaskRun,
	displaySafeJson,
	formatDurationMs,
	generationBlockLabel,
	generationBlockMeta,
	generationBlockSource,
	generationBlockText,
	generationOutputBlocks,
	runCommandPayload,
	runCommandResultMeta,
	saveCheckpointProgressLabel,
	taskAttemptsLabel,
	taskContextLabel,
	taskIsStreaming,
	taskOutputContent,
	taskRawResult,
	taskRunDuration,
	taskRunStatusBadge,
	taskTypeLabel,
} from "./task-run-utils";

type Props = {
	spaceId: string;
	taskId: string | null;
	taskRealtimeEvent?: TaskRealtimeEvent | null;
	onDetailLoaded?: (run: TaskRunRecord | null) => void;
};

let {
	spaceId,
	taskId,
	taskRealtimeEvent = null,
	onDetailLoaded,
}: Props = $props();

const taskDetail = createTaskRunDetailController({
	getSpaceId: () => spaceId,
	getTaskId: () => taskId,
	onDetailLoaded: (run) => onDetailLoaded?.(run),
});

const taskRunDetail = $derived(taskDetail.detail);
const taskRunDetailLoading = $derived(taskDetail.loading);
const taskRunDetailError = $derived(taskDetail.error);
const taskRunProgress = $derived(taskDetail.progress);
const taskCopiedField = $derived(taskDetail.copiedField);

// Only auto-redirect when this page session watched the task complete.
// Opening an already-finished historical task keeps the task detail page.
let watchedActiveTaskId = $state<string | null>(null);
let redirectedCheckpointTaskId = $state<string | null>(null);

$effect(() => {
	taskDetail.syncRoute();
});

$effect(() => {
	taskDetail.applyRealtimeEvent(taskRealtimeEvent);
});

$effect(() => {
	const run = taskRunDetail;
	if (!run || run.id !== taskId) return;

	if (taskIsStreaming(run)) {
		watchedActiveTaskId = run.id;
		return;
	}

	if (
		run.taskType !== "save_checkpoint" ||
		run.status !== "completed" ||
		watchedActiveTaskId !== run.id ||
		redirectedCheckpointTaskId === run.id
	) {
		return;
	}

	const checkpointId = checkpointIdFromTaskRun(run);
	if (!checkpointId) return;

	redirectedCheckpointTaskId = run.id;
	void goto(buildSpaceCheckpointRoute(spaceId, checkpointId), {
		replaceState: true,
	});
});

onDestroy(() => {
	taskDetail.dispose();
});

function userTitle(
	profile: UserProfile | null | undefined,
	userUuid: string | null | undefined,
): string {
	return [displayUserName(profile, userUuid), userUuid]
		.filter(Boolean)
		.join(" · ");
}
</script>

{#snippet UserMetaItem(profile: UserProfile | null | undefined, userUuid: string | null | undefined)}
	{#if userUuid}
		<UserIdentity
			name={displayUserName(profile, userUuid)}
			avatarUrl={profile?.avatarUrl}
			username={profile?.username}
			title={userTitle(profile, userUuid)}
			size="xxs"
			class="text-[11px] text-text-tertiary"
		/>
	{/if}
{/snippet}

{#snippet CopyIdMetaItem(id: string, copied: boolean, onCopy: () => void, label = "Copy ID")}
	<button
		type="button"
		class="inline-flex min-h-6 min-w-0 max-w-full items-center gap-1.5 font-mono text-[11px] text-text-placeholder transition-colors hover:text-text-secondary"
		onclick={onCopy}
		title={label}
	>
		<span class="truncate">{id}</span>
		{#if copied}
			<Check class="h-3 w-3 shrink-0 text-success-soft" />
		{:else}
			<Copy class="h-3 w-3 shrink-0" />
		{/if}
	</button>
{/snippet}

<div class="flex-1 min-h-0 overflow-y-auto px-3 py-4 sm:px-6 sm:py-5 lg:px-8">
	<div class="max-w-4xl">
		{#if taskRunDetailLoading && taskRunDetail?.id !== taskId}
			<CenteredLoading label="Loading task…" size="panel" />
		{:else if taskRunDetailError}
			<div class="rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] font-mono text-error-soft break-all">{taskRunDetailError}</div>
		{:else if taskRunDetail && taskRunDetail.id === taskId}
			{@const badge = taskRunStatusBadge(taskRunDetail)}
			{@const resultCheckpointId = checkpointIdFromTaskRun(taskRunDetail)}
			{@const saveStageLabel = taskRunDetail.taskType === "save_checkpoint" ? saveCheckpointProgressLabel(taskRunProgress) : null}
			{@const commandInfo = runCommandPayload(taskRunDetail)}
			{@const commandMeta = runCommandResultMeta(taskRunDetail)}
			{@const outputContent = taskOutputContent(taskRunDetail, taskRunProgress)}
			{@const generationBlocks = generationOutputBlocks(taskRunDetail)}
			{@const rawResult = taskRawResult(taskRunDetail)}
			<div class="space-y-6 sm:space-y-8">
				<header class="flex flex-col gap-4 border-b border-border-subtle/70 pb-5 lg:flex-row lg:items-start lg:justify-between">
					<div class="min-w-0 space-y-3">
						<div>
							<h1 class="text-[24px] font-semibold tracking-tight text-text-primary sm:text-[30px]">{taskTypeLabel(taskRunDetail.taskType)}</h1>
							<div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
								<span class="inline-flex items-center gap-1.5 text-[11px] font-medium {badge.color}">
									<span class="relative flex h-1.5 w-1.5 shrink-0">
										{#if taskIsStreaming(taskRunDetail)}
											<span class="absolute inline-flex h-full w-full animate-ping rounded-full {badge.dot} opacity-40"></span>
										{/if}
										<span class="relative inline-flex h-1.5 w-1.5 rounded-full {badge.dot}"></span>
									</span>
									{badge.label}
								</span>
								{@render UserMetaItem(taskRunDetail.userProfile, taskRunDetail.userUuid)}
								{@render CopyIdMetaItem(taskRunDetail.id, taskCopiedField === "id", () => void taskDetail.copyField("id", taskRunDetail!.id), "Copy task ID")}
							</div>
							<div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-text-tertiary">
								<span>{taskContextLabel(taskRunDetail)}</span>
								<span class="text-text-placeholder">·</span>
								<span>{taskAttemptsLabel(taskRunDetail)}</span>
								{#if taskRunDetail.cronJobId}
									<span class="text-text-placeholder">·</span>
									<a
										href={buildSpaceCronjobRoute(spaceId, taskRunDetail.cronJobId)}
										class="text-text-secondary transition-colors hover:text-brand"
										onclick={(e) => { e.preventDefault(); goto(buildSpaceCronjobRoute(spaceId, taskRunDetail!.cronJobId!)); }}
									>view cronjob</a>
								{/if}
							</div>
						</div>
					</div>
				</header>

				{#if taskIsStreaming(taskRunDetail) && taskRunProgress !== null && taskRunProgress !== undefined}
					<section class="space-y-2">
						<div class="text-[11px] font-medium uppercase tracking-wider text-text-placeholder">Progress</div>
						<pre class="max-h-[42vh] overflow-auto rounded-[7px] bg-bg-elevated/35 p-3 text-[12px] font-mono leading-relaxed text-text-secondary whitespace-pre-wrap break-all sm:max-h-80">{displaySafeJson(taskRunProgress, { maxStringLength: 12_000 })}</pre>
					</section>
				{/if}

				{#if taskRunDetail.taskType === "run_command"}
					<section class="space-y-2">
						<div class="text-[11px] font-medium uppercase tracking-wider text-text-placeholder">Command</div>
						<div class="rounded-[8px] bg-bg-elevated/35 px-4 py-3">
							<pre class="max-w-full whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-text-primary sm:text-[14px]">{commandInfo.command}</pre>
							<div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-text-tertiary">
								<span class="font-mono">{commandInfo.cwd}</span>
								{#if commandMeta.exitCode !== null}
									<span class="font-mono">exit {commandMeta.exitCode}</span>
								{/if}
								<span>{formatDurationMs(commandMeta.durationMs)}</span>
								<span>{formatDateTime(taskRunDetail.createdAt)}</span>
							</div>
						</div>
					</section>
				{/if}

				{#if taskRunDetail.taskType === "save_checkpoint"}
					<section class="flex flex-col gap-3 rounded-[8px] bg-bg-elevated/35 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
						<div class="min-w-0">
							<div class="text-[11px] font-medium uppercase tracking-wider text-text-placeholder">Checkpoint</div>
							<div class="mt-1 text-[13px] text-text-secondary">
								{#if resultCheckpointId}
									Save completed and checkpoint is ready.
								{:else if saveStageLabel}
									{saveStageLabel}
								{:else}
									Waiting for checkpoint result…
								{/if}
							</div>
						</div>
						{#if resultCheckpointId}
							<a
								href={buildSpaceCheckpointRoute(spaceId, resultCheckpointId)}
								class="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-[5px] bg-brand-muted px-3 py-2 text-[12px] font-medium text-brand transition-colors hover:bg-brand-muted-hover"
								onclick={(e) => { e.preventDefault(); goto(buildSpaceCheckpointRoute(spaceId, resultCheckpointId)); }}
							>
								<GitCommitHorizontal class="w-3.5 h-3.5" />
								<span>View checkpoint</span>
							</a>
						{/if}
					</section>
				{/if}

				<section class="space-y-5 sm:space-y-6">
					<div class="min-w-0 space-y-6">
						{#if generationBlocks.length > 0}
							<div class="space-y-3">
								<div class="text-[11px] font-medium uppercase tracking-wider text-text-placeholder">Output</div>
								<div class="space-y-3">
									{#each generationBlocks as block, index}
										{@const blockText = generationBlockText(block)}
										{@const blockSrc = generationBlockSource(block)}
										{@const blockMeta = generationBlockMeta(block)}
										<div class="rounded-[8px] bg-bg-elevated/35 p-3">
											<div class="mb-2 flex items-center justify-between gap-3 text-[11px] text-text-tertiary">
												<span class="truncate">{generationBlockLabel(block, index)}</span>
												{#if blockMeta}<span class="shrink-0 font-mono text-text-placeholder">{blockMeta}</span>{/if}
											</div>
											{#if blockText !== null}
												<div class="whitespace-pre-wrap break-words text-[13px] leading-6 text-text-secondary">{blockText}</div>
											{:else if block.type === "image" && blockSrc}
												<img src={blockSrc} alt={generationBlockLabel(block, index)} class="max-h-[60vh] w-full rounded-[6px] object-contain" loading="lazy" />
											{:else if block.type === "video" && blockSrc}
												<video src={blockSrc} controls class="max-h-[60vh] w-full rounded-[6px]"><track kind="captions" label="Generated video" /></video>
											{:else if block.type === "audio" && blockSrc}
												<AudioPlayer
													src={blockSrc}
													title={generationBlockLabel(block, index)}
												/>
											{:else}
												<pre class="max-h-[40vh] overflow-auto text-[12px] font-mono leading-relaxed text-text-secondary whitespace-pre-wrap break-all">{displaySafeJson(block, { maxStringLength: 12_000 })}</pre>
											{/if}
										</div>
									{/each}
								</div>
							</div>
						{:else if outputContent.length > 0}
							<div class="space-y-2">
								<div class="text-[11px] font-medium uppercase tracking-wider text-text-placeholder">Output</div>
								<MessageContentFlow content={outputContent} thinkingExpanded={true} isStreaming={taskIsStreaming(taskRunDetail)} defaultExpandToolCalls />
							</div>
						{:else if taskIsStreaming(taskRunDetail)}
							<div class="py-6 text-[13px] text-text-tertiary">Waiting for output…</div>
						{/if}

						<div class="grid gap-x-8 gap-y-4 sm:grid-cols-2">
							<div class="space-y-1"><div class="text-[11px] font-medium uppercase tracking-wider text-text-placeholder">Scheduled</div><div class="text-[13px] text-text-primary">{formatDateTime(taskRunDetail.scheduledAt)}</div></div>
							<div class="space-y-1"><div class="text-[11px] font-medium uppercase tracking-wider text-text-placeholder">Duration</div><div class="text-[13px] text-text-primary">{taskRunDuration(taskRunDetail)}</div></div>
							<div class="space-y-1"><div class="text-[11px] font-medium uppercase tracking-wider text-text-placeholder">Started</div><div class="text-[13px] text-text-primary">{formatDateTime(taskRunDetail.startedAt)}</div></div>
							<div class="space-y-1"><div class="text-[11px] font-medium uppercase tracking-wider text-text-placeholder">Finished</div><div class="text-[13px] text-text-primary">{formatDateTime(taskRunDetail.finishedAt)}</div></div>
						</div>

						<div class="space-y-2">
							<div class="flex items-center justify-between gap-3">
								<div class="text-[11px] font-medium uppercase tracking-wider text-text-placeholder">Payload</div>
								<button type="button" class="inline-flex min-h-8 items-center gap-1 rounded-[4px] px-2 py-1 text-[11px] text-text-placeholder transition-colors hover:bg-bg-hover hover:text-text-secondary" onclick={() => void taskDetail.copyField("payload", taskRunDetail!.payload)} title="Copy payload">
									{#if taskCopiedField === "payload"}<Check class="h-3 w-3 text-success-soft" /><span class="text-success-soft">Copied</span>{:else}<Copy class="h-3 w-3" /><span>Copy</span>{/if}
								</button>
							</div>
							<pre class="max-h-[48vh] overflow-auto rounded-[7px] bg-bg-elevated/35 p-3 text-[12px] font-mono leading-relaxed text-text-secondary whitespace-pre-wrap break-all sm:max-h-[520px]">{displaySafeJson(taskRunDetail.payload)}</pre>
						</div>

						{#if rawResult}
							<div class="space-y-2">
								<div class="flex items-center justify-between gap-3">
									<div class="text-[11px] font-medium uppercase tracking-wider text-text-placeholder">Result</div>
									<button type="button" class="inline-flex min-h-8 items-center gap-1 rounded-[4px] px-2 py-1 text-[11px] text-text-placeholder transition-colors hover:bg-bg-hover hover:text-text-secondary" onclick={() => void taskDetail.copyField("result", rawResult)} title="Copy result">
										{#if taskCopiedField === "result"}<Check class="h-3 w-3 text-success-soft" /><span class="text-success-soft">Copied</span>{:else}<Copy class="h-3 w-3" /><span>Copy</span>{/if}
									</button>
								</div>
								<pre class="max-h-[48vh] overflow-auto rounded-[7px] bg-bg-elevated/35 p-3 text-[12px] font-mono leading-relaxed text-text-secondary whitespace-pre-wrap break-all sm:max-h-[520px]">{displaySafeJson(rawResult)}</pre>
							</div>
						{/if}

						{#if taskRunDetail.errorMessage}
							<div class="rounded-[7px] bg-error-bg p-4">
								<div class="text-[11px] font-medium uppercase tracking-wider text-error-soft">Error</div>
								<div class="mt-2 text-[13px] text-error-soft whitespace-pre-wrap break-all">{taskRunDetail.errorMessage}</div>
							</div>
						{/if}
					</div>
				</section>
			</div>
		{:else}
			<div class="text-[12px] text-text-tertiary">Task run not found.</div>
		{/if}
	</div>
</div>
