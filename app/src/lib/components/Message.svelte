<script lang="ts">
	/**
	 * Message Component
	 *
	 * Renders a single message in any display state:
	 *   - 'completed' (confirmed, stored in DB)
	 *   - 'generating' (ephemeral streaming bubble)
	 *   - 'error'      (failed generation, dismissable)
	 *
	 * Rendering pipeline:
	 *   message.content (output scripts applied by pipeline.ts)
	 *     → TODO: display scripts (markdown parse, display regex)
	 *     → TODO: morphdom DOM diffing + enter animation
	 *     → plain text for now
	 *
	 * Callbacks handle all side-effects — this component is pure UI.
	 */
	import type { DisplayMessage } from '$lib/stores';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { AlertCircle, Check, Loader2, Pencil, Trash2, X } from 'lucide-svelte';

	// ── Props ─────────────────────────────────────────────────────────────────

	export let message: DisplayMessage;

	/** Whether this specific message is currently being edited. */
	export let isEditing: boolean = false;

	/** Two-way bound edit buffer — parent owns the actual string state. */
	export let editText: string = '';

	// ── Callbacks ─────────────────────────────────────────────────────────────

	/** Called when the user clicks the edit (pencil) icon. */
	export let onEdit: () => void = () => {};

	/** Called when the user confirms an edit. Receives the final text. */
	export let onSave: (text: string) => void = () => {};

	/** Called when the user cancels an edit. */
	export let onCancelEdit: () => void = () => {};

	/** Called when the user clicks the delete (trash) icon. */
	export let onDelete: () => void = () => {};

	/** Called when the user dismisses a generation error bubble. */
	export let onDismissError: () => void = () => {};

	// ── Derived ───────────────────────────────────────────────────────────────

	$: isUser = message.role === 'user';

	// TODO: display scripts — run message.content through display regex scripts
	// to get rendered HTML (markdown, display regex).
	// Then apply morphdom DOM diffing for smooth streaming updates + animations.
	// For now: plain text pass-through.
	$: displayContent = message.content;
</script>

<!--
  Outer wrapper: aligns bubble left (char) or right (user).
  max-w-[80%] keeps long messages from spanning the full width.
-->
<div
	class="flex max-w-[80%] flex-col gap-1 {isUser
		? 'items-end self-end'
		: 'items-start self-start'}"
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

	<!-- ── Streaming bubble ── -->
	{:else if message.displayStatus === 'generating'}
		<div class="rounded-2xl bg-muted px-4 py-2 text-sm text-foreground">
			{#if displayContent}
				<!-- TODO: replace with morphdom-diffed HTML node once display scripts are wired -->
				{displayContent}<span
					class="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-foreground/60 align-middle"
				></span>
			{:else}
				<span class="flex items-center gap-1.5 text-muted-foreground">
					<Loader2 class="size-3 animate-spin" /> Thinking...
				</span>
			{/if}
		</div>

	<!-- ── Confirmed bubble ── -->
	{:else}
		<div
			class="rounded-2xl px-4 py-2 text-sm {isUser
				? 'bg-primary text-primary-foreground'
				: 'bg-muted text-foreground'}"
		>
			<!-- TODO: replace with morphdom-diffed HTML once display scripts are wired -->
			{displayContent}
		</div>
	{/if}
</div>
