<script lang="ts">
    import type { Script } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Textarea } from '$lib/components/ui/textarea';
    import { Badge } from '$lib/components/ui/badge';
    import { Label } from '$lib/components/ui/label';
    import {
        ChevronDown,
        ChevronRight,
        ChevronUp,
        Eye,
        EyeOff,
        GripVertical,
        Trash2
    } from 'lucide-svelte';
    import { appConfirm, toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';

    let {
        item,
        initiallyEditing = false,
        onUpdate,
        onDelete
    }: {
        item: Script;
        initiallyEditing?: boolean;
        onUpdate: (id: string, changes: DeepPartial<Script>) => void | Promise<void>;
        onDelete: (id: string) => void | Promise<void>;
    } = $props();

    let expanded = $state(false);
    let advancedOpen = $state(false);
    let openedInitially = $state(false);
    let busy = $state(false);

    const PHASE_OPTIONS: Script['phase'][] = ['input', 'request', 'output', 'display'];

    $effect(() => {
        if (initiallyEditing && !openedInitially) {
            openedInitially = true;
            expanded = true;
        }
    });

    async function handleUpdate(changes: DeepPartial<Script>): Promise<void> {
        if (busy) return;
        busy = true;
        try {
            await onUpdate(item.id, changes);
        } catch (error) {
            toast.error({ title: 'Script update failed', description: getErrorMessage(error) });
        } finally {
            busy = false;
        }
    }

    async function handleDelete(): Promise<void> {
        if (busy) return;
        busy = true;
        try {
            const confirmed = await appConfirm({
                title: 'Delete script?',
                description: `Delete "${item.name}"?`,
                confirmText: 'Delete',
                variant: 'destructive'
            });
            if (!confirmed) return;
            await onDelete(item.id);
        } catch (error) {
            toast.error({ title: 'Could not delete script', description: getErrorMessage(error) });
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
            aria-label={expanded ? 'Collapse script' : 'Expand script'}
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
            aria-label="Script name"
            class="h-8 min-w-0 flex-1 border-0 bg-transparent px-1 font-medium shadow-none focus-visible:ring-0 text-sm leading-relaxed"
            onchange={(e) => handleUpdate({ name: e.currentTarget.value })}
        />

        <Badge variant="secondary" class="text-xs shrink-0">{item.phase}</Badge>

        <Button
            size="icon"
            variant="ghost"
            class="size-8 shrink-0 text-muted-foreground"
            title={item.enabled ? 'Disable script' : 'Enable script'}
            aria-label={item.enabled ? 'Disable script' : 'Enable script'}
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
            title="Delete script"
            aria-label="Delete script"
            disabled={busy}
            onclick={handleDelete}
        >
            <Trash2 class="size-4" />
        </Button>
    </div>

    {#if expanded}
        <div class="flex flex-col gap-4 border-t bg-muted/20 p-4">
            <div class="space-y-1.5">
                <Label class="text-xs">Phase</Label>
                <div class="flex flex-wrap gap-1">
                    {#each PHASE_OPTIONS as phase (phase)}
                        <button
                            class="px-2.5 py-1 text-xs rounded-md border transition-colors {item.phase ===
                            phase
                                ? 'bg-secondary text-secondary-foreground font-medium border-secondary shadow-sm'
                                : 'hover:bg-accent hover:text-accent-foreground border-input bg-background'}"
                            disabled={busy}
                            onclick={() => handleUpdate({ phase })}
                        >
                            {phase}
                        </button>
                    {/each}
                </div>
            </div>

            <div class="space-y-1.5">
                <Label class="text-xs">Regex</Label>
                <Input
                    disabled={busy}
                    class="bg-background text-sm font-mono leading-relaxed"
                    value={item.regex}
                    onchange={(e) => handleUpdate({ regex: e.currentTarget.value })}
                />
            </div>
            <div class="space-y-1.5">
                <Label class="text-xs">Replacement</Label>
                <Textarea
                    disabled={busy}
                    class="bg-background text-sm font-mono leading-relaxed min-h-[100px]"
                    value={item.replacement}
                    onchange={(e) => handleUpdate({ replacement: e.currentTarget.value })}
                />
            </div>

            <div class="space-y-1.5">
                <Button
                    variant="ghost"
                    size="sm"
                    class="w-full justify-between h-8 text-xs text-muted-foreground hover:bg-muted/50"
                    onclick={() => (advancedOpen = !advancedOpen)}
                >
                    Advanced Settings
                    {#if advancedOpen}
                        <ChevronUp class="size-3" />
                    {:else}
                        <ChevronDown class="size-3" />
                    {/if}
                </Button>

                {#if advancedOpen}
                    <div class="grid gap-4 p-4 rounded-lg bg-muted/30 border sm:grid-cols-3">
                        <div class="space-y-1.5">
                            <Label class="text-xs">Flag</Label>
                            <Input
                                disabled={busy}
                                class="bg-background text-sm font-mono"
                                value={item.flag}
                                onchange={(e) => handleUpdate({ flag: e.currentTarget.value })}
                            />
                        </div>
                        <div class="space-y-1.5">
                            <Label class="text-xs">Order</Label>
                            <Input
                                disabled={busy}
                                class="bg-background text-sm"
                                type="number"
                                value={item.order}
                                onchange={(e) =>
                                    handleUpdate({
                                        order: parseInt(e.currentTarget.value) || 0
                                    })}
                            />
                        </div>
                        <div class="space-y-1.5">
                            <Label class="text-xs">Repeat</Label>
                            <Input
                                disabled={busy}
                                class="bg-background text-sm"
                                type="number"
                                value={item.repeat}
                                onchange={(e) =>
                                    handleUpdate({
                                        repeat: parseInt(e.currentTarget.value) || 0
                                    })}
                            />
                        </div>
                    </div>
                {/if}
            </div>
        </div>
    {/if}
</div>
