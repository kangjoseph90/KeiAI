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
        Plus,
        GripVertical
    } from 'lucide-svelte';
    import { pluginManager } from '$lib/plugins';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
    import EditableListItem from '$lib/components/entitylist/EditableListItem.svelte';
    import EmptyListPlaceholder from '$lib/components/EmptyListPlaceholder.svelte';
    import ListActionBar from '$lib/components/ListActionBar.svelte';
    import KeyValueEditor from '$lib/components/KeyValueEditor.svelte';
    import { appConfirm, toast } from '$lib/ui';
    import { AppError, getErrorMessage } from '$lib/types/errors';

    let expandedPluginIds = $state<Record<string, boolean>>({});
    let busyAction = $state<string | null>(null);

    let loadedPluginIds = $state<string[]>(
        pluginManager.getInstances().map((inst) => inst.pluginId)
    );

    function toggleExpanded(id: string) {
        expandedPluginIds[id] = !expandedPluginIds[id];
    }

    function refreshLoadedPlugins(): void {
        loadedPluginIds = pluginManager.getInstances().map((inst) => inst.pluginId);
    }

    function isPluginLoaded(id: string): boolean {
        return pluginManager.getInstances().some((instance) => instance.pluginId === id);
    }

    async function restorePluginRuntime(
        id: string,
        originalError: unknown,
        failureMessage: string
    ): Promise<never> {
        try {
            await pluginManager.loadPlugin(id);
        } catch (recoveryError) {
            throw new AppError('INVALID_INPUT', failureMessage, {
                originalError,
                recoveryError
            });
        }
        throw originalError;
    }

    async function handleLoad(id: string) {
        if (busyAction) return;
        busyAction = `load:${id}`;
        try {
            await pluginManager.loadPlugin(id);
        } catch (error) {
            toast.error({ title: 'Plugin load failed', description: getErrorMessage(error) });
        } finally {
            refreshLoadedPlugins();
            busyAction = null;
        }
    }

    async function handleUnload(id: string) {
        if (busyAction) return;
        busyAction = `unload:${id}`;
        try {
            await pluginManager.unloadPlugin(id);
        } catch (error) {
            toast.error({ title: 'Plugin unload failed', description: getErrorMessage(error) });
        } finally {
            refreshLoadedPlugins();
            busyAction = null;
        }
    }

    async function handleCreate() {
        if (busyAction) return;
        busyAction = 'create';
        try {
            const plugin = await createPlugin();
            expandedPluginIds[plugin.id] = true;
        } catch (error) {
            toast.error({ title: 'Could not add plugin', description: getErrorMessage(error) });
        } finally {
            busyAction = null;
        }
    }

    async function handleDelete(plugin: Plugin) {
        if (busyAction) return;
        busyAction = `delete:${plugin.id}`;
        const wasLoaded = isPluginLoaded(plugin.id);
        try {
            const confirmed = await appConfirm({
                title: 'Delete plugin?',
                description: `Delete "${plugin.name}" and its local configuration?`,
                confirmText: 'Delete',
                variant: 'destructive'
            });
            if (!confirmed) return;
            if (wasLoaded) await pluginManager.unloadPlugin(plugin.id);
            try {
                await deletePlugin(plugin.id);
            } catch (error) {
                if (wasLoaded) {
                    await restorePluginRuntime(
                        plugin.id,
                        error,
                        'Plugin deletion failed and the previous runtime could not be restored'
                    );
                }
                throw error;
            }
        } catch (error) {
            toast.error({ title: 'Could not delete plugin', description: getErrorMessage(error) });
        } finally {
            refreshLoadedPlugins();
            busyAction = null;
        }
    }

    async function handleToggleEnabled(plugin: Plugin) {
        if (busyAction) return;
        busyAction = `toggle:${plugin.id}`;
        const disablingLoaded = plugin.enabled && isPluginLoaded(plugin.id);
        try {
            if (disablingLoaded) await pluginManager.unloadPlugin(plugin.id);
            try {
                await updatePlugin(plugin.id, { enabled: !plugin.enabled });
            } catch (error) {
                if (disablingLoaded) {
                    await restorePluginRuntime(
                        plugin.id,
                        error,
                        'Plugin update failed and the previous runtime could not be restored'
                    );
                }
                throw error;
            }
        } catch (error) {
            toast.error({
                title: 'Plugin state change failed',
                description: getErrorMessage(error)
            });
        } finally {
            refreshLoadedPlugins();
            busyAction = null;
        }
    }

    async function updatePluginSafely(
        pluginId: string,
        changes: Parameters<typeof updatePlugin>[1]
    ): Promise<void> {
        try {
            await updatePlugin(pluginId, changes);
        } catch (error) {
            toast.error({ title: 'Plugin update failed', description: getErrorMessage(error) });
        }
    }

    async function handleUpdateArgValue(plugin: Plugin, key: string, value: string) {
        const newArgs = { ...plugin.args, [key]: value };
        await updatePluginSafely(plugin.id, { args: newArgs });
    }

    async function handleAddArg(plugin: Plugin, key: string, value: string) {
        const newArgs = { ...plugin.args, [key]: value };
        await updatePluginSafely(plugin.id, { args: newArgs });
    }

    async function handleRemoveArg(plugin: Plugin, keyToRemove: string) {
        await updatePluginSafely(plugin.id, {
            args: {
                [keyToRemove]: undefined
            }
        });
    }
