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
    import type { Plugin } from '$lib/services';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Textarea } from '$lib/components/ui/textarea';
    import { Badge } from '$lib/components/ui/badge';
    import { Label } from '$lib/components/ui/label';
    import {
        ChevronDown,
        ChevronRight,
        Eye,
        EyeOff,
        Trash2,
        Play,
        Square,
        Plus
    } from 'lucide-svelte';
    import { pluginManager } from '$lib/plugins';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
    import EmptyListPlaceholder from '$lib/components/EmptyListPlaceholder.svelte';
    import ListActionBar from '$lib/components/ListActionBar.svelte';
    import KeyValueEditor from '$lib/components/KeyValueEditor.svelte';

    let expandedPluginIds = $state<Record<string, boolean>>({});

    let loadedPluginIds = $state<string[]>(
        pluginManager.getInstances().map((inst) => inst.pluginId)
    );

    function toggleExpanded(id: string) {
        expandedPluginIds[id] = !expandedPluginIds[id];
    }

    async function handleLoad(id: string) {
        await pluginManager.loadPlugin(id);
        loadedPluginIds = pluginManager.getInstances().map((inst) => inst.pluginId);
    }

    async function handleUnload(id: string) {
        await pluginManager.unloadPlugin(id);
        loadedPluginIds = pluginManager.getInstances().map((inst) => inst.pluginId);
    }

    async function handleCreate() {
        const plugin = await createPlugin();
        expandedPluginIds[plugin.id] = true;
    }

    async function handleUpdateArgValue(plugin: Plugin, key: string, value: string) {
        const newArgs = { ...plugin.args, [key]: value };
        await updatePlugin(plugin.id, { args: newArgs });
    }

    async function handleAddArg(plugin: Plugin, key: string, value: string) {
        const newArgs = { ...plugin.args, [key]: value };
        await updatePlugin(plugin.id, { args: newArgs });
    }

    async function handleRemoveArg(plugin: Plugin, keyToRemove: string) {
        await updatePlugin(plugin.id, {
            args: {
                [keyToRemove]: undefined
            }
        });
    }
</script>

