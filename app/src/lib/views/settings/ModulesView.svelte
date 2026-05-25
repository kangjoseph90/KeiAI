<script lang="ts">
    import {
        modules,
        createModule,
        deleteModule,
        appSettings,
        setModuleEnabled,
        createGlobalFolder,
        updateGlobalFolder,
        deleteGlobalFolder,
        moveGlobalItem
    } from '$lib/stores';
    import { navigate } from '$lib/router';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Card, CardContent } from '$lib/components/ui/card';
    import { Badge } from '$lib/components/ui/badge';
    import { Download, Pencil, Plus, Trash2, Upload } from 'lucide-svelte';
    import ModuleCard from '../modules/ModuleCard.svelte';
    import { exportModuleFile, importModuleFile } from '$lib/managers/module';
    import type { ModuleFileExport } from '$lib/porters/module';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';

    let { moduleId }: { moduleId?: string } = $props();

    let newName = $state('');
    let importInput = $state<HTMLInputElement>();
    let exportFormat = $state<'risum' | 'keimodule'>('risum');

    const selectedModule = $derived(
        moduleId ? ($modules.find((mod) => mod.id === moduleId) ?? null) : null
    );

    async function handleCreate() {
        const name = newName.trim();
        if (!name) return;
        const mod = await createModule({ name, description: '' });
        newName = '';
        navigate({ view: 'settings', moduleId: mod.id });
    }

    async function handleImport(event: Event) {
        const target = event.target as HTMLInputElement;
        const file = target.files?.[0];
        if (!file) return;
        const mod = await importModuleFile(file, { select: true });
        target.value = '';
        navigate({ view: 'settings', moduleId: mod.id });
    }

    function moduleExportRequest(): ModuleFileExport {
        if (exportFormat === 'keimodule') return { kind: 'keimodule' };
        return { kind: 'risu', format: exportFormat };
    }
</script>

{#if selectedModule}
    <ModuleCard mod={selectedModule} />
{:else if moduleId}
    <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <p class="text-sm text-muted-foreground">Module not found.</p>
        <Button variant="outline" onclick={() => navigate({ view: 'settings' })}>Back</Button>
    </div>
{:else if $appSettings}
    <div class="flex flex-col gap-4">
        <div class="flex gap-2">
            <Input
                bind:value={newName}
                placeholder="New module name"
                class="flex-1"
                onkeydown={(e) => e.key === 'Enter' && handleCreate()}
            />
            <Button class="gap-1.5" onclick={handleCreate}>
                <Plus class="size-4" /> Create
            </Button>
            <Button variant="outline" class="gap-1.5" onclick={() => importInput?.click()}>
                <Upload class="size-4" /> Import
            </Button>
            <input
                bind:this={importInput}
                type="file"
                accept=".risum,.keimodule,.json"
                class="hidden"
                onchange={handleImport}
            />
        </div>

        <EntityList
            entities={$modules}
            config={$appSettings.modules}
            layout="list"
            onCreateFolder={(name, parentId) => createGlobalFolder('modules', name, parentId)}
            onUpdateFolder={(id, changes) => updateGlobalFolder('modules', id, changes)}
            onDeleteFolder={(id) => deleteGlobalFolder('modules', id)}
            onMoveItem={(itemId, newFolderId, newSortOrder) =>
                moveGlobalItem('modules', itemId, newFolderId, newSortOrder)}
        >
            {#snippet empty()}
                <div class="flex flex-col items-center justify-center gap-2 py-12 text-center">
                    <p class="text-sm text-muted-foreground">No modules created yet.</p>
                </div>
            {/snippet}
            {#snippet item({ entity: mod })}
                {@const enabled = $appSettings?.modules.refs[mod.id]?.enabled ?? true}
                <Card>
                    <CardContent class="flex items-center justify-between gap-3 p-4">
                        <button
                            class="min-w-0 flex-1 text-left"
                            onclick={() => navigate({ view: 'settings', moduleId: mod.id })}
                        >
                            <div class="flex items-center gap-2">
                                <p class="font-medium">{mod.name || 'Unnamed'}</p>
                                {#if !enabled}
                                    <Badge variant="outline" class="text-xs">Disabled</Badge>
                                {/if}
                            </div>
                            {#if mod.description}
                                <p class="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
                                    {mod.description}
                                </p>
                            {/if}
                        </button>
                        <div class="flex shrink-0 items-center gap-1">
                            <label class="flex items-center gap-1.5 text-sm">
                                <input
                                    type="checkbox"
                                    checked={enabled}
                                    onchange={() => setModuleEnabled(mod.id, !enabled)}
                                />
                            </label>
                            <Button
                                size="sm"
                                variant="outline"
                                onclick={() => navigate({ view: 'settings', moduleId: mod.id })}
                            >
                                <Pencil class="size-4" />
                            </Button>
                            <select
                                bind:value={exportFormat}
                                class="h-8 rounded-md border bg-background px-2 text-xs"
                                aria-label="Module export format"
                            >
                                <option value="risum">Risu .risum</option>
                                <option value="keimodule">Kei .keimodule</option>
                            </select>
                            <Button
                                size="sm"
                                variant="outline"
                                onclick={() => exportModuleFile(mod.id, moduleExportRequest())}
                            >
                                <Download class="size-4" />
                            </Button>
                            <Button
                                size="sm"
                                variant="destructive"
                                onclick={() => deleteModule(mod.id)}
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
