<script lang="ts">
    import type { Snippet } from 'svelte';
    import type { HTMLAttributes } from 'svelte/elements';
    import { cn, type WithElementRef } from '$lib/utils';

    let {
        ref = $bindable(null),
        class: className,
        children,
        ...restProps
    }: WithElementRef<HTMLAttributes<HTMLDivElement>> & { children: Snippet } = $props();
</script>

<div
    bind:this={ref}
    data-slot="setting-row"
    class={cn(
        'flex min-h-13 flex-col gap-3 rounded-lg border border-foreground/15 px-3 py-2 sm:flex-row sm:items-center sm:justify-between',
        className
    )}
    {...restProps}
>
    {@render children()}
</div>
