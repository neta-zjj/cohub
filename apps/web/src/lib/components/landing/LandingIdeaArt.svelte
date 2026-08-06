<script lang="ts">
/**
 * Per-idea decorative micro-animation. Pure CSS/SVG, no images or data.
 * `kind` selects one of the five choreographies matching the five ideas.
 */
type Kind = "spark" | "build" | "open" | "work" | "fork";
const { kind }: { kind: Kind } = $props();
</script>

<div class="art art-{kind}">
	{#if kind === "spark"}
		<div class="prompt">
			draw a tiny robot watering a plant<span class="caret"></span>
		</div>
		<div class="shapes"><b></b><b></b><b></b><b></b></div>
	{:else if kind === "build"}
		<div class="avs"><span>A</span><span>M</span><span>C</span></div>
		<div class="flow">
			<div class="row"><span class="tagm p">you</span><span class="bar" style="max-width:70%"></span></div>
			<div class="row"><span class="tagm a">agent</span><span class="tool">✎ edit settings.tsx</span></div>
			<div class="row"><span class="tagm p">mia</span><span class="bar" style="max-width:55%"></span></div>
			<div class="row"><span class="tagm a">agent</span><span class="bar" style="max-width:85%"></span></div>
		</div>
	{:else if kind === "open"}
		<div class="ring ring1"></div>
		<div class="ring ring2"></div>
		<div class="core">C</div>
		<span class="sat sat1" title="Web">Web</span>
		<span class="sat sat2" title="CLI · local sandbox">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l6-6-6-6M12 19h8" /></svg>
		</span>
		<span class="sat sat3" title="API">API</span>
		<span class="sat sat4" title="Scheduled">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
		</span>
		<div class="cli-line"><span class="cli-prompt">$</span> cohub sandbox up ./app</div>
	{:else if kind === "work"}
		<div class="browser">
			<div class="bbar"><i></i><i></i><i></i><span class="url">cohub.run/you/space/w/mini-game</span></div>
			<div class="view">
				<div class="app">
					<div class="t"></div>
					<div class="btnrow"><span class="b b1"></span><span class="b b2"></span></div>
					<div class="auth-row">
						<span class="auth-pill"><span class="pdot"></span> viewer authorized</span>
						<span class="scope-mini">session.prompt</span>
					</div>
				</div>
				<span class="publish"><span class="pdot"></span> live work</span>
			</div>
		</div>
	{:else if kind === "fork"}
		<div class="fork-split">
			<div class="fork-col">
				<div class="fork-label"><span class="at">@space</span> light</div>
				<div class="mention compact">attach <span class="at">@northlands</span> to this turn</div>
			</div>
			<div class="fork-vs">vs</div>
			<div class="fork-col">
				<div class="fork-label soft">Fork heavy</div>
				<svg class="graph compact" viewBox="0 0 200 90" preserveAspectRatio="xMidYMid meet">
					<path class="edge" d="M24 45 H80" />
					<path class="edge eb" d="M80 45 C110 45 110 18 150 18" />
					<path class="edge eb" d="M80 45 C110 45 110 72 150 72" />
					<circle class="node" cx="24" cy="45" r="7" />
					<circle class="node" cx="80" cy="45" r="7" />
					<circle class="node nb" cx="150" cy="18" r="7" />
					<circle class="node nb" cx="150" cy="72" r="7" />
				</svg>
			</div>
		</div>
	{/if}
</div>

<style>
	.art {
		position: relative;
		overflow: hidden;
		aspect-ratio: 16 / 11;
		border-radius: 18px;
		border: 1px solid var(--border-subtle);
		background: linear-gradient(180deg, var(--bg-content), var(--bg-surface));
		box-shadow: 0 30px 70px -50px rgba(0, 0, 0, 0.9);
	}
	.art::after {
		content: "";
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: radial-gradient(90% 90% at 50% 0%, color-mix(in srgb, var(--brand) 6%, transparent), transparent 60%);
	}

	/* ---- spark ---- */
	.art-spark {
		display: grid;
		place-items: center;
	}
	.prompt {
		position: absolute;
		top: 16px;
		left: 16px;
		right: 16px;
		display: flex;
		align-items: center;
		gap: 8px;
		border-radius: 999px;
		border: 1px solid var(--border-subtle);
		background: color-mix(in srgb, var(--bg-primary) 60%, transparent);
		padding: 8px 12px;
		font-size: 12px;
		color: var(--text-tertiary);
	}
	.caret {
		width: 6px;
		height: 14px;
		border-radius: 2px;
		background: var(--brand);
		animation: blink 1s step-end infinite;
	}
	.shapes b {
		position: absolute;
		border-radius: 8px;
		opacity: 0;
		animation: pop 4s ease-in-out infinite;
	}
	.shapes b:nth-child(1) {
		left: 26%;
		top: 52%;
		width: 46px;
		height: 46px;
		border-radius: 14px;
		background: var(--brand);
		animation-delay: 0.3s;
	}
	.shapes b:nth-child(2) {
		left: 52%;
		top: 40%;
		width: 30px;
		height: 30px;
		border-radius: 50%;
		background: color-mix(in srgb, var(--brand) 55%, var(--bg-elevated));
		animation-delay: 1.1s;
	}
	.shapes b:nth-child(3) {
		left: 60%;
		top: 60%;
		width: 54px;
		height: 34px;
		border: 1px solid var(--brand-border);
		background: var(--bg-elevated);
		animation-delay: 1.8s;
	}
	.shapes b:nth-child(4) {
		left: 40%;
		top: 66%;
		width: 22px;
		height: 22px;
		transform: rotate(45deg);
		background: var(--brand-300);
		animation-delay: 2.5s;
	}

	/* ---- build ---- */
	.avs {
		position: absolute;
		top: 18px;
		left: 18px;
		display: flex;
	}
	.avs span {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		margin-left: -8px;
		border-radius: 50%;
		border: 2px solid var(--bg-content);
		font-size: 11px;
		font-weight: 600;
		color: var(--brand-contrast-fg);
	}
	.avs span:nth-child(1) {
		margin-left: 0;
		background: oklch(62% 0.15 20);
	}
	.avs span:nth-child(2) {
		background: oklch(60% 0.13 250);
	}
	.avs span:nth-child(3) {
		background: var(--brand);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 20%, transparent);
	}
	.flow {
		position: absolute;
		inset: 62px 18px 18px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		opacity: 0;
		animation: appear 0.4s ease forwards;
	}
	.row:nth-child(1) {
		animation-delay: 0.3s;
	}
	.row:nth-child(2) {
		animation-delay: 1.3s;
	}
	.row:nth-child(3) {
		animation-delay: 2.3s;
	}
	.row:nth-child(4) {
		animation-delay: 3.3s;
	}
	.tagm {
		flex: none;
		border-radius: 999px;
		padding: 2px 7px;
		font-family: var(--font-mono);
		font-size: 10px;
	}
	.tagm.p {
		background: color-mix(in srgb, oklch(62% 0.15 20) 22%, transparent);
		color: oklch(78% 0.1 20);
	}
	.tagm.a {
		border: 1px solid var(--brand-border);
		background: var(--brand-muted);
		color: var(--brand);
	}
	.bar {
		flex: 1;
		height: 9px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--text-tertiary) 22%, transparent);
	}
	.tool {
		border-radius: 8px;
		border: 1px dashed var(--brand-border);
		background: var(--brand-muted);
		padding: 4px 8px;
		font-size: 11px;
		color: var(--text-tertiary);
	}

	/* ---- open ---- */
	.art-open {
		display: grid;
		place-items: center;
	}
	.core {
		z-index: 2;
		display: grid;
		place-items: center;
		width: 62px;
		height: 62px;
		border-radius: 18px;
		background: var(--brand);
		color: var(--brand-contrast-fg);
		font-weight: 700;
		box-shadow:
			0 0 0 1px color-mix(in srgb, var(--brand) 40%, transparent),
			0 0 50px -6px var(--brand);
	}
	.ring {
		position: absolute;
		border: 1px dashed var(--border-primary);
		border-radius: 50%;
	}
	.ring1 {
		width: 190px;
		height: 190px;
		animation: spin 26s linear infinite;
	}
	.ring2 {
		width: 280px;
		height: 280px;
		animation: spin 40s linear infinite reverse;
	}
	.sat {
		position: absolute;
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		border-radius: 10px;
		border: 1px solid var(--border-subtle);
		background: var(--bg-elevated);
		color: var(--text-secondary);
		font-size: 10px;
		font-weight: 600;
	}
	.sat :global(svg) {
		width: 17px;
		height: 17px;
	}
	.sat1 {
		top: calc(50% - 95px);
		left: calc(50% - 17px);
		color: var(--brand);
		animation: chpulse 4s infinite;
		font-size: 10px;
	}
	.sat2 {
		top: calc(50% - 17px);
		left: calc(50% + 78px);
		color: var(--text-secondary);
		animation: chpulse 4s infinite 1s;
	}
	.sat3 {
		top: calc(50% + 78px);
		left: calc(50% - 17px);
		color: var(--provider-feishu);
		animation: chpulse 4s infinite 2s;
		font-size: 10px;
	}
	.sat4 {
		top: calc(50% - 17px);
		left: calc(50% - 112px);
		color: var(--text-secondary);
		animation: chpulse 4s infinite 3s;
	}
	.cli-line {
		position: absolute;
		left: 16px;
		right: 16px;
		bottom: 14px;
		z-index: 3;
		display: flex;
		align-items: center;
		gap: 8px;
		border-radius: 10px;
		border: 1px solid var(--border-subtle);
		background: color-mix(in srgb, var(--bg-primary) 70%, transparent);
		padding: 7px 10px;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-secondary);
	}
	.cli-prompt {
		color: var(--brand);
	}

	/* ---- work ---- */
	.browser {
		position: absolute;
		inset: 18px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border-radius: 12px;
		border: 1px solid var(--border-subtle);
		background: var(--bg-primary);
	}
	.bbar {
		display: flex;
		align-items: center;
		gap: 6px;
		border-bottom: 1px solid var(--border-subtle);
		padding: 8px 10px;
	}
	.bbar i {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--bg-elevated);
	}
	.url {
		margin-left: 8px;
		border-radius: 6px;
		background: var(--bg-surface);
		padding: 3px 8px;
		font-family: var(--font-mono);
		font-size: 10.5px;
		color: var(--text-tertiary);
	}
	.view {
		position: relative;
		flex: 1;
		display: grid;
		place-items: center;
		background: radial-gradient(70% 90% at 50% 20%, color-mix(in srgb, var(--brand) 12%, transparent), transparent 60%);
	}
	.app {
		width: 60%;
	}
	.app .t {
		height: 12px;
		width: 55%;
		margin: 0 auto 12px;
		border-radius: 4px;
		background: color-mix(in srgb, var(--text-secondary) 40%, transparent);
	}
	.btnrow {
		display: flex;
		justify-content: center;
		gap: 8px;
	}
	.b {
		height: 26px;
		border-radius: 8px;
	}
	.b1 {
		width: 74px;
		background: var(--brand);
		animation: press 3s ease-in-out infinite;
	}
	.b2 {
		width: 58px;
		border: 1px solid var(--border-subtle);
		background: var(--bg-elevated);
	}
	.auth-row {
		margin-top: 12px;
		display: flex;
		justify-content: center;
		flex-wrap: wrap;
		gap: 6px;
	}
	.auth-pill,
	.scope-mini {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		border-radius: 999px;
		border: 1px solid var(--brand-border);
		background: var(--brand-muted);
		padding: 3px 8px;
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--brand);
	}
	.scope-mini {
		border-color: var(--border-subtle);
		background: color-mix(in srgb, var(--bg-elevated) 45%, transparent);
		color: var(--text-tertiary);
	}
	.publish {
		position: absolute;
		right: 12px;
		bottom: 12px;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border-radius: 999px;
		border: 1px solid var(--brand-border);
		background: var(--brand-muted);
		padding: 4px 10px;
		font-family: var(--font-mono);
		font-size: 10.5px;
		color: var(--brand);
		animation: bob 5s ease-in-out infinite;
	}
	.pdot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--brand);
		animation: pulse 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite;
	}

	/* ---- fork ---- */
	.art-fork {
		padding: 18px;
		display: grid;
		place-items: center;
	}
	.fork-split {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		gap: 10px;
		align-items: center;
		width: 100%;
		height: 100%;
	}
	.fork-col {
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-width: 0;
	}
	.fork-label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-secondary);
	}
	.fork-label.soft {
		color: var(--text-tertiary);
	}
	.fork-vs {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-placeholder);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.graph {
		width: 100%;
		height: 100%;
	}
	.graph.compact {
		height: 88px;
	}
	.node {
		fill: var(--bg-elevated);
		stroke: var(--border-primary);
	}
	.node.nb {
		fill: var(--brand);
		stroke: none;
	}
	.edge {
		fill: none;
		stroke: var(--border-primary);
		stroke-width: 2;
	}
	.edge.eb {
		stroke: var(--brand);
		stroke-dasharray: 6 6;
		animation: dash 1.2s linear infinite;
	}
	.mention {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		border-radius: 10px;
		border: 1px solid var(--border-subtle);
		background: color-mix(in srgb, var(--bg-primary) 60%, transparent);
		padding: 8px 10px;
		font-size: 12px;
		color: var(--text-tertiary);
	}
	.mention.compact {
		font-size: 11.5px;
	}
	.at {
		border-radius: 5px;
		background: var(--brand-muted);
		padding: 1px 6px;
		font-family: var(--font-mono);
		color: var(--brand);
	}

	@keyframes pop {
		0% {
			opacity: 0;
			transform: scale(0.4) translateY(8px);
		}
		18% {
			opacity: 1;
			transform: scale(1);
		}
		82% {
			opacity: 1;
		}
		100% {
			opacity: 0;
			transform: scale(0.9) translateY(-6px);
		}
	}
	@keyframes appear {
		to {
			opacity: 1;
		}
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@keyframes chpulse {
		0%,
		100% {
			box-shadow: 0 0 0 0 transparent;
			border-color: var(--border-subtle);
		}
		50% {
			box-shadow: 0 0 22px -4px currentColor;
			border-color: currentColor;
		}
	}
	@keyframes press {
		0%,
		100% {
			transform: none;
		}
		50% {
			transform: scale(0.94);
			filter: brightness(1.15);
		}
	}
	@keyframes dash {
		to {
			stroke-dashoffset: -24;
		}
	}
	@keyframes blink {
		50% {
			opacity: 0.2;
		}
	}
	@keyframes bob {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-8px);
		}
	}
	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.35;
			transform: scale(0.7);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.art :global(*) {
			animation: none !important;
		}
		.row {
			opacity: 1 !important;
		}
		.shapes b {
			opacity: 1 !important;
			transform: none !important;
		}
	}
</style>
