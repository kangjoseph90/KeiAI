<script lang="ts">
    import {
        Book,
        ChevronLeft,
        ChevronRight,
        Code,
        Image as ImageIcon,
        Monitor,
        Package,
        Settings2,
        UserRound,
        X
    } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
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

    let hasSelectedTab = $derived(moduleTab !== undefined);
    let activeTabLabel = $derived(
        tabs.find((tab) => tab.id === activeTab)?.label ?? 'Module Studio'
    );

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

<div class="flex h-full min-h-0 flex-col bg-background">
    <div class="flex min-h-0 flex-1 overflow-hidden">
        <!-- Sidebar Navigation -->
        <nav
            class="min-h-0 w-full shrink-0 flex-col border-r bg-muted/30 md:flex md:min-w-64 md:w-[max(16rem,calc((100vw-72rem)/2+16rem))] {hasSelectedTab
                ? 'hidden'
                : 'flex'}"
            aria-label="Module Studio sections"
        >
            <div class="flex h-14 shrink-0 items-center border-b px-2 md:hidden">
                {@render identityAvatar('size-8')}
                <div class="min-w-0 flex-1 px-2">
                    <p class="truncate text-sm font-semibold">
                        {$activeModule?.name ?? 'Module'}
                    </p>
                    <p class="text-[11px] text-muted-foreground">Module Studio</p>
                </div>
                <Button
                    variant="ghost"
                    size="icon"
                    onclick={backToContext}
                    aria-label="Close studio"
                >
                    <X class="size-5" />
                </Button>
            </div>
            <div
                class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-4 md:ml-auto md:w-64 md:flex-none md:px-4 md:pb-4 md:pt-8"
            >
                {#if $activeModule}
                    <div class="mb-4 hidden items-center gap-3 px-3 md:flex">
                        {@render identityAvatar('size-10')}
                        <div class="min-w-0">
                            <p class="truncate text-sm font-medium">{$activeModule.name}</p>
                            <p class="text-xs text-muted-foreground">Module Studio</p>
                        </div>
                    </div>
                {/if}
                {#each tabs as tab (tab.id)}
                    <button
                        class="flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors md:min-h-0 {activeTab ===
                        tab.id
                            ? hasSelectedTab
                                ? 'bg-primary text-primary-foreground shadow-sm'
                                : 'text-muted-foreground hover:bg-muted hover:text-foreground md:bg-primary md:text-primary-foreground md:shadow-sm'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
                        onclick={() => openTab(tab.id)}
                        aria-current={activeTab === tab.id ? 'page' : undefined}
                    >
                        <tab.icon class="size-4" />
                        <span>{tab.label}</span>
                        <ChevronRight class="ml-auto size-4 md:hidden" />
                    </button>
                {/each}
            </div>
        </nav>

        <!-- Main Workspace -->
        <main
            class="min-h-0 flex-1 flex-col overflow-hidden md:flex {hasSelectedTab
                ? 'flex'
                : 'hidden'}"
        >
            <div
                class="flex h-14 w-full max-w-4xl shrink-0 items-center border-b px-2 md:mt-4 md:border-b-0 md:px-8"
            >
                <Button
                    variant="ghost"
                    size="icon"
                    class="md:hidden"
                    onclick={returnToTabs}
                    aria-label="Back to Module Studio sections"
                >
                    <ChevronLeft class="size-5" />
                </Button>
                <div class="md:hidden">{@render identityAvatar('size-8')}</div>
                <div class="min-w-0 flex-1 px-2 md:px-0">
                    <p class="truncate text-sm font-semibold md:text-xl">{activeTabLabel}</p>
                    {#if $activeModule}
                        <p class="hidden truncate text-xs text-muted-foreground md:block">
                            {$activeModule.name}
                        </p>
                    {/if}
                </div>
                <Button
                    variant="ghost"
                    size="icon"
                    onclick={backToContext}
                    aria-label="Close studio"
                >
                    <X class="size-5" />
                </Button>
            </div>
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
                                    return createModuleLorebook(
                                        $activeModule!.id,
                                        data as Lorebook
                                    );
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
                                        updateModuleFolder(
                                            $activeModule!.id,
                                            'scripts',
                                            id,
                                            changes
                                        ),
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
                                        updateModuleFolder(
                                            $activeModule!.id,
                                            'charjs',
                                            id,
                                            changes
                                        ),
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
        </main>
    </div>
</div>
