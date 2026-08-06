<script lang="ts">
/**
 * Two must-clear differentiators for the open-source narrative:
 * Live Work (hosted runtime + scopes + viewer auth → side effects back)
 * and Cross-space (@space pull-in vs Fork new writable Space).
 */
</script>

<div class="grid gap-4 lg:grid-cols-2">
	<article class="card">
		<div class="kicker">Live Work</div>
		<h3>A public app that exposes your Space.</h3>
		<p>
			Publish a file, site, or port as a live app on Cohub. You choose which Space
			capabilities it can use, and what visitors may allow. After they authorize,
			actions can prompt, generate, or read files back in the original Space.
		</p>
		<div class="panel" aria-hidden="true">
			<div class="row">
				<span class="label">public URL</span>
				<span class="value mono">/:user/:space/w/:slug</span>
			</div>
			<div class="row">
				<span class="label">workScopes</span>
				<span class="chips">
					<span class="chip">space.view</span>
					<span class="chip">file.view</span>
					<span class="chip">session.view</span>
				</span>
			</div>
			<div class="row">
				<span class="label">viewer auth</span>
				<span class="chips">
					<span class="chip live">authorized</span>
					<span class="chip soft">session.prompt.fullaccess</span>
				</span>
			</div>
			<div class="side-effect">
				<span class="arrow">→</span>
				<span>back in the Space: a prompt, a generation, a file read</span>
			</div>
		</div>
	</article>

	<article class="card">
		<div class="kicker">Reuse</div>
		<h3>The agent fetches context.</h3>
		<p>
			With <code>@space</code>, the agent pulls another Space into this turn.
			You stay put — you are not shopping for a different agent. Context comes
			here. Fork is heavier: a new Space from a Checkpoint, fully loaded and
			yours to change.
		</p>
		<div class="panel compare" aria-hidden="true">
			<div class="col">
				<div class="col-title">
					<span class="chip">@space</span>
					<span class="tag">light</span>
				</div>
				<ul>
					<li>agent pulls other Space context</li>
					<li>you stay in this session</li>
					<li>no new agent, no new Space</li>
				</ul>
			</div>
			<div class="divider" aria-hidden="true"></div>
			<div class="col">
				<div class="col-title">
					<span class="chip soft">Fork</span>
					<span class="tag">heavy</span>
				</div>
				<ul>
					<li>new writable Space</li>
					<li>from a Checkpoint snapshot</li>
					<li>own files, sessions, Works</li>
				</ul>
			</div>
		</div>
	</article>
</div>

<style>
	.card {
		border-radius: 18px;
		border: 1px solid var(--border-subtle);
		background: color-mix(in srgb, var(--bg-surface) 42%, transparent);
		padding: 22px;
		transition:
			border-color 0.2s,
			background 0.2s;
	}
	.card:hover {
		border-color: var(--brand-border);
		background: color-mix(in srgb, var(--bg-surface) 62%, transparent);
	}
	.kicker {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--brand);
	}
	.card h3 {
		margin-top: 10px;
		font-size: clamp(1.15rem, 2vw, 1.35rem);
		font-weight: 600;
		letter-spacing: -0.02em;
		line-height: 1.25;
		color: var(--text-primary);
	}
	.card h3 :global(code) {
		font-family: var(--font-mono);
		font-size: 0.92em;
		color: var(--brand);
	}
	.card > p {
		margin-top: 10px;
		font-size: 14px;
		line-height: 1.65;
		color: var(--text-tertiary);
	}
	.card > p :global(code) {
		border-radius: 5px;
		background: var(--brand-muted);
		padding: 1px 6px;
		font-family: var(--font-mono);
		font-size: 0.9em;
		color: var(--brand);
	}
	.panel {
		margin-top: 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		border-radius: 14px;
		border: 1px solid var(--border-subtle);
		background:
			radial-gradient(
				100% 120% at 0% 0%,
				color-mix(in srgb, var(--brand) 8%, transparent),
				transparent 55%
			),
			color-mix(in srgb, var(--bg-primary) 70%, transparent);
		padding: 14px;
	}
	.row {
		display: grid;
		grid-template-columns: 92px 1fr;
		gap: 10px;
		align-items: center;
	}
	.label {
		font-family: var(--font-mono);
		font-size: 10.5px;
		color: var(--text-placeholder);
	}
	.value {
		font-size: 12px;
		color: var(--text-secondary);
	}
	.mono {
		font-family: var(--font-mono);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		border-radius: 999px;
		border: 1px solid var(--brand-border);
		background: var(--brand-muted);
		padding: 2px 8px;
		font-family: var(--font-mono);
		font-size: 10.5px;
		color: var(--brand);
	}
	.chip.soft {
		border-color: var(--border-subtle);
		background: color-mix(in srgb, var(--bg-elevated) 40%, transparent);
		color: var(--text-tertiary);
	}
	.chip.live {
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 12%, transparent);
	}
	.side-effect {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		border-top: 1px dashed var(--border-subtle);
		padding-top: 10px;
		font-size: 12px;
		line-height: 1.5;
		color: var(--text-secondary);
	}
	.arrow {
		color: var(--brand);
		font-family: var(--font-mono);
	}
	.compare {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		gap: 12px;
		align-items: start;
	}
	.col-title {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 10px;
	}
	.tag {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--text-placeholder);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.col ul {
		display: flex;
		flex-direction: column;
		gap: 6px;
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.col li {
		position: relative;
		padding-left: 12px;
		font-size: 12.5px;
		line-height: 1.45;
		color: var(--text-secondary);
	}
	.col li::before {
		content: "";
		position: absolute;
		left: 0;
		top: 0.55em;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: color-mix(in srgb, var(--brand) 70%, var(--bg-elevated));
	}
	.divider {
		width: 1px;
		align-self: stretch;
		background: var(--border-subtle);
	}
	@media (max-width: 520px) {
		.row {
			grid-template-columns: 1fr;
			gap: 4px;
		}
		.compare {
			grid-template-columns: 1fr;
		}
		.divider {
			width: 100%;
			height: 1px;
		}
	}
</style>
