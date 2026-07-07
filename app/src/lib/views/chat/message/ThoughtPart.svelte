<script lang="ts">
    import { ChevronRight, ChevronDown } from 'lucide-svelte';
    let { text }: { text: string } = $props();
    let open = $state(false);
</script>

<details class="w-fit max-w-full text-xs text-muted-foreground" bind:open>
    <summary
        class="inline-flex cursor-pointer select-none list-none items-center gap-1.5 rounded-md border border-border/70 bg-background/60 px-2 py-1 font-mono text-xs text-muted-foreground"
    >
        {#if open}
            <ChevronDown class="size-3" />
        {:else}
            <ChevronRight class="size-3" />
        {/if}
        <span>thought</span>
    </summary>
    <div
        class="mt-2 max-w-prose whitespace-pre-wrap border-l-2 border-border/80 pl-3 italic leading-relaxed"
    >
        {text}
    </div>
</details>
