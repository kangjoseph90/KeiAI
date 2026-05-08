<script lang="ts">
    import type { Script } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Badge } from '$lib/components/ui/badge';
    import { Label } from '$lib/components/ui/label';
    import { Check, Pencil, Trash2 } from 'lucide-svelte';

    let {
        item,
        onUpdate,
        onDelete
    }: {
        item: Script;
        onUpdate: (id: string, changes: DeepPartial<Script>) => void | Promise<void>;
        onDelete: (id: string) => void | Promise<void>;
    } = $props();

    let editing = $state(false);
    let editName = $state('');
    let editPhase = $state<Script['phase']>('output');
    let editRegex = $state('');
    let editReplacement = $state('');
    let editFlag = $state('');
    let editOrder = $state(0);
    let editRepeat = $state(0);
    let editAdvanced = $state(false);
    let editEnabled = $state(false);

    const PHASE_OPTIONS: Script['phase'][] = ['input', 'request', 'output', 'display'];

    function startEdit() {
        editName = item.name;
        editPhase = item.phase;
        editRegex = item.regex;
        editReplacement = item.replacement;
        editFlag = item.flag;
        editOrder = item.order;
        editRepeat = item.repeat;
        editAdvanced = item.advanced;
        editEnabled = item.enabled;
        editing = true;
    }

    async function handleSave() {
        if (!editName.trim()) return;
        await onUpdate(item.id, {
            name: editName,
            regex: editRegex,
            replacement: editReplacement,
            phase: editPhase,
            advanced: editAdvanced,
            flag: editFlag,
            order: editOrder,
            repeat: editRepeat,
            enabled: editEnabled
        });
        editing = false;
    }
</script>

<div class="rounded-md border p-3">
    {#if editing}
        <div class="flex flex-col gap-2">
            <div class="grid gap-2 sm:grid-cols-2">
                <div class="space-y-1">
                    <Label class="text-xs">Name</Label>
                    <Input class="text-sm" bind:value={editName} />
                </div>
                <div class="space-y-1">
                    <Label class="text-xs">Phase</Label>
                    <div class="flex gap-1">
                        {#each PHASE_OPTIONS as phase (phase)}
                            <button
                                class="px-2 py-1 text-xs rounded border {editPhase === phase
                                    ? 'bg-secondary'
                                    : 'hover:bg-accent'}"
                                onclick={() => (editPhase = phase)}
                            >
                                {phase}
                            </button>
                        {/each}
                    </div>
                </div>
            </div>
            <div class="grid gap-2 sm:grid-cols-2">
                <div class="space-y-1">
                    <Label class="text-xs">Regex</Label>
                    <Input class="text-sm" bind:value={editRegex} />
                </div>
                <div class="space-y-1">
                    <Label class="text-xs">Replacement</Label>
                    <Input class="text-sm" bind:value={editReplacement} />
                </div>
            </div>
            <div class="grid gap-2 sm:grid-cols-3">
                <div class="space-y-1">
                    <Label class="text-xs">Flag</Label>
                    <Input class="text-sm" bind:value={editFlag} />
                </div>
                <div class="space-y-1">
                    <Label class="text-xs">Order</Label>
                    <Input class="text-sm" type="number" bind:value={editOrder} />
                </div>
                <div class="space-y-1">
                    <Label class="text-xs">Repeat</Label>
                    <Input class="text-sm" type="number" bind:value={editRepeat} />
                </div>
            </div>
            <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" bind:checked={editAdvanced} />
                Advanced
            </label>
            <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" bind:checked={editEnabled} />
                Enabled
            </label>
            <div class="flex gap-2">
                <Button size="sm" class="gap-1" onclick={handleSave}>
                    <Check class="size-3" /> Save
                </Button>
                <Button size="sm" variant="outline" onclick={() => (editing = false)}>
                    Cancel
                </Button>
            </div>
        </div>
    {:else}
        <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
                <span class="text-sm font-medium">{item.name || 'Unnamed'}</span>
                <Badge variant="secondary" class="text-xs">{item.phase}</Badge>
                {#if !item.enabled}
                    <Badge variant="outline" class="text-xs">Disabled</Badge>
                {/if}
            </div>
            <div class="flex gap-1 shrink-0">
                <Button size="sm" variant="outline" class="h-7 w-7 p-0" onclick={startEdit}>
                    <Pencil class="size-3" />
                </Button>
                <Button
                    size="sm"
                    variant="destructive"
                    class="h-7 w-7 p-0"
                    onclick={() => onDelete(item.id)}
                >
                    <Trash2 class="size-3" />
                </Button>
            </div>
        </div>
    {/if}
</div>
