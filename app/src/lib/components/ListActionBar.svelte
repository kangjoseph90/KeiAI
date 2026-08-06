<script lang="ts">
    import type { Snippet } from 'svelte';

    let {
        description,
        children
    }: {
        description: string;
        children: Snippet;
    } = $props();
</script>

<div class="flex items-center justify-between gap-3 min-w-0">
    <p class="text-sm text-muted-foreground truncate flex-1 min-w-0 pr-1" title={description}>
        {description}
    </p>
    <div class="flex shrink-0 items-center gap-1.5 flex-wrap">
        {@render children()}
    </div>
</div>
