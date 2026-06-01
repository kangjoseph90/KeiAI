<script lang="ts">
    import { Plus, Trash2 } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Separator } from '$lib/components/ui/separator';
    import {
        presetScripts,
        createPresetScript,
        updatePresetScript,
        deletePresetScript,
        updatePresetContent,
        createPresetCustomToggle,
        updatePresetCustomToggle,
        deletePresetCustomToggle,
        createPresetFolder,
        updatePresetFolder,
        deletePresetFolder,
        movePresetItem
    } from '$lib/stores';
    import type { Preset, PresetCustomToggle, Script } from '$lib/services';
    import { generateSortOrder } from '$lib/utils/ordering';
    import ScriptItem from '../../modules/ScriptItem.svelte';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
    import SortableList from '$lib/components/entitylist/SortableList.svelte';

    interface Props {
        preset: Preset;
    }

    let { preset }: Props = $props();

    // ── Script Actions ──────────────────────────────────────────────
    let currentScripts = $state<Script[]>([]);

    $effect(() => {
        const unsub = presetScripts.subscribe((v) => (currentScripts = v));
        return unsub;
    });

    async function handleAddScript() {
        await createPresetScript(preset.id, { name: 'New Script' });
    }

    async function handleAddToggle() {
        await createPresetCustomToggle(preset.id, {
            key: 'new_toggle',
            label: 'New Toggle',
            type: 'checkbox',
            sortOrder: generateSortOrder(
                Object.fromEntries(
                    Object.values(preset.customToggles).map((toggle) => [
                        toggle.id,
                        { id: toggle.id, sortOrder: toggle.sortOrder }
                    ])
                )
            )
        });
    }

    async function handleReorderToggle(id: string, newSortOrder: string) {
        await updatePresetCustomToggle(preset.id, id, { sortOrder: newSortOrder });
    }

    function updateToggleType(toggle: PresetCustomToggle, type: PresetCustomToggle['type']) {
        const base = { type };
        if (type === 'select') {
            updatePresetCustomToggle(preset.id, toggle.id, { ...base, options: ['Option'] });
            return;
        }
        updatePresetCustomToggle(preset.id, toggle.id, base);
    }
</script>

<div class="flex flex-col gap-6 px-2">
    <div class="space-y-2">
        <div class="flex items-center justify-between">
            <h4 class="text-sm font-medium">Custom Toggles</h4>
            <Button size="sm" variant="outline" class="h-8 gap-1.5" onclick={handleAddToggle}>
                <Plus class="size-3.5" /> Add Toggle
            </Button>
        </div>
        <SortableList
            entities={Object.values(preset.customToggles)}
            onReorder={handleReorderToggle}
        >
            {#snippet empty()}
                <p class="py-6 text-center text-xs text-muted-foreground">No custom toggles.</p>
            {/snippet}
            {#snippet item({ entity: toggle })}
                <div
                    class="flex flex-col gap-1.5 rounded-lg border p-3 hover:bg-muted/30 transition-colors"
                >
                    <div class="flex items-center gap-2">
                        <input
                            class="h-7 w-1/4 rounded-md border bg-background px-2 text-xs"
                            value={'key' in toggle ? (toggle.key ?? '') : ''}
                            placeholder="key"
                            oninput={(event) =>
                                updatePresetCustomToggle(preset.id, toggle.id, {
                                    key: event.currentTarget.value
                                })}
                        />
                        <input
                            class="h-7 flex-1 rounded-md border bg-background px-2 text-xs"
                            value={toggle.label ?? ''}
                            placeholder="label"
                            oninput={(event) =>
                                updatePresetCustomToggle(preset.id, toggle.id, {
                                    label: event.currentTarget.value
                                })}
                        />
                        <select
                            class="h-7 w-28 rounded-md border bg-background px-2 text-xs"
                            value={toggle.type}
                            onchange={(event) =>
                                updateToggleType(
                                    toggle,
                                    event.currentTarget.value as PresetCustomToggle['type']
                                )}
                        >
                            <option value="checkbox">Checkbox</option>
                            <option value="select">Select</option>
                            <option value="text">Text</option>
                            <option value="textarea">Textarea</option>
                            <option value="caption">Caption</option>
                            <option value="divider">Divider</option>
                            <option value="group">Group</option>
                            <option value="groupEnd">Group End</option>
                        </select>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            class="text-destructive hover:text-destructive"
                            onclick={() => deletePresetCustomToggle(preset.id, toggle.id)}
                            aria-label="Delete toggle"
                        >
                            <Trash2 class="size-4" />
                        </Button>
                    </div>
                    {#if toggle.type === 'select'}
                        <div class="flex items-center gap-2">
                            <span class="text-[10px] text-muted-foreground shrink-0">Options:</span>
                            <input
                                class="h-7 flex-1 rounded-md border bg-background px-2 text-xs"
                                value={toggle.options.join(',')}
                                placeholder="Option A,Option B"
                                oninput={(event) =>
                                    updatePresetCustomToggle(preset.id, toggle.id, {
                                        options: event.currentTarget.value
                                            .split(',')
                                            .map((item) => item.trim())
                                    })}
                            />
                        </div>
                    {/if}
                </div>
            {/snippet}
        </SortableList>
    </div>

    <Separator />

    <div class="flex items-center justify-between">
        <h4 class="text-sm font-medium">Post-processing Scripts</h4>
        <Button size="sm" variant="outline" class="h-8 gap-1.5" onclick={handleAddScript}>
            <Plus class="size-3.5" /> Add Script
        </Button>
    </div>

    <EntityList
        entities={currentScripts}
        config={preset.scripts}
        layout="list"
        onCreateFolder={(name, parentId, sortOrder) =>
            createPresetFolder(preset.id, name, parentId, sortOrder)}
        onUpdateFolder={(id, changes) => updatePresetFolder(preset.id, id, changes)}
        onDeleteFolder={(id) => deletePresetFolder(preset.id, id)}
        onMoveItem={(itemId, newFolderId, newSortOrder) =>
            movePresetItem(preset.id, itemId, newFolderId, newSortOrder)}
    >
        {#snippet empty()}
            <div
                class="bg-muted/30 rounded-lg p-8 text-center text-muted-foreground border border-dashed"
            >
                <p class="text-sm">No scripts defined for this preset.</p>
                <p class="text-[10px] mt-1">
                    Scripts allow you to modify prompts and responses using regex.
                </p>
            </div>
        {/snippet}
        {#snippet item({ entity: script })}
            <ScriptItem
                item={script}
                onUpdate={(id, changes) => updatePresetScript(preset.id, id, changes)}
                onDelete={(id) => deletePresetScript(preset.id, id)}
            />
        {/snippet}
    </EntityList>
</div>
