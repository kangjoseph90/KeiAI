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

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    onclick={() => {
        if (canToggle) isExpanded = !isExpanded;
    }}
    class="max-w-prose whitespace-pre-wrap italic leading-relaxed text-xs text-muted-foreground/80 {canToggle
        ? 'cursor-pointer hover:text-muted-foreground transition-colors'
        : ''}"
>
    {displayText}
</div>
