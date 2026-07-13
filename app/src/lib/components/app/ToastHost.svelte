<script lang="ts">
    import { X } from 'lucide-svelte';
    import { onMount } from 'svelte';
    import { toastItems, type ToastItem } from '$lib/ui/state';
    import { dismissToast, toast } from '$lib/ui/toast';
    import { Button } from '$lib/components/ui/button';
    import { buffer } from '$lib/services';

    const kindClass = {
        info: 'border-border bg-background text-foreground',
        success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100',
        warning: 'border-amber-500/30 bg-amber-500/10 text-amber-950 dark:text-amber-100',
        error: 'border-destructive/40 bg-destructive/10 text-destructive'
    };

    let runningActionId = $state<string | null>(null);
    let persistenceToastId: string | null = null;

    onMount(() =>
        buffer.subscribePersistenceState((state) => {
            if (state === 'failed' && !persistenceToastId) {
                persistenceToastId = toast.error({
                    title: 'Changes are not saved',
                    description: 'Your changes are kept in memory. Retry before closing the app.',
                    persistent: true,
                    action: {
                        label: 'Retry save',
                        run: () => buffer.retryFailed()
                    }
                });
            } else if (state === 'healthy' && persistenceToastId) {
                dismissToast(persistenceToastId);
                persistenceToastId = null;
            }
        })
    );

    async function runAction(item: ToastItem): Promise<void> {
        if (!item.action || runningActionId === item.id) return;
        runningActionId = item.id;
        try {
            await item.action.run();
            dismissItem(item.id);
        } catch {
            // The action owner keeps its error state visible.
        } finally {
            runningActionId = null;
        }
    }

    function dismissItem(id: string): void {
        if (id === persistenceToastId) persistenceToastId = null;
        dismissToast(id);
    }
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
                            disabled={runningActionId === item.id}
                            aria-busy={runningActionId === item.id}
                            onclick={() => runAction(item)}
                        >
                            {runningActionId === item.id ? 'Working...' : item.action.label}
                        </Button>
                    {/if}
                </div>
                <button
                    class="rounded p-0.5 opacity-60 hover:opacity-100"
                    aria-label="Dismiss notification"
                    onclick={() => dismissItem(item.id)}
                >
                    <X class="size-3.5" />
                </button>
            </div>
        </div>
    {/each}
</div>
