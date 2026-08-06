<script lang="ts">
import {
	AtSign,
	Bookmark,
	Bot,
	GitFork,
	LayoutGrid,
	SquareStack,
} from "lucide-svelte";

/** Mental-model glossary. Static content only. */
const concepts = [
	{
		icon: SquareStack,
		title: "Space",
		body: "Where people and agents work together — chats, files, previews, and experiments in one place.",
	},
	{
		icon: Bookmark,
		title: "Checkpoint",
		body: "A saved snapshot of a Space. Share it, fork from it, or come back to it later.",
	},
	{
		icon: AtSign,
		title: "@space",
		body: "The agent pulls another Space in as context for this turn. You stay put — not a hunt for a different agent.",
	},
	{
		icon: GitFork,
		title: "Fork",
		body: "Start a new Space from a Checkpoint, with its files and state already loaded.",
	},
	{
		icon: LayoutGrid,
		title: "Live Work",
		body: "A public app from a file, site, or port that exposes Space capabilities. Visitors can authorize actions back to the Space.",
	},
	{
		icon: Bot,
		title: "Agent",
		body: "Works inside the Space with you — tools, files, and media generation.",
	},
];
</script>

<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
	{#each concepts as concept (concept.title)}
		<div class="concept">
			<span class="ic">
				<concept.icon class="h-[18px] w-[18px]" />
			</span>
			<h3 class="mt-3.5 text-[15px] font-semibold text-text-primary">{concept.title}</h3>
			<p class="mt-1.5 text-[13px] leading-6 text-text-tertiary">{concept.body}</p>
		</div>
	{/each}
</div>

<style>
	.concept {
		border-radius: 14px;
		border: 1px solid var(--border-subtle);
		background: color-mix(in srgb, var(--bg-surface) 40%, transparent);
		padding: 20px;
		transition:
			border-color 0.2s,
			transform 0.2s,
			background 0.2s;
	}
	.concept:hover {
		transform: translateY(-3px);
		border-color: var(--brand-border);
		background: color-mix(in srgb, var(--bg-surface) 60%, transparent);
	}
	.ic {
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		border-radius: 10px;
		border: 1px solid var(--brand-border);
		background: var(--brand-muted);
		color: var(--brand);
	}
	@media (prefers-reduced-motion: reduce) {
		.concept:hover {
			transform: none;
		}
	}
</style>
