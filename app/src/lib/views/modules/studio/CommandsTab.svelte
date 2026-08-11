<script lang="ts">
    import type { Module } from '$lib/services';
    import {
        createModuleFolder,
        deleteModuleCommand,
        deleteModuleFolder,
        moveModuleItem,
        saveModuleCommand,
        updateModuleFolder
    } from '$lib/stores';
    import CommandsSection from '$lib/views/settings/chatbot/CommandsSection.svelte';

    let { module }: { module: Module } = $props();
</script>

<CommandsSection
    panel={module.commands}
    onSave={(command) => saveModuleCommand(module.id, command)}
    onDelete={(commandId) => deleteModuleCommand(module.id, commandId)}
    onCreateFolder={(name, parentId, sortOrder) =>
        createModuleFolder(module.id, 'commands', name, parentId, sortOrder)}
    onUpdateFolder={(folderId, changes) =>
        updateModuleFolder(module.id, 'commands', folderId, changes)}
    onDeleteFolder={(folderId) => deleteModuleFolder(module.id, 'commands', folderId)}
    onMoveItem={(commandId, folderId, sortOrder) =>
        moveModuleItem(module.id, 'commands', commandId, folderId, sortOrder)}
/>
