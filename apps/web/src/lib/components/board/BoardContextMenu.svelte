<script lang="ts">
import {
	ArrowDownToLine,
	ArrowUpToLine,
	BoxSelect,
	Copy,
	ExternalLink,
	ImageDown,
	LocateFixed,
	Pencil,
	Trash2,
} from "lucide-svelte";
import { onDestroy, onMount, untrack } from "svelte";
import { portal } from "$lib/actions/portal";
import type { BoardEditor } from "$lib/board/editor.svelte";

const {
	editor,
	position,
	onClose,
	onOpenFile,
	onExport,
}: {
	editor: BoardEditor;
	position: { x: number; y: number };
	onClose: () => void;
	onOpenFile?: (path: string) => void | Promise<void>;
	/** Opens the export dialog; absent until the stage can render one. */
	onExport?: () => void;
} = $props();

let menu: HTMLDivElement | null = $state(null);
// The menu is recreated each time it opens, so capture the opening position once.
let left = $state(untrack(() => position.x));
let top = $state(untrack(() => position.y));

const hasSelection = $derived(editor.selection.length > 0);
const singleText = $derived(
	editor.selectedItems.length === 1 && editor.selectedItems[0]?.type === "text",
);
/** The single selected file card, if that is what the selection is. */
const singleFile = $derived.by(() => {
	if (editor.selectedItems.length !== 1) return null;
	const item = editor.selectedItems[0];
	return item?.type === "file" ? item : null;
});

type MenuAction = {
	label: string;
	icon: typeof Pencil;
	danger?: boolean;
	run: () => void;
};

const actions = $derived.by<MenuAction[]>(() => {
	const list: MenuAction[] = [];
	const file = singleFile;
	if (file && onOpenFile)
		list.push({
			label: "Open file",
			icon: ExternalLink,
			run: () => {
				void onOpenFile(file.ref.path);
			},
		});
	if (singleText)
		list.push({
			label: "Edit text",
			icon: Pencil,
			run: () => {
				editor.editingId = editor.selectedItems[0]?.id ?? null;
			},
		});
	if (hasSelection) {
		list.push(
			{
				label: "Duplicate",
				icon: Copy,
				run: () => editor.duplicateSelection(),
			},
			{
				label: "Bring to front",
				icon: ArrowUpToLine,
				run: () => editor.bringToFront(),
			},
			{
				label: "Send to back",
				icon: ArrowDownToLine,
				run: () => editor.sendToBack(),
			},
			{
				label: "Delete",
				icon: Trash2,
				danger: true,
				run: () => editor.deleteSelection(),
			},
		);
	}
	list.push(
		{ label: "Select all", icon: BoxSelect, run: () => editor.selectAll() },
		{ label: "Zoom to fit", icon: LocateFixed, run: () => editor.fitView() },
	);
	if (onExport)
		list.push({
			label: hasSelection ? "Export selection…" : "Export image…",
			icon: ImageDown,
			run: onExport,
		});
	return list;
});

function run(action: MenuAction) {
	action.run();
	onClose();
}

function handlePointerDown(event: PointerEvent) {
	if (menu && !menu.contains(event.target as Node)) onClose();
}

function handleKeydown(event: KeyboardEvent) {
	if (event.key === "Escape") onClose();
}

onMount(() => {
	document.addEventListener("pointerdown", handlePointerDown, true);
	document.addEventListener("keydown", handleKeydown);
	if (menu) {
		const rect = menu.getBoundingClientRect();
		left = Math.min(position.x, window.innerWidth - rect.width - 8);
		top = Math.min(position.y, window.innerHeight - rect.height - 8);
	}
});

onDestroy(() => {
	document.removeEventListener("pointerdown", handlePointerDown, true);
	document.removeEventListener("keydown", handleKeydown);
});
</script>

<div
	bind:this={menu}
	use:portal
	class="board-context-menu"
	style:left="{left}px"
	style:top="{top}px"
	role="menu"
	tabindex="-1"
	oncontextmenu={(event) => event.preventDefault()}
>
	{#each actions as action (action.label)}
		<button
			type="button"
			class="ctx-item"
			class:ctx-item--danger={action.danger}
			role="menuitem"
			onclick={() => run(action)}
		>
			<action.icon class="h-3.5 w-3.5" />
			<span>{action.label}</span>
		</button>
	{/each}
</div>

<style>
	.board-context-menu {
		position: fixed;
		z-index: 130;
		min-width: 168px;
		border-radius: 9px;
		border: 1px solid var(--border-subtle);
		background: var(--bg-elevated);
		padding: 4px;
		box-shadow: 0 12px 28px color-mix(in srgb, var(--overlay-scrim-strong) 18%, transparent);
	}

	.ctx-item {
		display: flex;
		width: 100%;
		align-items: center;
		gap: 8px;
		border: 0;
		border-radius: 6px;
		background: transparent;
		padding: 7px 8px;
		color: var(--text-secondary);
		font-size: 12px;
		font-weight: 500;
		text-align: left;
		cursor: pointer;
		transition: background-color 100ms ease, color 100ms ease;
	}
	.ctx-item:hover { background: var(--bg-hover); color: var(--text-primary); }
	.ctx-item--danger:hover { background: var(--error-bg); color: var(--error-700); }
</style>
