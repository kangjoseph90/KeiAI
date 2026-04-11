<script lang="ts">
	/**
	 * Message Component — Enhanced with RisuAI-style actions.
	 * Copy, Regenerate, Edit, Delete actions on hover.
	 * Character avatar + name display.
	 */
	import type { DisplayMessage } from '$lib/stores';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import {
		AlertCircle,
		Check,
		Loader2,
		Pencil,
		Trash2,
		X,
		Brain,
		ChevronDown,
		ChevronUp,
		Copy,
		RefreshCw
	} from 'lucide-svelte';
	import { onMount } from 'svelte';
	import ToolCallGroup from './ToolCallGroup.svelte';
	import type { ToolCall } from '$lib/services/content/tool';
	import { activeScripts } from '$lib/stores';
	import { applyScripts } from '$lib/scripts';
	import { parseMarkdownAsync } from '$lib/markdown';
	import morphdom from 'morphdom';
	import DOMPurify from 'dompurify';
	import type { Action } from 'svelte/action';

	// ── Props ─────────────────────────────────────────────────────────────────

	let {
		message,
		isEditing = false,
		editText = $bindable(''),
		characterName = '',
		onEdit = () => {},
		onSave = () => {},
		onCancelEdit = () => {},
		onDelete = () => {},
		onDismissError = () => {},
		onResolveTool = () => {},
		onLoadDetail = async (_id: string) => null,
		onRegenerate = () => {},
		onCopy = () => {}
	}: {
		message: DisplayMessage;
		isEditing?: boolean;
		editText?: string;
		characterName?: string;
		onEdit?: () => void;
		onSave?: (text: string) => void;
		onCancelEdit?: () => void;
		onDelete?: () => void;
		onDismissError?: () => void;
		onResolveTool?: (id: string, decision: 'approve' | 'reject') => void;
		onLoadDetail?: (id: string) => Promise<ToolCall | null>;
		onRegenerate?: () => void;
		onCopy?: () => void;
	} = $props();

	// ── State ─────────────────────────────────────────────────────────────────

	let thoughtExpanded = $state(false);
	let displayContent = $state('');
	let lastContent = $state('');
	let renderedHtml = $state('');
	let copied = $state(false);

	// ── Derived ───────────────────────────────────────────────────────────────

	let isUser = $derived(message.role === 'user');

	// ── Actions ───────────────────────────────────────────────────────────────

	const morphHtml: Action<HTMLElement, string> = (node, html) => {
		const template = document.createElement('div');

		const update = (newHtml: string) => {
			if (!newHtml) {
				node.innerHTML = '';
				return;
			}
			template.innerHTML = newHtml;
			morphdom(node, template, {
				childrenOnly: true,
				onBeforeElUpdated: (fromEl, toEl) => {
					if (fromEl.isEqualNode(toEl)) return false;
					return true;
				}
			});
		};

		update(html);

		return { update };
	};

	// ── Copy ──────────────────────────────────────────────────────────────────

	async function handleCopy() {
		await navigator.clipboard.writeText(message.content);
		copied = true;
		onCopy();
		setTimeout(() => (copied = false), 2000);
	}

	// ── Markdown ──────────────────────────────────────────────────────────────

	let pendingRefresh = false;
	async function refreshDisplay() {
		if (pendingRefresh && message.displayStatus === 'generating') return;
		pendingRefresh = true;

		requestAnimationFrame(async () => {
			try {
				const processed = await applyScripts(message.content, $activeScripts, 'display');
				displayContent = processed;

				const rawHtml = await parseMarkdownAsync(processed);
				renderedHtml = DOMPurify.sanitize(rawHtml as string);
			} finally {
				pendingRefresh = false;
			}
		});
	}

	$effect(() => {
		const current = message.content;
		if (current !== lastContent) {
			lastContent = current;
			refreshDisplay();
		}
	});

	onMount(async () => {
		if (message.content) {
			displayContent = message.content;
			const rawHtml = await parseMarkdownAsync(message.content);
			if (typeof rawHtml === 'string') {
				renderedHtml = DOMPurify.sanitize(rawHtml);
			} else {
				renderedHtml = DOMPurify.sanitize(await rawHtml);
			}
			refreshDisplay();
		}
	});
</script>

<!-- Message Container -->
<div
	class="group flex gap-3 {isUser ? 'flex-row-reverse justify-start' : 'flex-row justify-start'}"
