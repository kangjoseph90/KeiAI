<script lang="ts">
    import { Download, Trash2, Plus, Upload } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
    import { Separator } from '$lib/components/ui/separator';
    import { Badge } from '$lib/components/ui/badge';
    import {
        presets,
        activePreset,
        selectPreset,
        createPreset,
        deletePreset,
        appSettings,
        createGlobalFolder,
        updateGlobalFolder,
        deleteGlobalFolder,
        moveGlobalItem
    } from '$lib/stores';
    import { exportPresetFile, importPresetFile } from '$lib/managers/preset';
    import type { PresetFileExport } from '$lib/porters/preset';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
    import { createDefaultChatWorkflow } from '$lib/workflow/defaults';

    let newPresetName = $state('');
    let importInput = $state<HTMLInputElement>();

    async function handleCreatePreset() {
        if (!newPresetName.trim()) return;
        const preset = await createPreset({
            name: newPresetName,
            chatWorkflow: createDefaultChatWorkflow()
        });
        await selectPreset(preset.id);
        newPresetName = '';
    }

    async function handleImport(event: Event) {
        const target = event.target as HTMLInputElement;
        const file = target.files?.[0];
        if (!file) return;
        await importPresetFile(file, { select: true });
        target.value = '';
    }
</script>

<Card>
    <CardHeader>
        <CardTitle class="text-base">Preset Management</CardTitle>
    </CardHeader>
    <CardContent class="flex flex-col gap-4">
        <div class="flex gap-2">
            <Input bind:value={newPresetName} placeholder="New preset name..." />
            <Button onclick={handleCreatePreset} class="gap-1.5">
                <Plus class="size-4" /> Create
            </Button>
            <Button variant="outline" class="gap-1.5" onclick={() => importInput?.click()}>
                <Upload class="size-4" /> Import
            </Button>
            <input
                bind:this={importInput}
                type="file"
                accept=".risup,.risupreset,.keipreset,.json"
                class="hidden"
                onchange={handleImport}
            />
        </div>

        <Separator />

        {#if $appSettings}
            <EntityList
                entities={$presets}
                config={$appSettings.presets}
                layout="list"
                onCreateFolder={(name, parentId, sortOrder) =>
                    createGlobalFolder('presets', name, parentId, sortOrder)}
                onUpdateFolder={(id, changes) => updateGlobalFolder('presets', id, changes)}
                onDeleteFolder={(id) => deleteGlobalFolder('presets', id)}
                onMoveItem={(itemId, newFolderId, newSortOrder) =>
                    moveGlobalItem('presets', itemId, newFolderId, newSortOrder)}
            >
                {#snippet empty()}
                    <div class="flex flex-col items-center justify-center gap-2 py-12 text-center">
                        <p class="text-sm text-muted-foreground">No presets created yet.</p>
                    </div>
                {/snippet}
                {#snippet item({ entity: preset })}
                    <div
                        class="flex items-center justify-between p-2 rounded-lg border {$activePreset?.id ===
                        preset.id
                            ? 'border-primary bg-primary/5'
                            : 'hover:bg-muted/50'}"
                    >
                        <div class="flex flex-col">
                            <span class="text-sm font-medium">{preset.name}</span>
                            <span class="text-[10px] text-muted-foreground truncate max-w-[200px]"
                                >{preset.description || 'No description'}</span
                            >
                        </div>
                        <div class="flex items-center gap-2">
                            {#if $activePreset?.id !== preset.id}
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onclick={() => selectPreset(preset.id)}>Use</Button
                                >
                            {:else}
                                <Badge>Active</Badge>
                            {/if}
                            <Button
                                size="sm"
                                variant="outline"
                                class="gap-1"
                                onclick={() => exportPresetFile(preset.id, { kind: 'keipreset' })}
                                title="Export Kei Preset"
                            >
                                <Download class="size-4" />
                                Kei Preset
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                class="h-8 w-8 p-0 text-destructive"
                                onclick={() => deletePreset(preset.id)}
                                aria-label="Delete preset"
                            >
                                <Trash2 class="size-4" />
                            </Button>
                        </div>
                    </div>
                {/snippet}
            </EntityList>
        {/if}
    </CardContent>
</Card>
