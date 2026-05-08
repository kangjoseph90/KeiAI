<script lang="ts">
    import type { CharJS } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Textarea } from '$lib/components/ui/textarea';
    import { Badge } from '$lib/components/ui/badge';
    import { Label } from '$lib/components/ui/label';
    import { Check, Pencil, Trash2 } from 'lucide-svelte';

    let {
        item,
        onUpdate,
        onDelete
    }: {
        item: CharJS;
        onUpdate: (id: string, changes: DeepPartial<CharJS>) => void | Promise<void>;
        onDelete: (id: string) => void | Promise<void>;
    } = $props();

    let editing = $state(false);
    let editName = $state('');
    let editCode = $state('');
    let editEnabled = $state(false);

    function startEdit() {
        editName = item.name;
        editCode = item.code;
        editEnabled = item.enabled;
        editing = true;
    }

    async function handleSave() {
        if (!editName.trim()) return;
        await onUpdate(item.id, {
            name: editName,
            code: editCode,
            enabled: editEnabled
        });
        editing = false;
    }
</script>

<div class="rounded-md border p-3">
    {#if editing}
        <div class="flex flex-col gap-2">
            <div class="space-y-1">
                <Label class="text-xs">Name</Label>
                <Input class="text-sm" bind:value={editName} />
            </div>
            <div class="space-y-1">
                <Label class="text-xs">Code</Label>
                <Textarea class="text-sm font-mono" bind:value={editCode} rows={6} />
            </div>
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
