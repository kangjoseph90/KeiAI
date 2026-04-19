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
		ChevronLeft,
		ChevronRight,
		GitBranch,
		Copy,
		RefreshCw
	} from 'lucide-svelte';
	import { onDestroy } from 'svelte';
	import ToolCallGroup from './ToolCallGroup.svelte';
	import type { ToolCall } from '$lib/services/content/tool';
	import { runPipeline } from '$lib/pipeline';
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
		isLastMessage = false,
		onEdit = () => {},
		onSave = () => {},
		onCancelEdit = () => {},
		onDelete = () => {},
		onDismissError = () => {},
		onResolveTool = () => {},
		onLoadDetail = async (_id: string) => null,
		onRegenerate = () => {},
		onSwipe = (_id: string) => {},
		onFork = () => {},
		onCopy = () => {}
	}: {
		message: DisplayMessage;
		isEditing?: boolean;
		editText?: string;
		characterName?: string;
		isLastMessage?: boolean;
		onEdit?: () => void;
		onSave?: (text: string) => void;
		onCancelEdit?: () => void;
		onDelete?: () => void;
		onDismissError?: () => void;
		onResolveTool?: (id: string, decision: 'approve' | 'reject') => void;
		onLoadDetail?: (id: string) => Promise<ToolCall | null>;
		onRegenerate?: () => void;
		onSwipe?: (id: string) => void;
		onFork?: () => void;
		onCopy?: () => void;
	} = $props();

	// ── State ─────────────────────────────────────────────────────────────────

	let thoughtExpanded = $state(false);
	let copied = $state(false);

	// Render pipeline internals
	let displayContent = $state('');
	let lastContent = '';
	let renderedHtml = $state('');
	let lastStatus: string | undefined;

	// ── Derived ───────────────────────────────────────────────────────────────

	let isUser = $derived(message.role === 'user');

	/** The swipe that is currently active for this message. */
	let activeSwipe = $derived(message.swipes[message.activeSwipeId]);

	/** Swipes sorted by creation time for consistent navigation. */
	let sortedSwipes = $derived(
		Object.values(message.swipes).sort((a, b) => a.createdAt - b.createdAt)
	);

	/** The position of the active swipe in the sorted list. */
	let swipePos = $derived(sortedSwipes.findIndex((s) => s.id === message.activeSwipeId));

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
		await navigator.clipboard.writeText(activeSwipe?.content ?? '');
		copied = true;
		onCopy();
		setTimeout(() => (copied = false), 2000);
	}

	// ── Markdown ──────────────────────────────────────────────────────────────

	let pendingRefresh = false;
	let missedUpdate = false;
	let lastRenderTime = 0;
	let renderTimeout: ReturnType<typeof setTimeout> | null = null;
	const RENDER_THROTTLE_MS = 150;

	async function executeRender(contentToRender: string) {
		if (pendingRefresh) {
			missedUpdate = true;
			return;
		}
		pendingRefresh = true;

		try {
			const processed = await runPipeline(message.chatId, 'display', contentToRender);
			const rawHtml = await parseMarkdownAsync(processed);
			const sanitized = DOMPurify.sanitize(rawHtml as string);

			// Update states atomically
			displayContent = processed;
			renderedHtml = sanitized;
		} finally {
			pendingRefresh = false;
			lastRenderTime = Date.now();
			if (missedUpdate) {
				missedUpdate = false;
				refreshDisplay(); // Retry with the latest message.content
			}
		}
	}

	function refreshDisplay() {
		const currentContent = activeSwipe?.content ?? '';

		// If completely done or error, render immediately without throttling
		if (message.displayStatus !== 'generating') {
			if (renderTimeout) {
				clearTimeout(renderTimeout);
				renderTimeout = null;
			}
			executeRender(currentContent);
			return;
		}

		// Throttling logic for generating state
		const now = Date.now();
		const timeSinceLastRender = now - lastRenderTime;

		if (timeSinceLastRender >= RENDER_THROTTLE_MS) {
			if (renderTimeout) {
				clearTimeout(renderTimeout);
				renderTimeout = null;
			}
			executeRender(currentContent);
		} else if (!renderTimeout) {
			renderTimeout = setTimeout(() => {
				renderTimeout = null;
				executeRender(activeSwipe?.content ?? ''); // Use latest content when timeout fires
			}, RENDER_THROTTLE_MS - timeSinceLastRender);
		}
	}

	$effect(() => {
		const current = activeSwipe?.content ?? '';
		const status = message.displayStatus;

		// Ensure refresh on both content updates and status transitions (e.g. generating -> completed)
		if (current !== lastContent || status !== lastStatus) {
			// Synchronously clear state when a fresh generation starts to prevent showing old content
			if (status === 'generating' && current === '') {
				displayContent = '';
				renderedHtml = '';
			}
			lastContent = current;
			lastStatus = status;
			refreshDisplay();
		}
	});

	onDestroy(() => {
		if (renderTimeout) {
			clearTimeout(renderTimeout);
			renderTimeout = null;
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
			{#if !isUser && activeSwipe?.thought}
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
							{activeSwipe.thought || 'Processing thinking...'}
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
			{#if !isUser && activeSwipe?.toolCalls && Object.keys(activeSwipe.toolCalls).length > 0 && message.displayStatus !== 'generating'}
				<ToolCallGroup
					toolCalls={activeSwipe.toolCalls}
					{onLoadDetail}
					onApprove={(id) => onResolveTool(id, 'approve')}
					onReject={(id) => onResolveTool(id, 'reject')}
				/>
			{/if}

			<!-- Single Action Row (hover) -->
			{#if message.displayStatus === 'completed'}
				<div
					class="mt-0.5 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100 {isUser
						? 'flex-row-reverse'
						: 'flex-row'}"
				>
					<!-- Swipe Navigator (Character only, multiple swipes) -->
					{#if !isUser && sortedSwipes.length > 1}
						<div class="flex items-center gap-0.5 text-xs text-muted-foreground mr-1">
							<button
								class="rounded p-0.5 hover:bg-muted disabled:opacity-30"
								disabled={swipePos <= 0}
								onclick={() => onSwipe(sortedSwipes[swipePos - 1].id)}
							>
								<ChevronLeft class="size-3.5" />
							</button>
							<span class="tabular-nums font-medium">{swipePos + 1} / {sortedSwipes.length}</span>
							<button
								class="rounded p-0.5 hover:bg-muted disabled:opacity-30"
								disabled={swipePos >= sortedSwipes.length - 1}
								onclick={() => onSwipe(sortedSwipes[swipePos + 1].id)}
							>
								<ChevronRight class="size-3.5" />
							</button>
						</div>
					{/if}

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

					{#if !isUser}
						<!-- Regenerate: last char message only -->
						{#if isLastMessage}
							<Button
								variant="ghost"
								size="sm"
								class="h-6 gap-1 px-1.5 text-xs text-muted-foreground"
								onclick={onRegenerate}
							>
								<RefreshCw class="size-3" />
							</Button>
						{/if}

						<!-- Fork: always available for char messages -->
						<Button
							variant="ghost"
							size="sm"
							class="h-6 gap-1 px-1.5 text-xs text-muted-foreground"
							onclick={onFork}
						>
							<GitBranch class="size-3" />
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
