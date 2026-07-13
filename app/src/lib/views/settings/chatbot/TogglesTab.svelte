<script lang="ts">
    import { GripVertical, Plus, Trash2 } from 'lucide-svelte';
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
    import { appConfirm, toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';

    let { preset }: { preset: Preset } = $props();
    let busyAction = $state<string | null>(null);

    async function handleAddToggle() {
        if (busyAction) return;
        const presetId = preset.id;
        busyAction = 'create';
        try {
            await createPresetCustomToggle(presetId, {
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
        } catch (error) {
            toast.error({ title: 'Could not add toggle', description: getErrorMessage(error) });
        } finally {
            busyAction = null;
        }
    }

    async function handleReorder(id: string, newSortOrder: string) {
        if (busyAction) return;
        try {
            await updatePresetCustomToggle(preset.id, id, { sortOrder: newSortOrder });
        } catch (error) {
            toast.error({ title: 'Could not reorder toggle', description: getErrorMessage(error) });
        }
    }

    async function updateToggleSafely(
        toggleId: string,
        changes: Parameters<typeof updatePresetCustomToggle>[2]
    ): Promise<void> {
        try {
            await updatePresetCustomToggle(preset.id, toggleId, changes);
        } catch (error) {
            toast.error({ title: 'Could not update toggle', description: getErrorMessage(error) });
        }
    }

    function updateType(toggle: PresetCustomToggle, type: PresetCustomToggle['type']) {
        if (type === 'select') {
            void updateToggleSafely(toggle.id, {
                type,
                options: ['Option']
            });
            return;
        }
        void updateToggleSafely(toggle.id, { type });
    }

    async function handleDelete(toggle: PresetCustomToggle) {
        if (busyAction) return;
        const presetId = preset.id;
        busyAction = `delete:${toggle.id}`;
        try {
            const confirmed = await appConfirm({
                title: 'Delete custom toggle?',
                description: `Delete "${toggle.label || ('key' in toggle && toggle.key) || 'this toggle'}"?`,
                confirmText: 'Delete',
                variant: 'destructive'
            });
            if (!confirmed || preset.id !== presetId) return;
            await deletePresetCustomToggle(presetId, toggle.id);
        } catch (error) {
            toast.error({ title: 'Could not delete toggle', description: getErrorMessage(error) });
        } finally {
            busyAction = null;
        }
    }
</script>

<div class="flex flex-col gap-4 px-2">
    <ListActionBar description="Quick controls shown beside conversations.">
        <Button
            size="sm"
            class="gap-1.5"
            disabled={busyAction !== null}
            aria-busy={busyAction === 'create'}
            onclick={handleAddToggle}
        >
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
                    <div
                        class="flex h-8 w-5 shrink-0 cursor-grab active:cursor-grabbing select-none items-center justify-center text-muted-foreground/45 transition-colors hover:text-muted-foreground"
                        aria-hidden="true"
                    >
                        <GripVertical class="size-4" />
                    </div>
                    <input
                        class="h-9 min-w-0 rounded-md border bg-background px-2 text-xs sm:w-1/4"
                        value={'key' in toggle ? (toggle.key ?? '') : ''}
                        disabled={busyAction !== null}
                        placeholder="key"
                        oninput={(event) =>
                            updateToggleSafely(toggle.id, {
                                key: event.currentTarget.value
                            })}
                    />
                    <input
                        class="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
                        value={toggle.label ?? ''}
                        disabled={busyAction !== null}
                        placeholder="label"
                        oninput={(event) =>
                            updateToggleSafely(toggle.id, {
                                label: event.currentTarget.value
                            })}
                    />
                    <select
                        class="h-9 rounded-md border bg-background px-2 text-xs sm:w-32"
                        value={toggle.type}
                        disabled={busyAction !== null}
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
                        disabled={busyAction !== null}
                        aria-busy={busyAction === `delete:${toggle.id}`}
                        onclick={() => handleDelete(toggle)}
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
                            disabled={busyAction !== null}
                            placeholder="Option A,Option B"
                            oninput={(event) =>
                                updateToggleSafely(toggle.id, {
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