>
	<!-- Avatar (Character only) -->
	{#if !isUser}
		<div
			class="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground"
		>
			{characterName.charAt(0).toUpperCase() || 'A'}
		</div>
	{/if}

	<!-- Content Column -->
	<div class="flex max-w-[75%] flex-col gap-1 {isUser ? 'items-end' : 'items-start'}">
		<!-- Character Name -->
		{#if !isUser && characterName}
			<span class="text-xs font-medium text-muted-foreground">{characterName}</span>
		{/if}

		<!-- Edit Mode -->
		{#if isEditing && message.displayStatus === 'completed'}
			<div class="flex w-full flex-col gap-2">
				<Textarea bind:value={editText} class="min-h-16 w-full" />
				<div class="flex justify-end gap-2">
					<Button size="sm" class="gap-1.5" onclick={() => onSave(editText)}>
						<Check class="size-4" /> Save
					</Button>
					<Button size="sm" variant="outline" class="gap-1.5" onclick={onCancelEdit}>
						<X class="size-4" /> Cancel
					</Button>
				</div>
			</div>

			<!-- Error Bubble -->
		{:else if message.displayStatus === 'error'}
			<div
				class="flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
			>
				<AlertCircle class="mt-0.5 size-4 shrink-0" />
				<div class="flex flex-col gap-1">
					<span class="font-medium">Generation failed</span>
					<span class="text-xs opacity-80">{message.errorMessage ?? 'Unknown error'}</span>
					<Button
						size="sm"
						variant="outline"
						class="mt-1 h-6 gap-1 self-start text-xs"
						onclick={onDismissError}
					>
						<X class="size-3" /> Dismiss
					</Button>
				</div>
			</div>

			<!-- Message Content -->
		{:else}
			<!-- Thought Process (Character only) -->
			{#if !isUser && message.thought}
				<div class="mb-1 w-full overflow-hidden rounded-xl border bg-muted/20">
					<button
						class="flex w-full items-center justify-between px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:bg-muted/40"
						onclick={() => (thoughtExpanded = !thoughtExpanded)}
					>
						<div class="flex items-center gap-1.5">
							<Brain class="size-3 text-primary/70" />
							Thinking Process
						</div>
						{#if thoughtExpanded}
							<ChevronUp class="size-3" />
						{:else}
							<ChevronDown class="size-3" />
						{/if}
					</button>
					{#if thoughtExpanded}
						<div class="px-3 pb-3 pt-1 text-xs italic leading-relaxed text-muted-foreground/80">
							{message.thought || 'Processing thinking...'}
						</div>
					{/if}
				</div>
			{/if}

			<!-- Bubble -->
			<div
				class="relative rounded-2xl px-4 py-2.5 text-sm {isUser
					? 'bg-primary text-primary-foreground'
					: 'bg-muted text-foreground'}"
			>
				{#if message.displayStatus === 'generating' && !displayContent}
					<span class="flex items-center gap-1.5 text-muted-foreground">
						<Loader2 class="size-3 animate-spin" /> Thinking...
					</span>
				{:else}
					<div
						use:morphHtml={renderedHtml}
						class="prose prose-sm max-w-none {isUser
							? '**:text-primary-foreground prose-invert'
							: 'dark:prose-invert'}"
					></div>
				{/if}
			</div>

			<!-- Tool Calls (Character only) -->
			{#if !isUser && message.toolCalls && message.toolCalls.length > 0 && message.displayStatus !== 'generating'}
				<ToolCallGroup
					toolCalls={message.toolCalls}
					{onLoadDetail}
					onApprove={(id) => onResolveTool(id, 'approve')}
					onReject={(id) => onResolveTool(id, 'reject')}
				/>
			{/if}

			<!-- Action Buttons (hover) -->
			{#if message.displayStatus === 'completed'}
				<div
					class="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 {isUser
						? 'flex-row-reverse'
						: ''}"
				>
					<!-- Copy -->
					<Button
						variant="ghost"
						size="sm"
						class="h-6 gap-1 px-1.5 text-xs text-muted-foreground"
						onclick={handleCopy}
					>
						{#if copied}
							<Check class="size-3" />
						{:else}
							<Copy class="size-3" />
						{/if}
					</Button>

					<!-- Regenerate (Character only) -->
					{#if !isUser}
						<Button
							variant="ghost"
							size="sm"
							class="h-6 gap-1 px-1.5 text-xs text-muted-foreground"
							onclick={onRegenerate}
						>
							<RefreshCw class="size-3" />
						</Button>
					{/if}

					<!-- Edit (User only) -->
					{#if isUser}
						<Button
							variant="ghost"
							size="sm"
							class="h-6 gap-1 px-1.5 text-xs text-muted-foreground"
							onclick={onEdit}
						>
							<Pencil class="size-3" />
						</Button>
					{/if}

					<!-- Delete -->
					<Button
						variant="ghost"
						size="sm"
						class="h-6 gap-1 px-1.5 text-xs text-muted-foreground hover:text-destructive"
						onclick={onDelete}
					>
						<Trash2 class="size-3" />
					</Button>
				</div>
			{/if}
		{/if}
	</div>
</div>
