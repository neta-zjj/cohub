<script lang="ts">
/**
 * Entry-path story (UX start), not the differentiator pitch:
 * Start a Space (web or CLI local) → Build & Save → Publish a Live Work.
 * @space stays in the differentials section.
 */
const steps = [
	{
		num: "01",
		title: "Start a Space",
		body: "Open one on the web, or run cohub sandbox up on a local folder so that directory becomes the Space sandbox.",
		kind: "start" as const,
	},
	{
		num: "02",
		title: "Build & Save",
		body: "People and agents share one context — chats, files, previews. Save a Checkpoint when something is worth keeping.",
		kind: "build" as const,
	},
	{
		num: "03",
		title: "Publish a Live Work",
		body: "Share a public app that exposes your Space — not a static export. Visitors can act back on the Space after they authorize.",
		kind: "work" as const,
	},
];
</script>

<div class="grid gap-4 md:grid-cols-3">
	{#each steps as step (step.num)}
		<article class="step">
			<div class="mock mock-{step.kind}" aria-hidden="true">
				{#if step.kind === "start"}
					<div class="term">
						<span class="prompt">$</span>
						<span class="cmd">cohub sandbox up ./my-project</span>
					</div>
					<div class="hint">local folder · linked as Space sandbox</div>
				{:else if step.kind === "build"}
					<div class="build-row">
						<span class="pill">you</span>
						<span class="bar" style="max-width:72%"></span>
					</div>
					<div class="build-row">
						<span class="pill agent">agent</span>
						<span class="tool">✎ edit index.html</span>
					</div>
					<div class="build-row">
						<span class="pill save">save</span>
						<span class="bar brand-bar" style="max-width:48%"></span>
					</div>
					<div class="hint">Checkpoint · immutable snapshot</div>
				{:else}
					<div class="work-card">
						<div class="url-row">
							<span class="live-dot"></span>
							<span class="mono">cohub.run/you/lab/w/demo</span>
						</div>
						<div class="scope-row">
							<span class="scope">workScopes</span>
							<span class="scope soft">file.view</span>
							<span class="scope soft">session.view</span>
						</div>
						<div class="scope-row">
							<span class="scope">viewer</span>
							<span class="scope soft">session.prompt</span>
						</div>
					</div>
					<div class="hint">Live Work · app exposes Space</div>
				{/if}
			</div>
			<div class="meta">
				<span class="num">{step.num}</span>
				<h3>{step.title}</h3>
				<p>
					{#if step.kind === "start"}
						Open one on the web, or run <code>cohub sandbox up</code> on a local folder so
						that directory becomes the Space sandbox.
					{:else}
						{step.body}
					{/if}
				</p>
			</div>
		</article>
	{/each}
</div>

<style>
	.step {
		display: flex;
		flex-direction: column;
		gap: 14px;
		border-radius: 18px;
		border: 1px solid var(--border-subtle);
		background: color-mix(in srgb, var(--bg-surface) 42%, transparent);
		padding: 14px;
		transition:
			border-color 0.2s,
			transform 0.2s,
			background 0.2s;
	}
	.step:hover {
		border-color: var(--brand-border);
		background: color-mix(in srgb, var(--bg-surface) 62%, transparent);
		transform: translateY(-2px);
	}
	.mock {
		position: relative;
		min-height: 132px;
		border-radius: 14px;
		border: 1px solid var(--border-subtle);
		background:
			radial-gradient(
				120% 100% at 20% 0%,
				color-mix(in srgb, var(--brand) 8%, transparent),
				transparent 60%
			),
			linear-gradient(180deg, var(--bg-content), var(--bg-primary));
		padding: 14px;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 10px;
	}
	.term {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		border-radius: 12px;
		border: 1px solid var(--border-subtle);
		background: color-mix(in srgb, var(--bg-primary) 75%, transparent);
		padding: 10px 12px;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--text-secondary);
	}
	.prompt {
		color: var(--brand);
	}
	.cmd {
		color: var(--text-primary);
	}
	.hint {
		font-family: var(--font-mono);
		font-size: 10.5px;
		color: var(--text-placeholder);
	}
	.build-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.pill {
		flex: none;
		border-radius: 999px;
		padding: 2px 8px;
		font-family: var(--font-mono);
		font-size: 10px;
		background: color-mix(in srgb, oklch(62% 0.15 20) 22%, transparent);
		color: oklch(78% 0.1 20);
	}
	.pill.agent {
		background: var(--brand-muted);
		border: 1px solid var(--brand-border);
		color: var(--brand);
	}
	.pill.save {
		background: color-mix(in srgb, var(--provider-feishu) 18%, transparent);
		color: color-mix(in srgb, var(--provider-feishu) 80%, white);
	}
	.bar {
		flex: 1;
		height: 8px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--text-tertiary) 22%, transparent);
	}
	.brand-bar {
		background: color-mix(in srgb, var(--brand) 45%, transparent);
	}
	.tool {
		border-radius: 8px;
		border: 1px dashed var(--brand-border);
		background: var(--brand-muted);
		padding: 4px 8px;
		font-size: 11px;
		color: var(--text-tertiary);
	}
	.work-card {
		display: flex;
		flex-direction: column;
		gap: 8px;
		border-radius: 12px;
		border: 1px solid var(--border-subtle);
		background: color-mix(in srgb, var(--bg-primary) 65%, transparent);
		padding: 10px 12px;
	}
	.url-row {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: var(--text-secondary);
	}
	.mono {
		font-family: var(--font-mono);
		font-size: 11px;
	}
	.live-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--brand);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 18%, transparent);
		animation: pulse 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite;
	}
	.scope-row {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
	}
	.scope {
		border-radius: 999px;
		border: 1px solid var(--brand-border);
		background: var(--brand-muted);
		padding: 2px 7px;
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--brand);
	}
	.scope.soft {
		border-color: var(--border-subtle);
		background: color-mix(in srgb, var(--bg-elevated) 45%, transparent);
		color: var(--text-tertiary);
	}
	.meta {
		padding: 2px 4px 6px;
	}
	.num {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--brand);
	}
	.meta h3 {
		margin-top: 4px;
		font-size: 15px;
		font-weight: 600;
		letter-spacing: -0.02em;
		color: var(--text-primary);
	}
	.meta p {
		margin-top: 6px;
		font-size: 13px;
		line-height: 1.55;
		color: var(--text-tertiary);
	}
	.meta p :global(code) {
		border-radius: 5px;
		background: var(--brand-muted);
		padding: 1px 6px;
		font-family: var(--font-mono);
		font-size: 0.9em;
		color: var(--brand);
	}
	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.35;
			transform: scale(0.75);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.step:hover {
			transform: none;
		}
		.live-dot {
			animation: none;
		}
	}
</style>
