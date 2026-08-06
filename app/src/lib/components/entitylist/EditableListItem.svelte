<script lang="ts">
    import type { Snippet } from 'svelte';
    import { slide } from 'svelte/transition';

    interface Props {
        header: Snippet;
        details?: Snippet;
        expanded?: boolean;
        muted?: boolean;
        busy?: boolean;
    }

    let { header, details, expanded = false, muted = false, busy = false }: Props = $props();
</script>

<div
    aria-busy={busy || undefined}
    class="group overflow-hidden rounded-lg border border-foreground/15 bg-card text-card-foreground transition-[border-color,opacity] hover:border-foreground/25 {muted
        ? 'opacity-55'
        : ''}"
>
    <div class="flex min-h-13 items-center gap-2 px-3 py-2">
        {@render header()}
    </div>

    {#if expanded && details}
        <div transition:slide={{ duration: 150 }}>
            <div class="flex flex-col gap-3 border-t bg-muted/20 p-3">
                {@render details()}
            </div>
        </div>
    {/if}
</div>
