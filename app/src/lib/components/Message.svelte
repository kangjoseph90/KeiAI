<script lang="ts">
	/**
	 * Message Component — Svelte 5 Runes
	 *
	 * Renders a single message in any display state.
	 * Callbacks handle all side-effects — this component is pure UI.
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
		ChevronUp
	} from 'lucide-svelte';
	import { onMount } from 'svelte';
	import ToolCallGroup from './ToolCallGroup.svelte';
	import type { ToolCall } from '$lib/services/content/tool';
	import { activeScripts } from '$lib/stores';
	import { applyScripts } from '$lib/runtime/scripts/executor';
	import { marked } from 'marked';
	import morphdom from 'morphdom';
	import DOMPurify from 'dompurify';
	import type { Action } from 'svelte/action';

	// ── Props ─────────────────────────────────────────────────────────────────

	let {
		message,
		isEditing = false,
		editText = $bindable(''),
		onEdit = () => {},
		onSave = () => {},
		onCancelEdit = () => {},
		onDelete = () => {},
		onDismissError = () => {},
		onResolveTool = () => {},
		onLoadDetail = async (_id: string) => null
	}: {
		message: DisplayMessage;
		isEditing?: boolean;
		editText?: string;
		onEdit?: () => void;
		onSave?: (text: string) => void;
		onCancelEdit?: () => void;
		onDelete?: () => void;
		onDismissError?: () => void;
		/** called with (toolCallId, 'approve' | 'reject') */
		onResolveTool?: (id: string, decision: 'approve' | 'reject') => void;
		onLoadDetail?: (id: string) => Promise<ToolCall | null>;
	} = $props();

	// ── State ─────────────────────────────────────────────────────────────────

	let thoughtExpanded = $state(false);
	let displayContent = $state('');
	let lastContent = $state('');
	let renderedHtml = $state('');

	// ── Derived ───────────────────────────────────────────────────────────────

	let isUser = $derived(message.role === 'user');

	// ── Actions ───────────────────────────────────────────────────────────────

	/**
	 * Seamlessly diffs and morphs DOM nodes without losing external bindings,
	 * ensuring performance is optimal even for rapid streams.
	 */
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

					// If it's a word-span and text changed, we might want to re-animate?
					// Actually, morphdom will skip identical ones and add new ones.
					return true;
				},
				onNodeAdded: (newNode) => {
					if (newNode instanceof HTMLElement && message.displayStatus === 'generating') {
						// Only animate if the message is actively streaming
						newNode.classList.add('reveal-node');
						// Reclaim GPU resources after animation completes
						newNode.addEventListener(
							'animationend',
							() => {
								newNode.classList.remove('reveal-node');
							},
							{ once: true }
						);
					}
				}
			});
		};

		update(html);

		return {
			update
		};
	};

	// ── Markdown Setup ────────────────────────────────────────────────────────

	const renderer = new marked.Renderer();
	renderer.text = (token: string | { text: string }) => {
		const text = typeof token === 'string' ? token : token.text;
		if (!text) return '';
		return text
			.split(/(\s+)/)
			.map((t: string) => {
				if (!t.trim()) return t;
				// Always wrap in span for structural consistency
				return `<span class="inline-block whitespace-pre">${t}</span>`;
			})
			.join('');
	};

	// Refresh display content - throttled for performance during streaming
	let pendingRefresh = false;
	async function refreshDisplay() {
		if (pendingRefresh && message.displayStatus === 'generating') return;
		pendingRefresh = true;

		// Use requestAnimationFrame to sync with display refresh rate
		requestAnimationFrame(async () => {
			try {
				const processed = await applyScripts(message.content, $activeScripts, 'display');
				displayContent = processed;

				// Always use the custom renderer to prevent layout shifts when spans are removed
				const rawHtml = await marked.parse(processed, { renderer });
				renderedHtml = DOMPurify.sanitize(rawHtml as string);
			} finally {
				pendingRefresh = false;
			}
		});
	}

	// Auto-refresh when message.content changes
	$effect(() => {
		const current = message.content;
		if (current !== lastContent) {
			lastContent = current;
			refreshDisplay();
		}
	});

	// Initialize synchronously to prevent flickering on re-mount (ID changes)
	onMount(async () => {
		if (message.content) {
			displayContent = message.content;
			// Only use word-spans if actively generating
			const rawHtml = marked.parse(message.content, { renderer });
			// In most marked configs, this returns a string synchronously if not using async extensions
			if (typeof rawHtml === 'string') {
				renderedHtml = DOMPurify.sanitize(rawHtml);
			} else {
				// Fallback for async-only marked versions
				renderedHtml = DOMPurify.sanitize(await rawHtml);
			}
			refreshDisplay();
		}
	});
</script>

<!--
  Outer wrapper: aligns bubble left (char) or right (user).
  max-w-[80%] keeps long messages from spanning the full width.
-->
<div
	class="flex max-w-[80%] flex-col gap-1 {isUser ? 'items-end self-end' : 'items-start self-start'}"
>
	<!-- ── Edit / Delete controls (user's confirmed messages only) ── -->
	{#if isUser && message.displayStatus === 'completed' && !isEditing}
		<div class="flex gap-1">
			<Button size="sm" variant="ghost" class="h-6 w-6 p-0" onclick={onEdit}>
				<Pencil class="size-3" />
			</Button>
			<Button size="sm" variant="ghost" class="h-6 w-6 p-0 text-destructive" onclick={onDelete}>
				<Trash2 class="size-3" />
			</Button>
		</div>
	{/if}

	<!-- ── Edit mode ── -->
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

		<!-- ── Error bubble ── -->
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

		<!-- ── Message Content (Generating & Completed) ── -->
	{:else}
		<!-- ── Thought process (Char only) ── -->
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

		<div
			class="relative rounded-2xl px-4 py-2 text-sm {isUser
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

		<!-- ── Tool Calls (Char only) ── -->
		{#if !isUser && message.toolCalls && message.toolCalls.length > 0 && message.displayStatus !== 'generating'}
			<ToolCallGroup
				toolCalls={message.toolCalls}
				{onLoadDetail}
				onApprove={(id) => onResolveTool(id, 'approve')}
				onReject={(id) => onResolveTool(id, 'reject')}
			/>
		{/if}
	{/if}
</div>

<style>
	@keyframes reveal {
		from {
			opacity: 0;
			clip-path: inset(0 100% 100% 0); /* Top-left hidden */
		}
		to {
			opacity: 1;
			clip-path: inset(0 0 0 0); /* Full reveal */
		}
	}

	/* Use :global to apply to nodes added via morphdom/Action */
	:global(.reveal-node) {
		display: inline-block;
		animation: reveal 0.4s cubic-bezier(0, 0.5, 0.5, 1) forwards;
		will-change: opacity, transform, clip-path;
	}
</style>
