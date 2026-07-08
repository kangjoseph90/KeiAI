<script lang="ts">
    import { X } from 'lucide-svelte';
    import { toastItems } from '$lib/ui/state';
    import { dismissToast } from '$lib/ui/toast';
    import { Button } from '$lib/components/ui/button';

    const kindClass = {
        info: 'border-border bg-background text-foreground',
        success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100',
        warning: 'border-amber-500/30 bg-amber-500/10 text-amber-950 dark:text-amber-100',
        error: 'border-destructive/40 bg-destructive/10 text-destructive'
    };
</script>

<div
    class="pointer-events-none fixed right-4 bottom-4 z-70 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
>
    {#each $toastItems as item (item.id)}
        <div
            class="pointer-events-auto rounded-lg border p-3 shadow-lg backdrop-blur {kindClass[
                item.kind
            ]}"
        >
            <div class="flex items-start gap-3">
                <div class="min-w-0 flex-1">
                    <div class="text-sm font-medium">{item.title}</div>
                    {#if item.description}
                        <div class="mt-1 text-xs opacity-80">{item.description}</div>
                    {/if}
                    {#if item.action}
                        <Button
                            variant="outline"
                            size="sm"
                            class="mt-2 h-7 bg-background/70"
                            onclick={async () => {
                                await item.action?.run();
                                dismissToast(item.id);
                            }}
                        >
                            {item.action.label}
                        </Button>
                    {/if}
                </div>
                <button
                    class="rounded p-0.5 opacity-60 hover:opacity-100"
                    aria-label="Dismiss notification"
                    onclick={() => dismissToast(item.id)}
                >
                    <X class="size-3.5" />
                </button>
            </div>
        </div>
    {/each}
</div>