</script>

{#if $appSettings}
    <div class="flex flex-col gap-4 px-2">
        <ListActionBar description="Extend KeiAI with custom behavior.">
            <Button
                size="sm"
                class="gap-1.5"
                disabled={busyAction !== null}
                aria-busy={busyAction === 'create'}
                onclick={handleCreate}
            >
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
                <EditableListItem
                    expanded={expandedPluginIds[plugin.id]}
                    muted={!plugin.enabled}
                    busy={busyAction !== null}
                >
                    {#snippet header()}
                        <!-- 헤더 영역 -->
                        <div
                            class="flex h-7 w-4 shrink-0 cursor-grab active:cursor-grabbing select-none items-center justify-center text-muted-foreground/45 transition-colors hover:text-muted-foreground"
                            aria-hidden="true"
                        >
                            <GripVertical class="size-3.5" />
                        </div>
                        <button
                            type="button"
                            class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onclick={() => toggleExpanded(plugin.id)}
                            aria-label={expandedPluginIds[plugin.id]
                                ? 'Collapse plugin'
                                : 'Expand plugin'}
                        >
                            {#if expandedPluginIds[plugin.id]}
                                <ChevronDown class="size-3.5" />
                            {:else}
                                <ChevronRight class="size-3.5" />
                            {/if}
                        </button>

                        <Input
                            value={plugin.name}
                            disabled={busyAction !== null}
                            aria-label="Plugin name"
                            class="h-7 min-w-0 flex-1 border-0 bg-transparent px-1 font-medium shadow-none focus-visible:ring-0 text-sm leading-relaxed"
                            onchange={(e) =>
                                updatePluginSafely(plugin.id, { name: e.currentTarget.value })}
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
                            size="icon-sm"
                            variant="ghost"
                            class="shrink-0 text-muted-foreground"
                            title={plugin.enabled ? 'Disable plugin' : 'Enable plugin'}
                            aria-label={plugin.enabled ? 'Disable plugin' : 'Enable plugin'}
                            disabled={busyAction !== null}
                            aria-busy={busyAction === `toggle:${plugin.id}`}
                            onclick={() => handleToggleEnabled(plugin)}
                        >
                            {#if plugin.enabled}
                                <Eye class="size-3.5" />
                            {:else}
                                <EyeOff class="size-3.5" />
                            {/if}
                        </Button>

                        {#if plugin.enabled}
                            {#if loadedPluginIds.includes(plugin.id)}
                                <Button
                                    size="icon-sm"
                                    variant="ghost"
                                    class="shrink-0 text-muted-foreground hover:text-destructive"
                                    title="Unload plug-in"
                                    aria-label="Unload plug-in"
                                    disabled={busyAction !== null}
                                    aria-busy={busyAction === `unload:${plugin.id}`}
                                    onclick={() => handleUnload(plugin.id)}
                                >
                                    <Square class="size-3.5" />
                                </Button>
                            {:else}
                                <Button
                                    size="icon-sm"
                                    variant="ghost"
                                    class="shrink-0 text-muted-foreground hover:text-foreground"
                                    title="Load plug-in"
                                    aria-label="Load plug-in"
                                    disabled={busyAction !== null}
                                    aria-busy={busyAction === `load:${plugin.id}`}
                                    onclick={() => handleLoad(plugin.id)}
                                >
                                    <Play class="size-3.5" />
                                </Button>
                            {/if}
                        {/if}

                        <Button
                            size="icon-sm"
                            variant="ghost"
                            class="shrink-0 text-muted-foreground hover:text-destructive"
                            aria-label="Delete plugin"
                            disabled={busyAction !== null}
                            aria-busy={busyAction === `delete:${plugin.id}`}
                            onclick={() => handleDelete(plugin)}
                        >
                            <Trash2 class="size-3.5" />
                        </Button>
                    {/snippet}

                    <!-- 펼쳐지는 바디 영역 -->
                    {#snippet details()}
                        <div class="flex flex-col gap-3">
                            <!-- 1. Description -->
                            <!-- 1. Description & Version -->
                            <div class="grid gap-3 sm:grid-cols-3">
                                <div class="space-y-1.5 sm:col-span-2">
                                    <Label class="text-xs">Description</Label>
                                    <Input
                                        class="h-8 text-xs bg-background"
                                        placeholder="No description"
                                        value={plugin.description}
                                        disabled={busyAction !== null}
                                        onchange={(e) =>
                                            updatePluginSafely(plugin.id, {
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
                                        disabled={busyAction !== null}
                                        onchange={(e) =>
                                            updatePluginSafely(plugin.id, {
                                                version: e.currentTarget.value
                                            })}
                                    />
                                </div>
                            </div>

                            <!-- 2. Code -->
                            <div class="space-y-1.5">
                                <Label class="text-xs">CharJS Source Code</Label>
                                <Textarea
                                    class="min-h-32 text-xs font-mono bg-background"
                                    placeholder="Code"
                                    value={plugin.code}
                                    disabled={busyAction !== null}
                                    onchange={(e) =>
                                        updatePluginSafely(plugin.id, {
                                            code: e.currentTarget.value
                                        })}
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
                    {/snippet}
                </EditableListItem>
            {/snippet}
        </EntityList>
    </div>
{/if}
