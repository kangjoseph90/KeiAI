<script lang="ts">
    import {
        Download,
        Trash2,
        Plus,
        Upload,
        ChevronDown,
        ChevronRight,
        Check,
        GripVertical
    } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Badge } from '$lib/components/ui/badge';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import {
        presets,
        activePreset,
        selectPreset,
        createPreset,
        deletePreset,
        updatePreset,
        appSettings,
        createGlobalFolder,
        updateGlobalFolder,
        deleteGlobalFolder,
        moveGlobalItem
    } from '$lib/stores';
    import { exportPresetFile, importPresetFile } from '$lib/managers/preset';
    import type { Preset } from '$lib/services';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
    import EmptyListPlaceholder from '$lib/components/EmptyListPlaceholder.svelte';
    import { createDefaultChatWorkflow } from '$lib/workflow/defaults';
    import ListActionBar from '$lib/components/ListActionBar.svelte';
    import KeyValueEditor from '$lib/components/KeyValueEditor.svelte';

    let expandedPresetIds = $state<Record<string, boolean>>({});

    function toggleExpanded(id: string) {
        expandedPresetIds[id] = !expandedPresetIds[id];
    }

    async function handleCreatePreset() {
        const preset = await createPreset({
            chatWorkflow: createDefaultChatWorkflow()
        });
        await selectPreset(preset.id);
        expandedPresetIds[preset.id] = true;
    }

    async function handleImport() {
        const preset = await importPresetFile({ select: true });
        if (preset) {
            expandedPresetIds[preset.id] = true;
        }
    }

    async function handleAddVariable(preset: Preset, key: string, value: string) {
        const defaultVariables = { ...preset.defaultVariables, [key]: value };
        await updatePreset(preset.id, { defaultVariables });
    }

    async function handleUpdateVariableValue(preset: Preset, key: string, value: string) {
        const defaultVariables = { ...preset.defaultVariables, [key]: value };
        await updatePreset(preset.id, { defaultVariables });
    }

    async function handleRemoveVariable(preset: Preset, keyToRemove: string) {
        await updatePreset(preset.id, {
            defaultVariables: {
                [keyToRemove]: undefined
            }
        });
    }
</script>

<div class="flex flex-col gap-4 px-2">
    <ListActionBar description="Reusable model and chat configurations.">
        <Button size="sm" variant="outline" class="gap-1.5" onclick={handleImport}>
            <Upload class="size-4" /> Import
        </Button>
        <Button size="sm" onclick={handleCreatePreset} class="gap-1.5">
            <Plus class="size-4" /> New Preset
        </Button>
    </ListActionBar>

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
                <EmptyListPlaceholder message="No presets created yet." />
            {/snippet}
            {#snippet item({ entity: preset })}
                <div
                    class="group overflow-hidden rounded-xl border bg-card shadow-sm transition-[border-color,box-shadow,opacity] hover:border-border/80 hover:shadow-md {$activePreset?.id ===
                    preset.id
                        ? 'border-primary/80 ring-1 ring-primary/20'
                        : ''}"
                >
                    <!-- 헤더 영역 -->
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
                            onclick={() => toggleExpanded(preset.id)}
                            aria-label={expandedPresetIds[preset.id]
                                ? 'Collapse preset'
                                : 'Expand preset'}
                        >
                            {#if expandedPresetIds[preset.id]}
                                <ChevronDown class="size-4" />
                            {:else}
                                <ChevronRight class="size-4" />
                            {/if}
                        </button>

                        <!-- Borderless Name Input -->
                        <Input
                            value={preset.name}
                            onchange={(e) =>
                                updatePreset(preset.id, { name: e.currentTarget.value })}
                            aria-label="Preset name"
                            class="h-8 min-w-0 flex-1 border-0 bg-transparent px-1 font-medium shadow-none focus-visible:ring-0 text-sm leading-relaxed"
                        />

                        <!-- Active Status Badge -->
                        {#if $activePreset?.id === preset.id}
                            <Badge
                                class="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px] h-5 px-1.5 font-semibold shrink-0"
                                >Active</Badge
                            >
                        {/if}

                        <!-- Actions -->
                        <Button
                            size="icon"
                            variant="ghost"
                            class="size-8 shrink-0 {$activePreset?.id === preset.id
                                ? 'text-emerald-500 hover:text-emerald-600'
                                : 'text-muted-foreground'}"
                            title={$activePreset?.id === preset.id ? 'Active' : 'Use preset'}
                            aria-label={$activePreset?.id === preset.id ? 'Active' : 'Use preset'}
                            onclick={() => selectPreset(preset.id)}
                        >
                            <Check class="size-4" />
                        </Button>

                        <Button
                            size="icon"
                            variant="ghost"
                            class="size-8 shrink-0 text-muted-foreground hover:text-foreground"
                            title="Export Preset"
                            aria-label="Export Preset"
                            onclick={() => exportPresetFile(preset.id, { kind: 'keipreset' })}
                        >
                            <Download class="size-4" />
                        </Button>

                        <Button
                            size="icon"
                            variant="ghost"
                            class="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                            aria-label="Delete preset"
                            onclick={() => deletePreset(preset.id)}
                        >
                            <Trash2 class="size-4" />
                        </Button>
                    </div>

                    <!-- 펼쳐지는 바디 영역 -->
                    {#if expandedPresetIds[preset.id]}
                        <div class="flex flex-col gap-4 border-t bg-muted/20 p-4">
                            <!-- 1. Description -->
                            <div class="space-y-1.5">
                                <Label class="text-xs">Description</Label>
                                <Input
                                    class="h-8 text-xs bg-background"
                                    placeholder="No description"
                                    value={preset.description}
                                    onchange={(e) =>
                                        updatePreset(preset.id, {
                                            description: e.currentTarget.value
                                        })}
                                />
                            </div>

                            <div class="space-y-1.5">
                                <Label class="text-xs">Default Variables</Label>
                                <KeyValueEditor
                                    emptyMessage="No initial variables defined."
                                    data={preset.defaultVariables}
                                    onUpdateValue={(key, val) =>
                                        handleUpdateVariableValue(preset, key, val)}
                                    onAdd={(key, val) => handleAddVariable(preset, key, val)}
                                    onRemove={(key) => handleRemoveVariable(preset, key)}
                                />
                            </div>
                        </div>
                    {/if}
                </div>
            {/snippet}
        </EntityList>
    {/if}
</div>
