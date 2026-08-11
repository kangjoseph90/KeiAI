<script lang="ts">
    import { ToolCallService, type ToolCall } from '$lib/services/content/tool';
    import type { ToolCallStatus } from '$lib/types/tools';
    import { listAgentTools } from '$lib/workflow/agent/tool';
    import { ChevronRight, FilePenLine, FileSearch, Wrench } from 'lucide-svelte';
    import { t } from '$lib/stores';

    let {
        id,
        name,
        status
    }: {
        id: string;
        name: string;
        status: ToolCallStatus;
    } = $props();

    let expanded = $state(false);
    let loading = $state(false);
    let detail = $state<ToolCall | null>(null);
    let loadError = $state('');

    const statusLabels = $derived<Record<ToolCallStatus, string>>({
        pending: $t('chat.toolCall.pending'),
        running: $t('chat.toolCall.running'),
        success: $t('chat.toolCall.completed'),
        rejected: $t('chat.toolCall.rejected'),
        error: $t('chat.toolCall.error')
    });
    const agentTools = listAgentTools();
    const toolDefinition = $derived(agentTools.find((tool) => tool.name === name));
    const toolLabel = $derived(toolDefinition?.label ?? name);
    const ToolIcon = $derived(
        toolDefinition?.permission === 'write'
            ? FilePenLine
            : toolDefinition?.permission === 'read'
              ? FileSearch
              : Wrench
    );

    async function loadDetail() {
        loading = true;
        loadError = '';
        try {
            detail = await ToolCallService.get(id);
            if (!detail) loadError = $t('chat.toolCall.unavailable');
        } catch (error) {
            loadError = error instanceof Error ? error.message : $t('chat.toolCall.loadFailed');
        } finally {
            loading = false;
        }
    }

    async function toggleExpanded() {
        expanded = !expanded;
        if (expanded && (!detail || detail.status !== status)) await loadDetail();
    }

    $effect(() => {
        const currentStatus = status;
        if (expanded && detail?.status !== currentStatus) void loadDetail();
    });
</script>

<div class="text-xs text-muted-foreground">
    <button
        type="button"
        class="inline-flex w-fit max-w-full items-center gap-1.5 py-1 text-left hover:text-foreground"
        aria-expanded={expanded}
        aria-label={`${toolLabel} · ${statusLabels[status]}`}
        onclick={toggleExpanded}
    >
        <ToolIcon class="size-3.5 shrink-0" />
        <span class="truncate">{toolLabel}</span>
        <span class:text-destructive={status === 'error' || status === 'rejected'} class="shrink-0"
            >· {statusLabels[status]}</span
        >
        <ChevronRight class="size-3 shrink-0 transition-transform {expanded ? 'rotate-90' : ''}" />
    </button>

    <div class="tool-call-details-container {expanded ? 'is-open' : ''}">
        <div class="tool-call-details-inner">
            <div
                class="mt-1 mr-2 ml-5 space-y-2 rounded-md border border-border/70 bg-background/60 px-2 py-2 text-[11px]"
            >
                {#if loading}
                    <p>{$t('chat.toolCall.loadingDetails')}</p>
                {:else if loadError}
                    <p class="text-destructive">{loadError}</p>
                {:else if detail}
                    <div>
                        <p class="mb-1 font-medium text-foreground">
                            {$t('chat.toolCall.arguments')}
                        </p>
                        <pre
                            class="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-2">{JSON.stringify(
                                detail.call.args,
                                null,
                                2
                            )}</pre>
                    </div>
                    {#if detail.response}
                        <div>
                            <p class="mb-1 font-medium text-foreground">
                                {$t('chat.toolCall.response')}
                            </p>
                            <pre
                                class="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2">{JSON.stringify(
                                    detail.response,
                                    null,
                                    2
                                )}</pre>
                        </div>
                    {/if}
                {/if}
            </div>
        </div>
    </div>
</div>

<style>
    .tool-call-details-container {
        display: grid;
        grid-template-rows: 0fr;
        opacity: 0;
        transition:
            grid-template-rows 150ms cubic-bezier(0.4, 0, 0.2, 1),
            opacity 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    .tool-call-details-container.is-open {
        grid-template-rows: 1fr;
        opacity: 1;
    }

    .tool-call-details-inner {
        overflow: hidden;
    }
</style>
