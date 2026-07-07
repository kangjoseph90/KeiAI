<script lang="ts">
    import { Plus, Trash2 } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import {
        createPresetCustomToggle,
        updatePresetCustomToggle,
        deletePresetCustomToggle
    } from '$lib/stores';
    import type { Preset, PresetCustomToggle } from '$lib/services';
    import { generateSortOrder } from '$lib/utils/ordering';
    import SortableList from '$lib/components/entitylist/SortableList.svelte';
    import EmptyListPlaceholder from '$lib/components/EmptyListPlaceholder.svelte';
    import ListActionBar from '$lib/components/ListActionBar.svelte';

    let { preset }: { preset: Preset } = $props();

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

    async function handleReorder(id: string, newSortOrder: string) {
        await updatePresetCustomToggle(preset.id, id, { sortOrder: newSortOrder });
    }

    function updateType(toggle: PresetCustomToggle, type: PresetCustomToggle['type']) {
        if (type === 'select') {
            void updatePresetCustomToggle(preset.id, toggle.id, {
                type,
                options: ['Option']
            });
            return;
        }
        void updatePresetCustomToggle(preset.id, toggle.id, { type });
    }
</script>

<div class="flex flex-col gap-4 px-2">
    <ListActionBar description="Quick controls shown beside conversations.">
        <Button size="sm" class="gap-1.5" onclick={handleAddToggle}>
            <Plus class="size-4" /> Add
        </Button>
    </ListActionBar>

    <SortableList entities={Object.values(preset.customToggles)} onReorder={handleReorder}>
        {#snippet empty()}
            <EmptyListPlaceholder message="No custom toggles." />
        {/snippet}
        {#snippet item({ entity: toggle })}
            <div class="flex flex-col gap-1.5 rounded-lg border p-3 hover:bg-muted/30">
                <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                        class="h-9 min-w-0 rounded-md border bg-background px-2 text-xs sm:w-1/4"
                        value={'key' in toggle ? (toggle.key ?? '') : ''}
                        placeholder="key"
                        oninput={(event) =>
                            updatePresetCustomToggle(preset.id, toggle.id, {
                                key: event.currentTarget.value
                            })}
                    />
                    <input
                        class="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
                        value={toggle.label ?? ''}
                        placeholder="label"
                        oninput={(event) =>
                            updatePresetCustomToggle(preset.id, toggle.id, {
                                label: event.currentTarget.value
                            })}
                    />
                    <select
                        class="h-9 rounded-md border bg-background px-2 text-xs sm:w-32"
                        value={toggle.type}
                        onchange={(event) =>
                            updateType(
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
                        size="icon"
                        class="self-end text-destructive hover:text-destructive sm:self-auto"
                        onclick={() => deletePresetCustomToggle(preset.id, toggle.id)}
                        aria-label="Delete toggle"
                    >
                        <Trash2 class="size-4" />
                    </Button>
                </div>
                {#if toggle.type === 'select'}
                    <div class="flex items-center gap-2">
                        <span class="shrink-0 text-[10px] text-muted-foreground">Options:</span>
                        <input
                            class="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
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
