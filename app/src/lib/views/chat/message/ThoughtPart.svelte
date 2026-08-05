<script lang="ts">
    let {
        text,
        collapsible = true
    }: {
        text: string;
        collapsible?: boolean;
    } = $props();

    let isExpanded = $state(false);

    let lines = $derived(text.split('\n'));
    let hasMore = $derived(lines.length > 1 || text.length > 100);

    let displayText = $derived.by(() => {
        if (!collapsible || isExpanded) {
            return text;
        }
        const firstLine = lines[0];
        const preview = firstLine.length > 100 ? firstLine.slice(0, 100) : firstLine;
        return hasMore ? `${preview}...` : preview;
    });

    let canToggle = $derived(collapsible && hasMore);
</script>

{#if canToggle}
    <button
        type="button"
        class="block max-w-prose cursor-pointer whitespace-pre-wrap text-left italic leading-relaxed text-xs text-muted-foreground/80 transition-colors hover:text-muted-foreground"
        aria-expanded={isExpanded}
        onclick={() => (isExpanded = !isExpanded)}
    >
        {displayText}
    </button>
{:else}
    <div
        class="max-w-prose whitespace-pre-wrap italic leading-relaxed text-xs text-muted-foreground/80"
    >
        {displayText}
    </div>
{/if}