{#if $appSettings}
    <div class="flex flex-col gap-4 px-2">
        <ListActionBar description="Extend KeiAI with custom behavior.">
            <Button size="sm" class="gap-1.5" onclick={handleCreate}>
                <Plus class="size-4" /> Add Plugin
            </Button>
        </ListActionBar>

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
                <EmptyListPlaceholder message="No plugins defined." />
            {/snippet}
            {#snippet item({ entity: plugin })}
                <div
                    class="group overflow-hidden rounded-xl border bg-card shadow-sm transition-[border-color,box-shadow,opacity] hover:border-border/80 hover:shadow-md {plugin.enabled
                        ? ''
                        : 'opacity-55'}"
                >
                    <!-- 헤더 영역 -->
                    <div class="flex min-h-14 items-center gap-2 px-3 py-2">
                        <button
                            type="button"
                            class="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                            onclick={() => toggleExpanded(plugin.id)}
                            aria-label={expandedPluginIds[plugin.id]
                                ? 'Collapse plugin'
                                : 'Expand plugin'}
                        >
                            {#if expandedPluginIds[plugin.id]}
                                <ChevronDown class="size-4" />
                            {:else}
                                <ChevronRight class="size-4" />
                            {/if}
                        </button>

                        <Input
                            value={plugin.name}
                            aria-label="Plugin name"
                            class="h-8 min-w-0 flex-1 border-0 bg-transparent px-1 font-medium shadow-none focus-visible:ring-0 text-sm leading-relaxed"
                            onchange={(e) =>
                                updatePlugin(plugin.id, { name: e.currentTarget.value })}
                        />
                        <!-- Version Badge -->
                        {#if plugin.version && plugin.version.trim() !== ''}
                            <Badge
                                variant="secondary"
                                class="text-[10px] h-5 px-1.5 font-mono shrink-0"
                                >v{plugin.version}</Badge
                            >
                        {/if}
                        <!-- Status Badge -->
                        {#if loadedPluginIds.includes(plugin.id)}
                            <Badge
                                class="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px] h-5 px-1.5 font-semibold shrink-0"
                                >Running</Badge
                            >
                        {/if}

                        <Button
                            size="icon"
                            variant="ghost"
                            class="size-8 shrink-0 text-muted-foreground"
                            title={plugin.enabled ? 'Disable plugin' : 'Enable plugin'}
                            aria-label={plugin.enabled ? 'Disable plugin' : 'Enable plugin'}
                            onclick={() => updatePlugin(plugin.id, { enabled: !plugin.enabled })}
                        >
                            {#if plugin.enabled}
                                <Eye class="size-4" />
                            {:else}
                                <EyeOff class="size-4" />
                            {/if}
                        </Button>

                        {#if plugin.enabled}
                            {#if loadedPluginIds.includes(plugin.id)}
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    class="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                                    title="Unload plug-in"
                                    aria-label="Unload plug-in"
                                    onclick={() => handleUnload(plugin.id)}
                                >
                                    <Square class="size-4" />
                                </Button>
                            {:else}
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    class="size-8 shrink-0 text-muted-foreground hover:text-foreground"
                                    title="Load plug-in"
                                    aria-label="Load plug-in"
                                    onclick={() => handleLoad(plugin.id)}
                                >
                                    <Play class="size-4" />
                                </Button>
                            {/if}
                        {/if}

                        <Button
                            size="icon"
                            variant="ghost"
                            class="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                            aria-label="Delete plugin"
                            onclick={() => deletePlugin(plugin.id)}
                        >
                            <Trash2 class="size-4" />
                        </Button>
                    </div>

                    <!-- 펼쳐지는 바디 영역 -->
                    {#if expandedPluginIds[plugin.id]}
                        <div class="flex flex-col gap-4 border-t bg-muted/20 p-4">
                            <!-- 1. Description -->
                            <!-- 1. Description & Version -->
                            <div class="grid gap-3 sm:grid-cols-3">
                                <div class="space-y-1.5 sm:col-span-2">
                                    <Label class="text-xs">Description</Label>
                                    <Input
                                        class="h-8 text-xs bg-background"
                                        placeholder="No description"
                                        value={plugin.description}
                                        onchange={(e) =>
                                            updatePlugin(plugin.id, {
                                                description: e.currentTarget.value
                                            })}
                                    />
                                </div>
                                <div class="space-y-1.5">
                                    <Label class="text-xs">Version</Label>
                                    <Input
                                        class="h-8 text-xs bg-background"
                                        placeholder="1.0.0"
                                        value={plugin.version}
                                        onchange={(e) =>
                                            updatePlugin(plugin.id, {
                                                version: e.currentTarget.value
                                            })}
                                    />
                                </div>
                            </div>

                            <!-- 2. Code -->
                            <div class="space-y-1.5">
                                <Label class="text-xs">JavaScript Source Code</Label>
                                <Textarea
                                    class="min-h-32 text-xs font-mono bg-background"
                                    placeholder="Code"
                                    value={plugin.code}
                                    onchange={(e) =>
                                        updatePlugin(plugin.id, { code: e.currentTarget.value })}
                                />
                            </div>

                            <div class="space-y-1.5">
                                <Label class="text-xs">Plugin Arguments</Label>
                                <KeyValueEditor
                                    emptyMessage="No arguments defined."
                                    data={plugin.args as Record<string, string>}
                                    onUpdateValue={(key, val) =>
                                        handleUpdateArgValue(plugin, key, val)}
                                    onAdd={(key, val) => handleAddArg(plugin, key, val)}
                                    onRemove={(key) => handleRemoveArg(plugin, key)}
                                />
                            </div>
                        </div>
                    {/if}
                </div>
            {/snippet}
        </EntityList>
    </div>
{/if}
