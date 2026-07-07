<script lang="ts">
    import type { ToolCallStatus } from '$lib/services/content/tool';
    import { Check, Loader2, X, AlertCircle } from 'lucide-svelte';

    // TODO: Load full tool call detail (args, response) via ToolCallService.get(id)
    // for an expandable card. Currently only name/status from the part are shown.
    let {
        name,
        status
    }: {
        name: string;
        status: ToolCallStatus;
    } = $props();

    const icons = { success: Check, pending: Loader2, rejected: X, error: AlertCircle };
    const StatusIcon = $derived(icons[status]);
</script>

<div
    class="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background/60 px-2 py-1 text-xs text-muted-foreground"
>
    <StatusIcon class="size-3 {status === 'pending' ? 'animate-spin' : ''}" />
    <span class="font-mono">{name}</span>
</div>
