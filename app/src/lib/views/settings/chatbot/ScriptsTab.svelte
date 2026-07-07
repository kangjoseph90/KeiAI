<script lang="ts">
    import { Plus } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import {
        presetScripts,
        createPresetScript,
        updatePresetScript,
        deletePresetScript,
        createPresetFolder,
        updatePresetFolder,
        deletePresetFolder,
        movePresetItem
    } from '$lib/stores';
    import type { Preset, Script } from '$lib/services';
    import ScriptItem from '../../modules/ScriptItem.svelte';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
    import EmptyListPlaceholder from '$lib/components/EmptyListPlaceholder.svelte';
    import ListActionBar from '$lib/components/ListActionBar.svelte';

    let { preset }: { preset: Preset } = $props();
    let currentScripts = $state<Script[]>([]);
    let editingScriptId = $state<string | null>(null);

    $effect(() => {
        const unsubscribe = presetScripts.subscribe((scripts) => (currentScripts = scripts));
        return unsubscribe;
    });

    async function handleAddScript() {
        const script = await createPresetScript(preset.id, { name: 'New Script' });
        editingScriptId = script.id;
    }
</script>

<div class="flex flex-col gap-4 px-2">
    <ListActionBar description="Transform model output after generation.">
        <Button size="sm" class="gap-1.5" onclick={handleAddScript}>
            <Plus class="size-4" /> Add
        </Button>
    </ListActionBar>

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
            <EmptyListPlaceholder message="No scripts defined for this preset." />
        {/snippet}
        {#snippet item({ entity: script })}
            <ScriptItem
                item={script}
                initiallyEditing={editingScriptId === script.id}
                onUpdate={(id, changes) => updatePresetScript(preset.id, id, changes)}
                onDelete={(id) => deletePresetScript(preset.id, id)}
            />
        {/snippet}
    </EntityList>
</div>
