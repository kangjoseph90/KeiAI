<script lang="ts">
    import TogglePanelEditor from '$lib/components/toggles/TogglePanelEditor.svelte';
    import type { Preset } from '$lib/services';
    import {
        createPresetFolder,
        deletePresetFolder,
        deletePresetToggleItem,
        movePresetItem,
        savePresetToggleItem,
        updatePresetFolder
    } from '$lib/stores';

    let { preset }: { preset: Preset } = $props();
</script>

<TogglePanelEditor
    panel={preset.toggles}
    onSaveItem={(item) => savePresetToggleItem(preset.id, item)}
    onDeleteItem={(itemId) => deletePresetToggleItem(preset.id, itemId)}
    onCreateFolder={(name, parentId, sortOrder) =>
        createPresetFolder(preset.id, 'toggles', name, parentId, sortOrder)}
    onUpdateFolder={(folderId, changes) =>
        updatePresetFolder(preset.id, 'toggles', folderId, changes)}
    onDeleteFolder={(folderId) => deletePresetFolder(preset.id, 'toggles', folderId)}
    onMoveItem={(itemId, folderId, sortOrder) =>
        movePresetItem(preset.id, 'toggles', itemId, folderId, sortOrder)}
/>
