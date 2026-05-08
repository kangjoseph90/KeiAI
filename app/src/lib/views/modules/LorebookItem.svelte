<script lang="ts">
    import type { Lorebook } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Textarea } from '$lib/components/ui/textarea';
    import { Badge } from '$lib/components/ui/badge';
    import { Label } from '$lib/components/ui/label';
    import { Check, Pencil, Trash2, X } from 'lucide-svelte';

    let {
        item,
        onUpdate,
        onDelete
    }: {
        item: Lorebook;
        onUpdate: (id: string, changes: DeepPartial<Lorebook>) => Promise<void>;
        onDelete: (id: string) => Promise<void>;
    } = $props();

    let editing = $state(false);
    let editName = $state('');
    let editKeys = $state<string[]>([]);
    let editContent = $state('');
    let editDepth = $state(0);
    let editRegex = $state('');
    let editProbability = $state(100);
    let editEnabled = $state(false);

    function startEdit() {
        editName = item.name;
        editKeys = item.keys;
        editContent = item.content;
        editDepth = item.insertionDepth;
        editRegex = item.regex ?? '';
        editProbability = item.probability ?? 100;
        editEnabled = item.enabled;
        editing = true;
    }

    async function handleSave() {
        if (!editName.trim()) return;
        await onUpdate(item.id, {
            name: editName,
            keys: editKeys,
            content: editContent,
            insertionDepth: editDepth,
            enabled: editEnabled,
            regex: editRegex || undefined,
            probability: editProbability
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
                    <Label class="text-xs">Keys (comma-separated)</Label>
                    <Input
                        class="text-sm"
                        value={editKeys.join(', ')}
                        oninput={(e) => {
                            editKeys = (e.target as HTMLInputElement).value
                                .split(',')
                                .map((k) => k.trim())
                                .filter(Boolean);
                        }}
                    />
                </div>
            </div>
            <div class="space-y-1">
                <Label class="text-xs">Content</Label>
                <Textarea class="text-sm" bind:value={editContent} rows={3} />
            </div>
            <div class="grid gap-2 sm:grid-cols-3">
                <div class="space-y-1">
                    <Label class="text-xs">Insertion Depth</Label>
                    <Input class="text-sm" type="number" bind:value={editDepth} />
                </div>
                <div class="space-y-1">
                    <Label class="text-xs">Regex</Label>
                    <Input class="text-sm" bind:value={editRegex} />
                </div>
                <div class="space-y-1">
                    <Label class="text-xs">Probability</Label>
                    <Input
                        class="text-sm"
                        type="number"
                        min="0"
                        max="100"
                        bind:value={editProbability}
                    />
                </div>
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
            <div class="min-w-0">
                <div class="flex items-center gap-2">
                    <span class="text-sm font-medium">{item.name || 'Unnamed'}</span>
                    {#if !item.enabled}
                        <Badge variant="outline" class="text-xs">Disabled</Badge>
                    {/if}
                </div>
                <div class="flex flex-wrap gap-1 mt-1">
                    {#each item.keys as key (key)}
                        <Badge variant="secondary" class="text-xs">{key}</Badge>
                    {/each}
                </div>
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
