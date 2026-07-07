<script lang="ts">
    import type { AgentPart } from '$lib/workflow/agent/llm';
    import ContentPart, { type ContentPartRenderContext } from './ContentPart.svelte';
    import ThoughtPart from './ThoughtPart.svelte';
    import ToolCallPart from './ToolCallPart.svelte';

    interface TimelineEntry {
        part: AgentPart;
        index: number;
    }

    let {
        entries,
        renderContext,
        isUser,
        open = $bindable(false)
    }: {
        entries: TimelineEntry[];
        renderContext: ContentPartRenderContext;
        isUser: boolean;
        open?: boolean;
    } = $props();

    const countLabel = $derived(`${entries.length} step${entries.length > 1 ? 's' : ''}`);
</script>

<details class="trace-timeline" bind:open>
    <summary class="trace-summary">
        <span class="trace-root-dot"></span>
        <span class="font-medium">{countLabel}</span>
    </summary>
    <div class="trace-list">
        {#each entries as entry (entry.index)}
            <div class="trace-item">
                <span class="trace-dot"></span>
                <div class="trace-body">
                    {#if entry.part.type === 'thought'}
                        {#if entries.length === 1}
                            <div
                                class="max-w-prose whitespace-pre-wrap italic leading-relaxed text-xs text-muted-foreground/80"
                            >
                                {entry.part.text}
                            </div>
                        {:else}
                            <ThoughtPart text={entry.part.text} />
                        {/if}
                    {:else if entry.part.type === 'tool_call'}
                        <ToolCallPart name={entry.part.name} status={entry.part.status} />
                    {:else if entry.part.type === 'content'}
                        <ContentPart text={entry.part.text} {renderContext} {isUser} />
                    {/if}
                </div>
            </div>
        {/each}
    </div>
</details>

<style>
    .trace-timeline {
        --trace-x: 0.875rem;
        display: block;
        color: var(--muted-foreground);
        padding-left: 0.25rem;
    }

    .trace-summary {
        display: flex;
        align-items: center;
        gap: 0.7rem;
        min-height: 1.75rem;
        cursor: pointer;
        user-select: none;
        list-style: none;
        font-size: 0.75rem;
        opacity: 0.78;
    }

    .trace-summary:hover {
        opacity: 1;
    }

    .trace-summary::-webkit-details-marker {
        display: none;
    }

    .trace-root-dot {
        display: block;
        width: 1.25rem;
        height: 1.25rem;
        border-radius: 9999px;
        border: 2px solid var(--border);
        background: var(--background);
        box-shadow: inset 0 0 0 4px var(--muted);
        flex: none;
        margin-left: 0.25rem;
    }

    .trace-list {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 0.9rem;
        margin-top: 0.45rem;
        padding-left: 2.35rem;
        padding-bottom: 0.2rem;
    }

    .trace-list::before {
        content: '';
        position: absolute;
        left: var(--trace-x);
        top: -0.75rem;
        bottom: 0.65rem;
        width: 2px;
        border-radius: 9999px;
        background: var(--border);
    }

    .trace-item {
        position: relative;
        min-width: 0;
    }

    .trace-dot {
        display: block;
        position: absolute;
        left: calc(-2.35rem + var(--trace-x) - 0.31rem);
        top: 0.58rem;
        width: 0.68rem;
        height: 0.68rem;
        border-radius: 9999px;
        border: 2px solid var(--border);
        background: var(--background);
        z-index: 1;
    }

    .trace-body {
        min-width: 0;
    }
</style>
