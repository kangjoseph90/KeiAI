<script lang="ts">
    import type { CharJS } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Textarea } from '$lib/components/ui/textarea';
    import { Badge } from '$lib/components/ui/badge';
    import { Label } from '$lib/components/ui/label';
    import { ChevronDown, ChevronRight, Eye, EyeOff, GripVertical, Trash2 } from 'lucide-svelte';
    import { appConfirm, toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';

    let {
        item,
        initiallyEditing = false,
        onUpdate,
        onDelete
    }: {
        item: CharJS;
        initiallyEditing?: boolean;
        onUpdate: (id: string, changes: DeepPartial<CharJS>) => void | Promise<void>;
        onDelete: (id: string) => void | Promise<void>;
    } = $props();

    let expanded = $state(false);
    let openedInitially = $state(false);
    let busy = $state(false);

    $effect(() => {
        if (initiallyEditing && !openedInitially) {
            openedInitially = true;
            expanded = true;
        }
    });

    async function handleUpdate(changes: DeepPartial<CharJS>): Promise<void> {
        if (busy) return;
        busy = true;
        try {
            await onUpdate(item.id, changes);
        } catch (error) {
            toast.error({ title: 'CharJS update failed', description: getErrorMessage(error) });
        } finally {
            busy = false;
        }
    }

    async function handleDelete(): Promise<void> {
        if (busy) return;
        busy = true;
        try {
            const confirmed = await appConfirm({
                title: 'Delete CharJS entry?',
                description: `Delete "${item.name}"?`,
                confirmText: 'Delete',
                variant: 'destructive'
            });
            if (!confirmed) return;
            await onDelete(item.id);
        } catch (error) {
            toast.error({
                title: 'Could not delete CharJS entry',
                description: getErrorMessage(error)
            });
        } finally {
            busy = false;
        }
    }
</script>

<div
    aria-busy={busy}
    class="group overflow-hidden rounded-xl border bg-card shadow-sm transition-[border-color,box-shadow,opacity] hover:border-border/80 hover:shadow-md {item.enabled
        ? ''
        : 'opacity-55'}"
>
    <div class="flex min-h-14 items-center gap-2 px-3 py-2">
        <div
            class="flex h-8 w-5 shrink-0 cursor-grab active:cursor-grabbing select-none items-center justify-center text-muted-foreground/45 transition-colors hover:text-muted-foreground"
            aria-hidden="true"
        >
            <GripVertical class="size-4" />
        </div>
        <button
            type="button"
            class="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onclick={() => (expanded = !expanded)}
            aria-label={expanded ? 'Collapse CharJS entry' : 'Expand CharJS entry'}
        >
            {#if expanded}
                <ChevronDown class="size-4" />
            {:else}
                <ChevronRight class="size-4" />
            {/if}
        </button>

        <Input
            disabled={busy}
            value={item.name}
            aria-label="CharJS name"
            class="h-8 min-w-0 flex-1 border-0 bg-transparent px-1 font-medium shadow-none focus-visible:ring-0 text-sm leading-relaxed"
            onchange={(e) => handleUpdate({ name: e.currentTarget.value })}
        />

        {#if !item.enabled}
            <Badge variant="outline" class="text-xs shrink-0">Disabled</Badge>
        {/if}

        <Button
            size="icon"
            variant="ghost"
            class="size-8 shrink-0 text-muted-foreground"
            title={item.enabled ? 'Disable CharJS' : 'Enable CharJS'}
            aria-label={item.enabled ? 'Disable CharJS' : 'Enable CharJS'}
            disabled={busy}
            onclick={() => handleUpdate({ enabled: !item.enabled })}
        >
            {#if item.enabled}
                <Eye class="size-4" />
            {:else}
                <EyeOff class="size-4" />
            {/if}
        </Button>
        <Button
            size="icon"
            variant="ghost"
            class="size-8 shrink-0 text-muted-foreground hover:text-destructive"
            title="Delete CharJS entry"
            aria-label="Delete CharJS entry"
            disabled={busy}
            onclick={handleDelete}
        >
            <Trash2 class="size-4" />
        </Button>
    </div>

    {#if expanded}
        <div class="flex flex-col gap-4 border-t bg-muted/20 p-4">
            <div class="space-y-1.5">
                <Label class="text-xs">Code</Label>
                <Textarea
                    disabled={busy}
                    class="min-h-48 resize-y bg-background font-mono text-sm leading-relaxed"
                    value={item.code}
                    placeholder="// Write CharJS behavior here..."
                    onchange={(e) => handleUpdate({ code: e.currentTarget.value })}
                />
            </div>
        </div>
    {/if}
</div>
