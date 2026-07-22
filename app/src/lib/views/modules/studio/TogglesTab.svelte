<script lang="ts">
    import TogglePanelEditor from '$lib/components/toggles/TogglePanelEditor.svelte';
    import type { Module } from '$lib/services';
    import {
        createModuleFolder,
        deleteModuleFolder,
        deleteModuleToggleItem,
        moveModuleItem,
        saveModuleToggleItem,
        updateModuleFolder
    } from '$lib/stores';

    let { module }: { module: Module } = $props();
</script>

<TogglePanelEditor
    panel={module.toggles}
    onSaveItem={(item) => saveModuleToggleItem(module.id, item)}
    onDeleteItem={(itemId) => deleteModuleToggleItem(module.id, itemId)}
    onCreateFolder={(name, parentId, sortOrder) =>
        createModuleFolder(module.id, 'toggles', name, parentId, sortOrder)}
    onUpdateFolder={(folderId, changes) =>
        updateModuleFolder(module.id, 'toggles', folderId, changes)}
    onDeleteFolder={(folderId) => deleteModuleFolder(module.id, 'toggles', folderId)}
    onMoveItem={(itemId, folderId, sortOrder) =>
        moveModuleItem(module.id, 'toggles', itemId, folderId, sortOrder)}
/>
