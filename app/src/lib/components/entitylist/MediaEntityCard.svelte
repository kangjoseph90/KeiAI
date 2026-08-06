<script lang="ts">
    import type { Snippet } from 'svelte';
    import { cn } from '$lib/utils';

    interface Props {
        name: string;
        meta?: string;
        visual: Snippet;
        nameContent?: Snippet;
        action?: Snippet;
        align?: 'start' | 'center';
        density?: 'compact' | 'regular';
        interactive?: boolean;
        class?: string;
        visualClass?: string;
        footerClass?: string;
        nameClass?: string;
        metaClass?: string;
    }

    let {
        name,
        meta = undefined,
        visual,
        nameContent = undefined,
        action = undefined,
        align = 'start',
        density = 'regular',
        interactive = true,
        class: className = '',
        visualClass = '',
        footerClass = '',
        nameClass = '',
        metaClass = ''
    }: Props = $props();

    const centered = $derived(align === 'center');
    const compact = $derived(density === 'compact');
</script>

<div
    class={cn(
        'group/media-card w-full min-w-0 overflow-hidden rounded-xl border border-foreground/15 bg-card text-card-foreground transition-[transform,box-shadow,border-color,background-color]',
        interactive && 'hover:-translate-y-0.5 hover:border-foreground/25 hover:shadow-md',
        className
    )}
>
    <div
        class={cn(
            'relative flex aspect-4/3 w-full items-center justify-center overflow-hidden bg-muted',
            compact && 'text-sm font-semibold',
            visualClass
        )}
    >
        {@render visual()}
        {#if action}
            <div class="absolute right-1 top-1 z-10">
                {@render action()}
            </div>
        {/if}
    </div>

    <div
        class={cn(
            'min-w-0',
            compact ? 'px-2 py-1.5' : 'p-2',
            centered ? 'text-center' : 'text-left',
            footerClass
        )}
    >
        <div class={cn('truncate font-normal', compact ? 'text-[11px]' : 'text-sm', nameClass)}>
            {#if nameContent}
                {@render nameContent()}
            {:else}
                {name}
            {/if}
        </div>

        {#if meta}
            <div
                class={cn(
                    'mt-0.5 truncate text-muted-foreground',
                    compact ? 'text-[10px]' : 'text-xs',
                    metaClass
                )}
            >
                {meta}
            </div>
        {/if}
    </div>
</div>
