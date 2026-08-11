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
        moveGlobalItem,
        t
    } from '$lib/stores';
    import { exportPresetFile, importPresetFile } from '$lib/managers/preset';
    import type { Preset } from '$lib/services';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
    import EditableListItem from '$lib/components/entitylist/EditableListItem.svelte';
    import EmptyListPlaceholder from '$lib/components/EmptyListPlaceholder.svelte';
    import { createDefaultChatWorkflow } from '$lib/workflow/defaults';
    import ListActionBar from '$lib/components/ListActionBar.svelte';
    import KeyValueEditor from '$lib/components/KeyValueEditor.svelte';
    import { appConfirm, toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';

    let expandedPresetIds = $state<Record<string, boolean>>({});
    let busyAction = $state<string | null>(null);

    async function runPresetAction(
        key: string,
        errorTitle: string,
        action: () => void | Promise<void>
    ): Promise<void> {
        if (busyAction) return;
        busyAction = key;
        try {
            await action();
        } catch (error) {
            toast.error({ title: errorTitle, description: getErrorMessage(error) });
        } finally {
            busyAction = null;
        }
    }

    function toggleExpanded(id: string) {
        expandedPresetIds[id] = !expandedPresetIds[id];
    }

    async function handleCreatePreset() {
        await runPresetAction('create', $t('settings.presets.toast.create'), async () => {
            const preset = await createPreset({
                chatWorkflow: createDefaultChatWorkflow()
            });
            await selectPreset(preset.id);
            expandedPresetIds[preset.id] = true;
        });
    }

    async function handleImport() {
        await runPresetAction('import', $t('settings.presets.toast.import'), async () => {
            const preset = await importPresetFile({ select: true });
            if (preset) expandedPresetIds[preset.id] = true;
        });
    }

    async function handleSelectPreset(id: string) {
        await runPresetAction(`select:${id}`, $t('settings.presets.toast.select'), () =>
            selectPreset(id)
        );
    }

    async function handleExportPreset(id: string) {
        await runPresetAction(`export:${id}`, $t('settings.presets.toast.export'), () =>
            exportPresetFile(id, { kind: 'keipreset' })
        );
    }

    async function handleDeletePreset(id: string, name: string) {
        await runPresetAction(`delete:${id}`, $t('settings.presets.toast.delete'), async () => {
            const confirmed = await appConfirm({
                title: $t('settings.presets.deleteTitle'),
                description: $t('settings.presets.deleteBody', { name }),
                confirmText: $t('common.confirm.delete'),
                variant: 'destructive'
            });
            if (confirmed) await deletePreset(id);
        });
    }

    async function updatePresetSafely(
        id: string,
        changes: Parameters<typeof updatePreset>[1]
    ): Promise<void> {
        try {
            await updatePreset(id, changes);
        } catch (error) {
            toast.error({
                title: $t('settings.presets.toast.update'),
                description: getErrorMessage(error)
            });
        }
    }

    async function handleAddVariable(preset: Preset, key: string, value: string) {
        const defaultVariables = { ...preset.defaultVariables, [key]: value };
        await updatePresetSafely(preset.id, { defaultVariables });
    }

    async function handleUpdateVariableValue(preset: Preset, key: string, value: string) {
        const defaultVariables = { ...preset.defaultVariables, [key]: value };
        await updatePresetSafely(preset.id, { defaultVariables });
    }

    async function handleRemoveVariable(preset: Preset, keyToRemove: string) {
        await updatePresetSafely(preset.id, {
            defaultVariables: {
                [keyToRemove]: undefined
            }
        });
    }
</script>

<div class="flex flex-col gap-4 px-2">
    <ListActionBar description={$t('settings.presets.description')}>
        <Button
            size="sm"
            variant="outline"
            class="gap-1.5"
            disabled={busyAction !== null}
            aria-busy={busyAction === 'import'}
            onclick={handleImport}
        >
            <Upload class="size-4" />
            {$t('settings.presets.import')}
        </Button>
        <Button
            size="sm"
            onclick={handleCreatePreset}
            class="gap-1.5"
            disabled={busyAction !== null}
            aria-busy={busyAction === 'create'}
        >
            <Plus class="size-4" />
            {$t('settings.presets.new')}
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
                <EmptyListPlaceholder message={$t('settings.presets.empty')} />
            {/snippet}
            {#snippet item({ entity: preset })}
                <div
                    class={$activePreset?.id === preset.id
                        ? 'rounded-lg ring-1 ring-primary/20'
                        : ''}
                >
                    <EditableListItem
                        expanded={expandedPresetIds[preset.id]}
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
                                onclick={() => toggleExpanded(preset.id)}
                                aria-label={expandedPresetIds[preset.id]
                                    ? $t('settings.presets.collapsePreset')
                                    : $t('settings.presets.expandPreset')}
                            >
                                {#if expandedPresetIds[preset.id]}
                                    <ChevronDown class="size-3.5" />
                                {:else}
                                    <ChevronRight class="size-3.5" />
                                {/if}
                            </button>

                            <!-- Borderless Name Input -->
                            <Input
                                value={preset.name}
                                disabled={busyAction !== null}
                                onchange={(e) =>
                                    updatePresetSafely(preset.id, { name: e.currentTarget.value })}
                                aria-label={$t('settings.presets.nameAria')}
                                class="h-7 min-w-0 flex-1 border-0 bg-transparent px-1 font-medium shadow-none focus-visible:ring-0 dark:bg-transparent text-sm leading-relaxed"
                            />

                            <!-- Actions -->
                            <Button
                                size="icon-sm"
                                variant="ghost"
                                class="shrink-0 {$activePreset?.id === preset.id
                                    ? 'text-emerald-500 hover:text-emerald-600'
                                    : 'text-muted-foreground'}"
                                title={$activePreset?.id === preset.id
                                    ? $t('settings.presets.active')
                                    : $t('settings.presets.usePreset')}
                                aria-label={$activePreset?.id === preset.id
                                    ? $t('settings.presets.active')
                                    : $t('settings.presets.usePreset')}
                                disabled={busyAction !== null}
                                aria-busy={busyAction === `select:${preset.id}`}
                                onclick={() => handleSelectPreset(preset.id)}
                            >
                                <Check class="size-3.5" />
                            </Button>

                            <Button
                                size="icon-sm"
                                variant="ghost"
                                class="shrink-0 text-muted-foreground hover:text-foreground"
                                title={$t('settings.presets.exportTitle')}
                                aria-label={$t('settings.presets.exportTitle')}
                                disabled={busyAction !== null}
                                aria-busy={busyAction === `export:${preset.id}`}
                                onclick={() => handleExportPreset(preset.id)}
                            >
                                <Download class="size-3.5" />
                            </Button>

                            <Button
                                size="icon-sm"
                                variant="ghost"
                                class="shrink-0 text-muted-foreground hover:text-destructive"
                                aria-label={$t('settings.presets.deleteAria')}
                                disabled={busyAction !== null}
                                aria-busy={busyAction === `delete:${preset.id}`}
                                onclick={() => handleDeletePreset(preset.id, preset.name)}
                            >
                                <Trash2 class="size-3.5" />
                            </Button>
                        {/snippet}

                        <!-- 펼쳐지는 바디 영역 -->
                        {#snippet details()}
                            <div class="flex flex-col gap-3">
                                <!-- 1. Description -->
                                <div class="space-y-1.5">
                                    <Label class="text-xs">{$t('common.label.description')}</Label>
                                    <Input
                                        class="h-8 text-xs bg-background"
                                        placeholder={$t('common.noDescription')}
                                        value={preset.description}
                                        disabled={busyAction !== null}
                                        onchange={(e) =>
                                            updatePresetSafely(preset.id, {
                                                description: e.currentTarget.value
                                            })}
                                    />
                                </div>

                                <div class="space-y-1.5">
                                    <Label class="text-xs"
                                        >{$t('settings.presets.defaultVariables')}</Label
                                    >
                                    <KeyValueEditor
                                        emptyMessage={$t('settings.presets.noVariables')}
                                        data={preset.defaultVariables}
                                        onUpdateValue={(key, val) =>
                                            handleUpdateVariableValue(preset, key, val)}
                                        onAdd={(key, val) => handleAddVariable(preset, key, val)}
                                        onRemove={(key) => handleRemoveVariable(preset, key)}
                                    />
                                </div>
                            </div>
                        {/snippet}
                    </EditableListItem>
                </div>
            {/snippet}
        </EntityList>
    {/if}
</div>
