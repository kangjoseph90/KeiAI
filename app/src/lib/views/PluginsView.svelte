<script lang="ts">
    import { plugins, createPlugin, updatePlugin, deletePlugin } from '$lib/stores';
    import type { Plugin, PluginFields } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Textarea } from '$lib/components/ui/textarea';
    import { Card, CardContent } from '$lib/components/ui/card';
    import { Badge } from '$lib/components/ui/badge';
    import { Label } from '$lib/components/ui/label';
    import { Check, ChevronDown, ChevronRight, Pencil, Plus, Trash2, X } from 'lucide-svelte';

    let newName = $state('');
    let editingId = $state<string | null>(null);
    let editName = $state('');
    let editDescription = $state('');
    let editVersion = $state('');
    let editCode = $state('');
    let editEnabled = $state(false);
    let editArgs = $state<[string, string][]>([]);

    function startEdit(plugin: Plugin) {
        editingId = plugin.id;
        editName = plugin.name;
        editDescription = plugin.description;
        editVersion = plugin.version;
        editCode = plugin.code;
        editEnabled = plugin.enabled;
        editArgs = Object.entries(plugin.args).map(([k, v]) => [k, String(v)]);
    }

    function cancelEdit() {
        editingId = null;
        editName = '';
        editDescription = '';
        editVersion = '';
        editCode = '';
        editEnabled = false;
        editArgs = [];
    }

    async function handleCreate() {
        if (!newName.trim()) return;
        await createPlugin({
            name: newName,
            description: '',
            version: '0.0.1',
            enabled: true,
            code: '',
            args: {}
        });
        newName = '';
    }

    async function handleSave(id: string) {
        if (!editName.trim()) return;
        const args: Record<string, unknown> = {};
        for (const [key, value] of editArgs) {
            if (key.trim()) args[key.trim()] = value;
        }
        const changes: DeepPartial<PluginFields> = {
            name: editName,
            description: editDescription,
            version: editVersion,
            code: editCode,
            enabled: editEnabled
        };
        (changes as { args?: Record<string, unknown> }).args = args;
        await updatePlugin(id, changes);
        editingId = null;
    }

    function addArgEntry() {
        editArgs = [...editArgs, ['', '']];
    }

    function removeArgEntry(index: number) {
        editArgs = editArgs.filter((_, i) => i !== index);
    }

    function updateArgKey(index: number, key: string) {
        const updated = [...editArgs];
        updated[index] = [key, updated[index][1]];
        editArgs = updated;
    }

    function updateArgValue(index: number, value: string) {
        const updated = [...editArgs];
        updated[index] = [updated[index][0], value];
        editArgs = updated;
    }
</script>

<div class="flex flex-col gap-4">
    <div class="flex gap-2">
        <Input
            bind:value={newName}
            placeholder="New plugin name"
            class="flex-1"
            onkeydown={(e) => e.key === 'Enter' && handleCreate()}
        />
        <Button class="gap-1.5" onclick={handleCreate}>
            <Plus class="size-4" /> Create
        </Button>
    </div>

    <div class="flex flex-col gap-2">
        {#each $plugins as plugin (plugin.id)}
            <Card>
                <CardContent class="p-4">
                    {#if editingId === plugin.id}
                        <div class="flex flex-col gap-3">
                            <div class="grid gap-3 sm:grid-cols-2">
                                <div class="space-y-1">
                                    <Label>Name</Label>
                                    <Input bind:value={editName} />
                                </div>
                                <div class="space-y-1">
                                    <Label>Version</Label>
                                    <Input bind:value={editVersion} />
                                </div>
                            </div>
                            <div class="space-y-1">
                                <Label>Description</Label>
                                <Textarea bind:value={editDescription} rows={2} />
                            </div>
                            <label class="flex items-center gap-2 text-sm">
                                <input type="checkbox" bind:checked={editEnabled} />
                                Enabled
                            </label>
                            <div class="space-y-1">
                                <Label>Code</Label>
                                <Textarea
                                    class="font-mono text-sm"
                                    bind:value={editCode}
                                    rows={8}
                                    placeholder="// Plugin code here"
                                />
                            </div>
                            <div class="space-y-2">
                                <div class="flex items-center justify-between">
                                    <Label>Args</Label>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        class="gap-1 h-7 text-xs"
                                        onclick={addArgEntry}
                                    >
                                        <Plus class="size-3" /> Add
                                    </Button>
                                </div>
                                {#each editArgs as entry, i (i)}
                                    <div class="flex gap-2">
                                        <Input
                                            class="text-sm"
                                            placeholder="key"
                                            value={entry[0]}
                                            oninput={(e) =>
                                                updateArgKey(
                                                    i,
                                                    (e.target as HTMLInputElement).value
                                                )}
                                        />
                                        <Input
                                            class="text-sm"
                                            placeholder="value"
                                            value={entry[1]}
                                            oninput={(e) =>
                                                updateArgValue(
                                                    i,
                                                    (e.target as HTMLInputElement).value
                                                )}
                                        />
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            class="h-9 w-9 p-0 shrink-0"
                                            onclick={() => removeArgEntry(i)}
                                        >
                                            <X class="size-3" />
                                        </Button>
                                    </div>
                                {/each}
                            </div>
                            <div class="flex gap-2">
                                <Button
                                    size="sm"
                                    class="gap-1.5"
                                    onclick={() => handleSave(plugin.id)}
                                >
                                    <Check class="size-4" /> Save
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    class="gap-1.5"
                                    onclick={cancelEdit}
                                >
                                    <X class="size-4" /> Cancel
                                </Button>
                            </div>
                        </div>
                    {:else}
                        <div class="flex items-center justify-between gap-3">
                            <div class="min-w-0">
                                <div class="flex items-center gap-2">
                                    <p class="font-medium">{plugin.name || 'Unnamed'}</p>
                                    <Badge variant="secondary" class="text-xs font-mono">
                                        v{plugin.version}
                                    </Badge>
                                    {#if !plugin.enabled}
                                        <Badge variant="outline" class="text-xs">Disabled</Badge>
                                    {/if}
                                </div>
                                {#if plugin.description}
                                    <p class="text-sm text-muted-foreground mt-0.5 line-clamp-1">
                                        {plugin.description}
                                    </p>
                                {/if}
                            </div>
                            <div class="flex gap-1 shrink-0">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onclick={() => startEdit(plugin)}
                                >
                                    <Pencil class="size-4" />
                                </Button>
                                <Button
                                    size="sm"
                                    variant="destructive"
                                    onclick={() => deletePlugin(plugin.id)}
                                >
                                    <Trash2 class="size-4" />
                                </Button>
                            </div>
                        </div>
                    {/if}
                </CardContent>
            </Card>
        {:else}
            <p class="text-sm text-muted-foreground">No plugins found.</p>
        {/each}
    </div>
</div>
