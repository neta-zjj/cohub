<script lang="ts">
import { ChevronRight, Menu, X } from "lucide-svelte";
import { page } from "$app/state";

type Cta = "start" | "open-app" | "none";

const {
	sticky = true,
	cta = "open-app",
	onStart,
}: {
	sticky?: boolean;
	cta?: Cta;
	onStart?: () => void | Promise<void>;
} = $props();

const path = $derived(page.url.pathname);
const isDocs = $derived(path === "/docs" || path.startsWith("/docs/"));
const isPricing = $derived(path === "/pricing" || path.startsWith("/pricing/"));
const isChangelog = $derived(
	path === "/changelog" || path.startsWith("/changelog/"),
);

let mobileMenuOpen = $state(false);

// Close menu on navigation
$effect(() => {
	path;
	mobileMenuOpen = false;
});

function navClass(active: boolean): string {
	return active
		? "rounded-full px-2.5 py-2 text-text-primary sm:px-3"
		: "rounded-full px-2.5 py-2 text-text-secondary transition-colors hover:text-text-primary sm:px-3";
}
</script>

<header
	class={sticky
		? "sticky top-0 z-30 h-12 border-b border-border-subtle bg-bg-primary/80 backdrop-blur-md"
		: "h-12 border-b border-border-subtle"}
>
	<div class="flex h-full w-full items-center justify-between gap-3 px-3">
		<a href="/" class="group inline-flex shrink-0 items-center gap-2" aria-label="Cohub home">
			<div
				class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-brand text-[11px] font-bold text-brand-contrast-fg transition-colors group-hover:bg-brand-hover"
			>
				C
			</div>
			<span class="text-[13px] font-semibold tracking-tight text-text-primary"
				>Cohub</span
			>
		</a>

		<!-- Desktop nav -->
		<nav class="hidden items-center gap-2 text-[13px] sm:flex">
			<a href="/docs" class={navClass(isDocs)} aria-current={isDocs ? "page" : undefined}>Docs</a>
			<a href="/pricing" class={navClass(isPricing)} aria-current={isPricing ? "page" : undefined}
				>Pricing</a
			>
			<a
				href="/changelog"
				class={navClass(isChangelog)}
				aria-current={isChangelog ? "page" : undefined}>Changelog</a
			>

			{#if cta === "start"}
				<button
					type="button"
					onclick={() => void onStart?.()}
					class="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-brand px-4 py-2 font-medium text-brand-contrast-fg transition-colors hover:bg-brand-hover"
				>
					Start
				</button>
			{:else if cta === "open-app"}
				<a
					href="/"
					class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-[5px] border border-border-subtle bg-bg-input px-2.5 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
				>
					Open app
					<ChevronRight class="h-3.5 w-3.5" />
				</a>
			{/if}
		</nav>

		<!-- Mobile nav -->
		<div class="flex items-center gap-2 sm:hidden">
			{#if cta === "start"}
				<button
					type="button"
					onclick={() => void onStart?.()}
					class="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-[12px] font-medium text-brand-contrast-fg transition-colors hover:bg-brand-hover"
				>
					Start
				</button>
			{:else if cta === "open-app"}
				<a
					href="/"
					class="inline-flex items-center gap-1 whitespace-nowrap rounded-[5px] border border-border-subtle bg-bg-input px-2 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
				>
					Open app
					<ChevronRight class="h-3 w-3" />
				</a>
			{/if}
			<button
				type="button"
				class="inline-flex h-8 w-8 items-center justify-center rounded-[6px] border border-border-subtle bg-bg-input text-text-secondary transition-colors hover:text-text-primary"
				onclick={() => (mobileMenuOpen = !mobileMenuOpen)}
				aria-expanded={mobileMenuOpen}
				aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
			>
				{#if mobileMenuOpen}
					<X class="h-4 w-4" />
				{:else}
					<Menu class="h-4 w-4" />
				{/if}
			</button>
		</div>
	</div>

	<!-- Mobile dropdown -->
	{#if mobileMenuOpen}
		<nav class="border-t border-border-subtle bg-bg-primary px-4 py-3 sm:hidden">
			<ul class="space-y-0.5">
				<li>
					<a
						href="/docs"
						class="block rounded-[6px] px-3 py-2 text-[13px] font-medium transition-colors {isDocs ? 'bg-brand/10 text-brand' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'}"
						aria-current={isDocs ? "page" : undefined}
					>Docs</a
					>
				</li>
				<li>
					<a
						href="/pricing"
						class="block rounded-[6px] px-3 py-2 text-[13px] font-medium transition-colors {isPricing ? 'bg-brand/10 text-brand' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'}"
						aria-current={isPricing ? "page" : undefined}
					>Pricing</a
					>
				</li>
				<li>
					<a
						href="/changelog"
						class="block rounded-[6px] px-3 py-2 text-[13px] font-medium transition-colors {isChangelog ? 'bg-brand/10 text-brand' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'}"
						aria-current={isChangelog ? "page" : undefined}
					>Changelog</a
					>
				</li>
			</ul>
		</nav>
	{/if}
</header>
