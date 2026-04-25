<script lang="ts">
    /**
     * ToolCallGroup Component
     *
     * Continer for multiple tool calls within a message.
     */
    import type { ToolCallInfo, ToolCall } from '$lib/services/content/tool';
    import ToolCallItem from './ToolCallItem.svelte';

    let {
        toolCalls,
        onLoadDetail = async (_id: string) => null as ToolCall | null,
        onApprove = () => {},
        onReject = () => {}
    }: {
        toolCalls: Record<string, ToolCallInfo>;
        onLoadDetail?: (id: string) => Promise<ToolCall | null>;
        onApprove?: (id: string) => void;
        onReject?: (id: string) => void;
    } = $props();
</script>

<div class="mt-3 flex w-full flex-col gap-1">
    {#each Object.values(toolCalls) as tc (tc.id)}
        <ToolCallItem
            id={tc.id}
            name={tc.name}
            status={tc.status}
            {onLoadDetail}
            {onApprove}
            {onReject}
        />
    {/each}
</div>
