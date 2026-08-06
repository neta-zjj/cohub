<script lang="ts">
import { latestEntry } from "$lib/changelog";
import Dialog from "$lib/components/Dialog.svelte";

type ShortcutCombo = string[];
type ShortcutItem = {
	label: string;
	keys: ShortcutCombo[];
};

type ShortcutSection = {
	title: string;
	description: string;
	items: ShortcutItem[];
};

const {
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
} = $props();

const sections: ShortcutSection[] = [
	{
		title: "Global",
		description: "Available across Cohub.",
		items: [
			{
				label: "Search everywhere",
				keys: [
					["⌘", "K"],
					["Ctrl", "K"],
				],
			},
			{
				label: "New chat",
				keys: [
					["⌘", "O"],
					["Ctrl", "O"],
				],
			},
			{
				label: "Focus my chats",
				keys: [
					["⌘", "⇧", "U"],
					["Ctrl", "Shift", "U"],
				],
			},
			{
				label: "Capture & mark",
				keys: [
					["⌘", "⇧", "S"],
					["Ctrl", "Shift", "S"],
				],
			},
			{
				label: "Toggle left sidebar",
				keys: [
					["Ctrl", "⌥", "←"],
					["Ctrl", "Alt", "←"],
				],
			},
			{
				label: "Toggle right sidebar",
				keys: [
					["Ctrl", "⌥", "→"],
					["Ctrl", "Alt", "→"],
				],
			},
			{ label: "Open help", keys: [["?"]] },
		],
	},
	{
		title: "Session page",
		description: "Vim-style reading and turn navigation.",
		items: [
			{
				label: "Open model selector",
				keys: [
					["⌘", "Shift", "M"],
					["Ctrl", "Shift", "M"],
				],
			},
			{ label: "Focus composer", keys: [["i"]] },
			{ label: "Scroll down", keys: [["j"]] },
			{ label: "Scroll up", keys: [["k"]] },
			{ label: "Next turn", keys: [["Shift", "J"]] },
			{ label: "Previous turn", keys: [["Shift", "K"]] },
			{ label: "Top", keys: [["g", "g"]] },
			{ label: "Bottom", keys: [["G"]] },
		],
	},
	{
		title: "Model selector",
		description: "When choosing a model.",
		items: [
			{ label: "Next model", keys: [["↓"], ["Ctrl", "N"]] },
			{ label: "Previous model", keys: [["↑"], ["Ctrl", "P"]] },
			{ label: "Select", keys: [["Enter"]] },
			{ label: "Close", keys: [["Esc"]] },
		],
	},
	{
		title: "Composer",
		description: "When the message input is focused.",
		items: [
			{ label: "Send", keys: [["Enter"]] },
			{
				label: "Force send",
				keys: [
					["⌘", "↵"],
					["Ctrl", "↵"],
				],
			},
			{ label: "New line", keys: [["Shift", "↵"]] },
			{ label: "Blur", keys: [["Esc"]] },
		],
	},
	{
		title: "Files",
		description: "File preview and editor shortcuts.",
		items: [
			{
				label: "Save file",
				keys: [
					["⌘", "S"],
					["Ctrl", "S"],
				],
			},
		],
	},
];
</script>

