<script lang="ts">
	/**
	 * ToolCallItem Component
	 *
	 * Renders an individual tool call summary.
	 * Loads full details (args/response) from DB only on expansion.
	 */
	import { type ToolCall, type ToolCallStatus } from '$lib/services/content/tool';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { ChevronDown, ChevronUp, Play, XCircle, Code } from 'lucide-svelte';
	import { slide } from 'svelte/transition';

	let {
		id,
		name,
		status,
		onLoadDetail = async (_id: string) => null as ToolCall | null,
		onApprove = () => {},
		onReject = () => {}
	}: {
		id: string;
		name: string;
		status: ToolCallStatus;
		onLoadDetail?: (id: string) => Promise<ToolCall | null>;
		onApprove?: (id: string) => void;
		onReject?: (id: string) => void;
	} = $props();

	let expanded = $state(false);
	let detail = $state<ToolCall | null>(null);
	let loading = $state(false);

	async function toggle() {
		expanded = !expanded;
		if (expanded && !detail) {
			loading = true;
			try {
				detail = await onLoadDetail(id);
			} finally {
				loading = false;
			}
		}
	}

	let statusColor = $derived(
		({
			pending: 'outline',
			success: 'secondary',
			rejected: 'destructive',
			error: 'destructive'
		}[status] as BadgeVariant) ?? 'outline'
	);
</script>

<div class="mb-2 w-full rounded-lg border bg-card text-card-foreground shadow-sm">
	<!-- Summary Header -->
	<div class="flex items-center justify-between p-3">
		<button
			class="flex flex-1 items-center gap-2 text-left transition-opacity hover:opacity-80"
			onclick={toggle}
		>
			{#if expanded}
				<ChevronUp class="size-4 text-muted-foreground" />
			{:else}
				<ChevronDown class="size-4 text-muted-foreground" />
			{/if}
			<Code class="size-4 text-primary" />
			<span class="text-sm font-medium">{name}</span>
			<Badge variant={statusColor} class="ml-2 uppercase tracking-tighter">
				{status}
			</Badge>
		</button>

		{#if status === 'pending'}
			<div class="flex items-center gap-1">
				<Button
					size="sm"
					variant="default"
					class="h-7 gap-1 px-2 text-xs"
					onclick={() => onApprove(id)}
				>
					<Play class="size-3 fill-current" /> Approve
				</Button>
				<Button
					size="sm"
					variant="outline"
					class="h-7 gap-1 px-2 text-xs text-destructive hover:bg-destructive/10"
					onclick={() => onReject(id)}
				>
					<XCircle class="size-3" /> Reject
				</Button>
			</div>
		{/if}
	</div>

	<!-- Expanded Details -->
	{#if expanded}
		<div transition:slide={{ duration: 200 }} class="border-t bg-muted/30 p-3 text-xs">
			{#if loading}
				<div class="flex animate-pulse items-center gap-2 text-muted-foreground py-2">
					<div class="size-3 rounded-full bg-muted-foreground/30"></div>
					Loading details...
				</div>
			{:else if detail}
				<div class="flex flex-col gap-3">
					<!-- Arguments -->
					<div class="flex flex-col gap-1">
						<span class="font-semibold text-muted-foreground uppercase tracking-wider text-[10px]"
							>Arguments</span
						>
						<pre class="overflow-x-auto rounded border bg-background p-2 font-mono leading-relaxed">
							{JSON.stringify(detail.call.args, null, 2)}
						</pre>
					</div>

					<!-- Response (if exists) -->
					{#if detail.response}
						<div class="flex flex-col gap-1">
							<span class="font-semibold text-muted-foreground uppercase tracking-wider text-[10px]"
								>Response</span
							>
							<div class="rounded border bg-background p-2">
								{#each detail.response.content as item, i (i)}
									{#if item.type === 'text'}
										<p class="whitespace-pre-wrap">{item.text}</p>
									{:else}
										<p class="italic text-muted-foreground">[{item.type} resource]</p>
									{/if}
								{/each}
							</div>
						</div>
					{/if}
				</div>
			{:else}
				<p class="text-destructive py-2">Failed to load details.</p>
			{/if}
		</div>
	{/if}
</div>
