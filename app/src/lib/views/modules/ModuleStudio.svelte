<script lang="ts">
    import {
        Book,
        Code,
        Image as ImageIcon,
        Monitor,
        Package,
        Settings2,
        UserRound
    } from 'lucide-svelte';
    import { WorkspaceShell } from '$lib/components/layout';
    import { ScrollArea } from '$lib/components/ui/scroll-area';
    import {
        activeChat,
        activeModule,
        activeRoom,
        appSettings,
        moduleLorebooks,
        moduleScripts,
        moduleCharJS,
        setModuleEnabled,
        updateModule,
        deleteModule,
        createModuleLorebook,
        updateModuleLorebook,
        deleteModuleLorebook,
        createModuleScript,
        updateModuleScript,
        deleteModuleScript,
        createModuleCharJS,
        updateModuleCharJS,
        deleteModuleCharJS,
        createModuleFolder,
        updateModuleFolder,
        deleteModuleFolder,
        moveModuleItem
    } from '$lib/stores';
    import { navigate, type ModuleStudioTab } from '$lib/router';
    import { isKeiServer } from '$lib/adapters/pb';
    import { exportModuleFile } from '$lib/managers/module';
    import type { DeepPartial } from '$lib/utils/defaults';
    import type { ModuleContent, Lorebook, Script, CharJS } from '$lib/services';
    import type { ModuleFileExport } from '$lib/porters/module';
    import { appConfirm, toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';

    // Tab Components
    import ProfileTab from './studio/ProfileTab.svelte';
    import LorebooksTab from './studio/LorebooksTab.svelte';
    import ScriptsTab from './studio/ScriptsTab.svelte';
    import DisplayTab from './studio/DisplayTab.svelte';
    import AssetsTab from './studio/AssetsTab.svelte';
    import AdvancedTab from './studio/AdvancedTab.svelte';

    interface Props {
        moduleId: string;
        moduleTab?: ModuleStudioTab;
    }

    let { moduleId, moduleTab }: Props = $props();

    type ExportButton = 'risu' | 'keimodule-light' | 'keimodule-baked';
    let activeTab = $state<ModuleStudioTab>('profile');
    let exporting = $state<ExportButton | null>(null);
    let deleting = $state(false);

    async function updateModuleContent(changes: DeepPartial<ModuleContent>) {
        if (!$activeModule) return;
        await updateModule($activeModule.id, changes);
    }

    function backToContext() {
        if ($activeRoom && $activeChat) {
            navigate({ view: 'room', roomId: $activeRoom.id, chatId: $activeChat.id });
        } else if ($activeRoom) {
            navigate({ view: 'room', roomId: $activeRoom.id });
        } else {
            navigate({ view: 'home' });
        }
    }

    // Tabs navigation helper
    const tabs = [
        { id: 'profile', label: 'Profile', icon: UserRound },
        { id: 'lorebooks', label: 'Lorebooks', icon: Book },
        { id: 'scripts', label: 'Scripts', icon: Code },
        { id: 'display', label: 'Display', icon: Monitor },
        { id: 'assets', label: 'Assets', icon: ImageIcon },
        { id: 'advanced', label: 'Advanced', icon: Settings2 }
    ] as const;

    $effect(() => {
        if (moduleTab) activeTab = moduleTab;
    });

    let enabled = $derived(
        $activeModule ? ($appSettings?.modules.refs[$activeModule.id]?.enabled ?? true) : true
    );

    function openTab(tab: ModuleStudioTab) {
        activeTab = tab;
        navigate({ view: 'moduleStudio', moduleId, moduleTab: tab });
    }

    function returnToTabs() {
        navigate({ view: 'moduleStudio', moduleId });
    }

    async function handleExport(id: ExportButton, request: ModuleFileExport) {
        if (!$activeModule || exporting) return;
        exporting = id;
        try {
            await exportModuleFile($activeModule.id, request);
        } catch (error) {
            toast.error({ title: 'Could not export module', description: getErrorMessage(error) });
        } finally {
            exporting = null;
        }
    }

    async function handleDeleteModule() {
        if (!$activeModule || deleting) return;
        const target = $activeModule;
        deleting = true;
        try {
            const confirmed = await appConfirm({
                title: 'Delete module?',
                description: `Delete "${target.name}" and its owned resources? This cannot be undone.`,
                confirmText: 'Delete',
                variant: 'destructive'
            });
            if (!confirmed || $activeModule?.id !== target.id) return;
            await deleteModule(target.id);
            backToContext();
        } catch (error) {
            toast.error({ title: 'Could not delete module', description: getErrorMessage(error) });
        } finally {
            deleting = false;
        }
    }
</script>

{#snippet identityAvatar(sizeClass: string)}
    <div
        class="flex {sizeClass} shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted"
    >
        <Package class="size-5 text-muted-foreground" />
    </div>
{/snippet}

<WorkspaceShell
    workspaceName="Module Studio"
    entityName={$activeModule?.name}
    sections={tabs}
    activeSection={activeTab}
    showDetail={moduleTab !== undefined}
    onSelect={openTab}
    onBack={returnToTabs}
    onClose={backToContext}
    closeLabel="Close studio"
    identity={identityAvatar}
>
    {#if !$activeModule}
        <div class="flex flex-1 items-center justify-center">
            <p class="text-muted-foreground">Loading module data...</p>
        </div>
    {:else}
        <ScrollArea class="min-h-0 flex-1">
            <div class="max-w-4xl p-4 md:px-8 md:pb-8 md:pt-4">
                {#if activeTab === 'profile'}
                    <ProfileTab
                        module={$activeModule}
                        onUpdate={async (changes) => {
                            await updateModuleContent(changes);
                        }}
                    />
                {:else if activeTab === 'lorebooks'}
                    <LorebooksTab
                        lorebooks={$moduleLorebooks}
                        config={$activeModule.lorebooks}
                        onCreate={async (data) => {
                            return createModuleLorebook($activeModule!.id, data as Lorebook);
                        }}
                        onUpdate={async (id, changes) => {
                            await updateModuleLorebook($activeModule!.id, id, changes);
                        }}
                        onDelete={async (id) => {
                            await deleteModuleLorebook($activeModule!.id, id);
                        }}
                        onCreateFolder={(name, parentId, sortOrder) =>
                            createModuleFolder(
                                $activeModule!.id,
                                'lorebooks',
                                name,
                                parentId,
                                sortOrder
                            )}
                        onUpdateFolder={(id, changes) =>
                            updateModuleFolder($activeModule!.id, 'lorebooks', id, changes)}
                        onDeleteFolder={(id) =>
                            deleteModuleFolder($activeModule!.id, 'lorebooks', id)}
                        onMoveItem={(itemId, newFolderId, newSortOrder) =>
                            moveModuleItem(
                                $activeModule!.id,
                                'lorebooks',
                                itemId,
                                newFolderId,
                                newSortOrder
                            )}
                    />
                {:else if activeTab === 'scripts'}
                    <ScriptsTab
                        scripts={$moduleScripts}
                        charJS={$moduleCharJS}
                        scriptsConfig={$activeModule.scripts}
                        charjsConfig={$activeModule.charjs}
                        onCreateScript={async (data) => {
                            return createModuleScript($activeModule!.id, data as Script);
                        }}
                        onUpdateScript={async (id, changes) => {
                            await updateModuleScript($activeModule!.id, id, changes);
                        }}
                        onDeleteScript={async (id) => {
                            await deleteModuleScript($activeModule!.id, id);
                        }}
                        onCreateCharJS={async (data) => {
                            return createModuleCharJS($activeModule!.id, data as CharJS);
                        }}
                        onUpdateCharJS={async (id, changes) => {
                            await updateModuleCharJS($activeModule!.id, id, changes);
                        }}
                        onDeleteCharJS={async (id) => {
                            await deleteModuleCharJS($activeModule!.id, id);
                        }}
                        scriptFolders={{
                            onCreateFolder: (name, parentId, sortOrder) =>
                                createModuleFolder(
                                    $activeModule!.id,
                                    'scripts',
                                    name,
                                    parentId,
                                    sortOrder
                                ),
                            onUpdateFolder: (id, changes) =>
                                updateModuleFolder($activeModule!.id, 'scripts', id, changes),
                            onDeleteFolder: (id) =>
                                deleteModuleFolder($activeModule!.id, 'scripts', id),
                            onMoveItem: (itemId, newFolderId, newSortOrder) =>
                                moveModuleItem(
                                    $activeModule!.id,
                                    'scripts',
                                    itemId,
                                    newFolderId,
                                    newSortOrder
                                )
                        }}
                        charjsFolders={{
                            onCreateFolder: (name, parentId, sortOrder) =>
                                createModuleFolder(
                                    $activeModule!.id,
                                    'charjs',
                                    name,
                                    parentId,
                                    sortOrder
                                ),
                            onUpdateFolder: (id, changes) =>
                                updateModuleFolder($activeModule!.id, 'charjs', id, changes),
                            onDeleteFolder: (id) =>
                                deleteModuleFolder($activeModule!.id, 'charjs', id),
                            onMoveItem: (itemId, newFolderId, newSortOrder) =>
                                moveModuleItem(
                                    $activeModule!.id,
                                    'charjs',
                                    itemId,
                                    newFolderId,
                                    newSortOrder
                                )
                        }}
                    />
                {:else if activeTab === 'display'}
                    <DisplayTab
                        module={$activeModule}
                        onUpdate={async (changes) => {
                            await updateModuleContent(changes);
                        }}
                    />
                {:else if activeTab === 'assets'}
                    <AssetsTab module={$activeModule} />
                {:else if activeTab === 'advanced'}
                    <AdvancedTab
                        module={$activeModule}
                        {enabled}
                        {exporting}
                        {deleting}
                        showLightExport={isKeiServer()}
                        onUpdate={async (changes) => {
                            await updateModuleContent(changes);
                        }}
                        onToggleEnabled={async (next) => {
                            await setModuleEnabled($activeModule!.id, next);
                        }}
                        onExport={handleExport}
                        onDelete={handleDeleteModule}
                    />
                {/if}
            </div>
        </ScrollArea>
    {/if}
</WorkspaceShell>