<Dialog {open} {onClose} title="Help" maxWidth="680px">
	<div class="help-sheet">
		<div class="shortcut-stack">
			{#each sections as section (section.title)}
				<section class="shortcut-section" aria-labelledby={`help-section-${section.title}`}>
					<div class="section-meta">
						<h3 id={`help-section-${section.title}`}>{section.title}</h3>
						<p>{section.description}</p>
					</div>
					<div class="shortcut-list">
						{#each section.items as item (`${section.title}:${item.label}`)}
							<div class="shortcut-row">
								<span class="shortcut-label">{item.label}</span>
								<span class="key-group" aria-label={item.keys.map((combo) => combo.join(" ")).join(" or ")}>
									{#each item.keys as combo, comboIndex (`${section.title}:${item.label}:${comboIndex}`)}
										<span class="key-combo">
											{#each combo as key, keyIndex (`${section.title}:${item.label}:${comboIndex}:${keyIndex}`)}
												<kbd>{key}</kbd>
											{/each}
										</span>
									{/each}
								</span>
							</div>
						{/each}
					</div>
				</section>
			{/each}

			<section class="shortcut-section doc-section" aria-labelledby="help-section-docs">
				<div class="section-meta">
					<h3 id="help-section-docs">Product</h3>
					<p>Updates and resources.</p>
				</div>
				<div class="doc-stack">
					<a href="/changelog" class="doc-card doc-card-link" onclick={onClose}>
						<div class="doc-copy-wrap">
							<div class="doc-title">Changelog</div>
							<div class="doc-copy">What's new in Cohub.</div>
						</div>
						<span class="doc-status">{latestEntry ? `v${latestEntry.version}` : "Open"}</span>
					</a>
					<div class="doc-card">
						<div class="doc-copy-wrap">
							<div class="doc-title">Project documentation</div>
							<div class="doc-copy">Deeper guides will appear here.</div>
						</div>
						<span class="doc-status">Soon</span>
					</div>
				</div>
			</section>
		</div>
	</div>
</Dialog>

<style>
	.help-sheet {
		padding: 0.5rem 0.58rem 0.62rem;
		background: var(--bg-primary);
	}
	.shortcut-stack {
		display: grid;
		gap: 0;
	}
	.shortcut-section {
		display: grid;
		grid-template-columns: minmax(7.2rem, 0.28fr) minmax(0, 1fr);
		gap: 0.7rem;
		align-items: start;
		border-top: 1px solid color-mix(in oklab, var(--border-subtle) 84%, transparent);
		padding: 0.5rem 0;
	}
	.shortcut-section:first-child {
		border-top: 0;
		padding-top: 0;
	}
	.shortcut-section:last-child {
		padding-bottom: 0;
	}
	.section-meta {
		display: grid;
		gap: 0.12rem;
		padding-top: 0.12rem;
	}
	.section-meta h3 {
		margin: 0;
		font-size: 11px;
		font-weight: 760;
		letter-spacing: 0.09em;
		line-height: 1.2;
		text-transform: uppercase;
		color: var(--text-primary);
	}
	.section-meta p {
		margin: 0;
		max-width: 10.8rem;
		font-size: 11px;
		line-height: 1.35;
		color: color-mix(in oklab, var(--text-secondary) 46%, var(--text-tertiary));
	}
	.shortcut-list {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13.5rem, 1fr));
		gap: 0.24rem 0.5rem;
	}
	.shortcut-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.42rem;
		min-height: 1.46rem;
		padding: 0.08rem 0.14rem;
		border-radius: 7px;
		background: color-mix(in oklab, var(--bg-secondary) 58%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--border-subtle) 52%, transparent);
		transition:
			background-color 120ms ease,
			box-shadow 120ms ease;
	}
	.shortcut-row:hover {
		background: color-mix(in oklab, var(--brand) 5%, var(--bg-secondary));
		box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--brand) 18%, var(--border-subtle));
	}
	.shortcut-label {
		min-width: 0;
		font-size: 12px;
		font-weight: 620;
		line-height: 1.15;
		color: var(--text-primary);
	}
	.key-group {
		display: inline-flex;
		flex-wrap: nowrap;
		align-items: center;
		justify-content: flex-end;
		gap: 0.16rem;
		min-width: 0;
	}
	.key-combo {
		display: inline-flex;
		align-items: center;
		gap: 0.01rem;
		height: 1.18rem;
		padding: 0 0.18rem;
		border: 1px solid color-mix(in oklab, var(--brand) 26%, var(--border-subtle));
		border-radius: 5px;
		background: color-mix(in oklab, var(--brand) 9%, var(--bg-primary));
		box-shadow: inset 0 -1px 0 color-mix(in oklab, var(--brand) 13%, transparent);
		white-space: nowrap;
	}
	kbd {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 0.72rem;
		height: 1rem;
		border: 0;
		background: transparent;
		padding: 0 0.015rem;
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
		font-size: 10px;
		font-weight: 820;
		letter-spacing: -0.01em;
		line-height: 1;
		color: color-mix(in oklab, var(--brand) 92%, var(--text-primary));
	}
	.doc-stack {
		display: grid;
		gap: 0.28rem;
		max-width: 100%;
	}
	.doc-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.9rem;
		max-width: 100%;
		padding: 0.28rem 0.42rem;
		border-radius: 7px;
		background: color-mix(in oklab, var(--bg-secondary) 58%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--border-subtle) 52%, transparent);
		text-decoration: none;
		color: inherit;
		transition:
			background-color 120ms ease,
			box-shadow 120ms ease;
	}
	.doc-card-link:hover {
		background: color-mix(in oklab, var(--brand) 5%, var(--bg-secondary));
		box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--brand) 18%, var(--border-subtle));
	}
	.doc-copy-wrap {
		min-width: 0;
	}
	.doc-title {
		font-size: 12px;
		font-weight: 650;
		color: var(--text-primary);
	}
	.doc-copy {
		margin-top: 0.08rem;
		font-size: 11px;
		line-height: 1.35;
		color: color-mix(in oklab, var(--text-secondary) 48%, var(--text-tertiary));
	}
	.doc-status {
		border-radius: 999px;
		background: color-mix(in oklab, var(--brand) 10%, var(--bg-primary));
		padding: 0.16rem 0.46rem;
		font-size: 10px;
		font-weight: 750;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--brand);
	}
	@media (max-width: 640px) {
		.help-sheet {
			padding: 0.6rem;
		}
		.shortcut-section {
			grid-template-columns: 1fr;
			gap: 0.36rem;
		}
		.section-meta p {
			max-width: none;
		}
		.shortcut-list {
			grid-template-columns: 1fr;
			gap: 0.2rem;
		}
		.shortcut-row {
			grid-template-columns: minmax(0, 1fr);
			gap: 0.28rem;
		}
		.key-group {
			justify-content: flex-start;
		}
	}
</style>
