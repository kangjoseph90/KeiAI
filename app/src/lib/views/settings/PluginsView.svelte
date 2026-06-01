<script lang="ts">
    import {
        plugins,
        createPlugin,
        updatePlugin,
        deletePlugin,
        appSettings,
        createGlobalFolder,
        updateGlobalFolder,
        deleteGlobalFolder,
        moveGlobalItem
    } from '$lib/stores';
    import type { Plugin, PluginFields } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';
    import { navigate } from '$lib/router';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Textarea } from '$lib/components/ui/textarea';
    import { Card, CardContent } from '$lib/components/ui/card';
    import { Badge } from '$lib/components/ui/badge';
    import { Label } from '$lib/components/ui/label';
    import { ArrowLeft, Check, Pencil, Plus, Trash2, X, Play, Square } from 'lucide-svelte';
    import { pluginManager } from '$lib/plugins';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';

    let { pluginId }: { pluginId?: string } = $props();

    let newName = $state('');
    let editName = $state('');
    let editDescription = $state('');
    let editVersion = $state('');
    let editCode = $state('');
    let editEnabled = $state(false);
    let editArgs = $state<[string, string][]>([]);
    let loadedPluginId = $state<string | null>(null);

    let loadedPluginIds = $state<string[]>(
        pluginManager.getInstances().map((inst) => inst.pluginId)
    );

    async function handleLoad(id: string) {
        await pluginManager.loadPlugin(id);
        loadedPluginIds = pluginManager.getInstances().map((inst) => inst.pluginId);
    }

    async function handleUnload(id: string) {
        await pluginManager.unloadPlugin(id);
        loadedPluginIds = pluginManager.getInstances().map((inst) => inst.pluginId);
    }

    const selectedPlugin = $derived(
        pluginId ? ($plugins.find((plugin) => plugin.id === pluginId) ?? null) : null
    );

    $effect(() => {
        const plugin = selectedPlugin;
        if (!plugin || loadedPluginId === plugin.id) return;
        loadEditor(plugin);
    });

    function loadEditor(plugin: Plugin) {
        loadedPluginId = plugin.id;
        editName = plugin.name;
        editDescription = plugin.description;
        editVersion = plugin.version;
        editCode = plugin.code;
        editEnabled = plugin.enabled;
        editArgs = Object.entries(plugin.args).map(([key, value]) => [key, String(value)]);
    }

    async function handleCreate() {
        const name = newName.trim();
        if (!name) return;
        const plugin = await createPlugin({
            name,
            description: '',
            version: '0.0.1',
            enabled: true,
            code: '',
            args: {}
        });
        newName = '';
        navigate({ view: 'settings', pluginId: plugin.id });
    }

    async function handleSave(id: string) {
        if (!editName.trim()) return;
        const args: Record<string, unknown> = {};
        for (const [key, value] of editArgs) {
            const trimmed = key.trim();
            if (trimmed) args[trimmed] = value;
        }
        const changes: DeepPartial<PluginFields> = {
            name: editName,
            description: editDescription,
            version: editVersion,
            code: editCode,
            enabled: editEnabled,
            args
        };
        await updatePlugin(id, changes);
        navigate({ view: 'settings' });
    }

    async function handleDelete(id: string) {
        await deletePlugin(id);
        navigate({ view: 'settings' });
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

{#if selectedPlugin}
    <div class="flex min-h-[70vh] flex-col gap-5">
        <div class="flex items-center justify-between gap-3">
            <div class="flex min-w-0 items-center gap-3">
                <Button variant="ghost" size="icon" onclick={() => navigate({ view: 'settings' })}>
                    <ArrowLeft class="size-4" />
                </Button>
                <div class="min-w-0">
                    <h2 class="truncate text-xl font-semibold">{selectedPlugin.name}</h2>
                    <p class="text-xs text-muted-foreground">Plugin editor</p>
                </div>
            </div>
            <div class="flex gap-2">
                <Button
                    variant="destructive"
                    class="gap-1.5"
                    onclick={() => handleDelete(selectedPlugin.id)}
                >
                    <Trash2 class="size-4" /> Delete
                </Button>
                <Button class="gap-1.5" onclick={() => handleSave(selectedPlugin.id)}>
                    <Check class="size-4" /> Save
                </Button>
            </div>
        </div>

        <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div class="space-y-4">
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
                    <Textarea bind:value={editDescription} rows={3} />
                </div>
                <div class="space-y-1">
                    <Label>Code</Label>
                    <Textarea class="min-h-[360px] font-mono text-sm" bind:value={editCode} />
                </div>
            </div>

            <aside class="space-y-4">
                <Card>
                    <CardContent class="space-y-3 p-4">
                        <label class="flex items-center justify-between gap-3 text-sm">
                            <span>Enabled</span>
                            <input type="checkbox" bind:checked={editEnabled} />
                        </label>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent class="space-y-3 p-4">
                        <div class="flex items-center justify-between">
                            <Label>Args</Label>
                            <Button
                                size="sm"
                                variant="outline"
                                class="h-7 gap-1 text-xs"
                                onclick={addArgEntry}
                            >
                                <Plus class="size-3" /> Add
                            </Button>
                        </div>
                        {#each editArgs as entry, i (i)}
                            <div class="grid gap-1.5">
                                <div class="flex gap-1.5">
                                    <Input
                                        class="h-8 text-xs"
                                        placeholder="key"
                                        value={entry[0]}
                                        oninput={(e) =>
                                            updateArgKey(i, (e.target as HTMLInputElement).value)}
                                    />
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        class="size-8 shrink-0"
                                        onclick={() => removeArgEntry(i)}
                                    >
                                        <X class="size-3" />
                                    </Button>
                                </div>
                                <Input
                                    class="h-8 text-xs"
                                    placeholder="value"
                                    value={entry[1]}
                                    oninput={(e) =>
                                        updateArgValue(i, (e.target as HTMLInputElement).value)}
                                />
                            </div>
                        {:else}
                            <p class="text-xs text-muted-foreground">No args.</p>
                        {/each}
                    </CardContent>
                </Card>
            </aside>
        </div>
    </div>
{:else if pluginId}
    <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <p class="text-sm text-muted-foreground">Plugin not found.</p>
        <Button variant="outline" onclick={() => navigate({ view: 'settings' })}>Back</Button>
    </div>
{:else if $appSettings}
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

        <EntityList
            entities={$plugins}
            config={$appSettings.plugins}
            layout="list"
            onCreateFolder={(name, parentId, sortOrder) =>
                createGlobalFolder('plugins', name, parentId, sortOrder)}
            onUpdateFolder={(id, changes) => updateGlobalFolder('plugins', id, changes)}
            onDeleteFolder={(id) => deleteGlobalFolder('plugins', id)}
            onMoveItem={(itemId, newFolderId, newSortOrder) =>
                moveGlobalItem('plugins', itemId, newFolderId, newSortOrder)}
        >
            {#snippet empty()}
                <div class="flex flex-col items-center justify-center gap-2 py-12 text-center">
                    <p class="text-sm text-muted-foreground">No plugins installed.</p>
                </div>
            {/snippet}
            {#snippet item({ entity: plugin })}
                <Card>
                    <CardContent class="flex items-center justify-between gap-3 p-4">
                        <button
                            class="min-w-0 flex-1 text-left"
                            onclick={() => navigate({ view: 'settings', pluginId: plugin.id })}
                        >
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
                                <p class="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
                                    {plugin.description}
                                </p>
                            {/if}
                        </button>
                        <div class="flex shrink-0 gap-1.5 items-center">
                            {#if loadedPluginIds.includes(plugin.id)}
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    class="h-9 gap-1 text-xs"
                                    onclick={() => handleUnload(plugin.id)}
                                >
                                    <Square class="size-3.5 fill-current" /> Unload
                                </Button>
                            {:else}
                                <Button
                                    size="sm"
                                    variant="default"
                                    class="h-9 gap-1 text-xs"
                                    onclick={() => handleLoad(plugin.id)}
                                >
                                    <Play class="size-3.5 fill-current" /> Load
                                </Button>
                            {/if}
                            <Button
                                size="sm"
                                variant="outline"
                                onclick={() => navigate({ view: 'settings', pluginId: plugin.id })}
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
                    </CardContent>
                </Card>
            {/snippet}
        </EntityList>
    </div>
{/if}
