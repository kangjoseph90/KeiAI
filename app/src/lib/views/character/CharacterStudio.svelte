<script lang="ts">
    import {
        ChevronLeft,
        ChevronRight,
        User,
        MessageSquare,
        Book,
        Code,
        Image as ImageIcon,
        Settings2,
        Monitor,
        X
    } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { ScrollArea } from '$lib/components/ui/scroll-area';
    import AssetView from '$lib/components/AssetView.svelte';
    import {
        activeCharacter,
        activeChat,
        activeRoom,
        updateCharacterContent,
        updateCharacterAvatar,
        removeCharacterAvatar,
        createCharacterGreeting,
        deleteCharacterGreeting,
        updateCharacterGreeting,
        characterLorebooks,
        createCharacterLorebook,
        updateCharacterLorebook,
        deleteCharacterLorebook,
        characterScripts,
        createCharacterScript,
        updateCharacterScript,
        deleteCharacterScript,
        characterCharJS,
        createCharacterCharJS,
        updateCharacterCharJS,
        deleteCharacterCharJS,
        createCharacterFolder,
        updateCharacterFolder,
        deleteCharacterFolder,
        moveCharacterItem,
        deleteCharacter
    } from '$lib/stores';
    import { navigate, type CharacterStudioTab } from '$lib/router';
    import { isKeiServer } from '$lib/adapters/pb';
    import {
        exportCharacterFile,
        syncChatGreetings,
        type ExportCharacterFileRequest
    } from '$lib/managers';
    import type { DeepPartial } from '$lib/utils/defaults';
    import type { CharacterContent, Lorebook, Script, CharJS } from '$lib/services';
    import { appConfirm, toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';

    // Tab Components
    import ProfileTab from '../character/studio/ProfileTab.svelte';
    import GreetingsTab from '../character/studio/GreetingsTab.svelte';
    import DisplayTab from '../character/studio/DisplayTab.svelte';
    import LorebooksTab from '../character/studio/LorebooksTab.svelte';
    import ScriptsTab from '../character/studio/ScriptsTab.svelte';
    import AssetsTab from '../character/studio/AssetsTab.svelte';
    import AdvancedTab from '../character/studio/AdvancedTab.svelte';

    interface Props {
        charId: string;
        characterTab?: CharacterStudioTab;
    }

    let { charId, characterTab }: Props = $props();

    type ExportButton = 'ccv3-png' | 'ccv3-charx' | 'keichar-light' | 'keichar-baked';
    let activeTab = $state<CharacterStudioTab>('profile');
    let exporting = $state<ExportButton | null>(null);
    let deleting = $state(false);

    const isChatSynced = $derived(() => {
        if (!$activeChat) return false;
        return $activeChat.lastMessageId === $activeChat.greetingMessageId;
    });

    async function updateCharacter(changes: DeepPartial<CharacterContent>) {
        if (!$activeCharacter) return;
        await updateCharacterContent($activeCharacter.id, changes);
    }

    function backToChat() {
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
        { id: 'profile', label: 'Profile', icon: User },
        { id: 'greetings', label: 'Greetings', icon: MessageSquare },
        { id: 'lorebooks', label: 'Lorebooks', icon: Book },
        { id: 'scripts', label: 'Scripts', icon: Code },
        { id: 'display', label: 'Display', icon: Monitor },
        { id: 'assets', label: 'Assets', icon: ImageIcon },
        { id: 'advanced', label: 'Advanced', icon: Settings2 }
    ] as const;

    let hasSelectedTab = $derived(characterTab !== undefined);
    let activeTabLabel = $derived(
        tabs.find((tab) => tab.id === activeTab)?.label ?? 'Character Studio'
    );

    $effect(() => {
        if (characterTab) activeTab = characterTab;
    });

    function openTab(tab: CharacterStudioTab) {
        activeTab = tab;
        navigate({ view: 'characterStudio', charId, characterTab: tab });
    }

    function returnToTabs() {
        navigate({ view: 'characterStudio', charId });
    }

    async function handleCreateGreeting(fields: { content: string; sortOrder: string }) {
        if (!$activeCharacter) return '';
        const { greetingId } = await createCharacterGreeting($activeCharacter.id, fields);
        if (isChatSynced() && $activeChat) {
            await syncChatGreetings($activeChat.id);
        }
        return greetingId;
    }

    async function handleDeleteGreeting(id: string) {
        if (!$activeCharacter) return;
        await deleteCharacterGreeting($activeCharacter.id, id);
        if (isChatSynced() && $activeChat) {
            await syncChatGreetings($activeChat.id);
        }
    }

    async function handleUpdateGreeting(
        id: string,
        changes: { content?: string; sortOrder?: string }
    ) {
        if (!$activeCharacter) return;
        await updateCharacterGreeting($activeCharacter.id, id, changes);
        if (isChatSynced() && $activeChat) {
            await syncChatGreetings($activeChat.id);
        }
    }

    async function handleExport(id: ExportButton, request: ExportCharacterFileRequest) {
        if (!$activeCharacter || exporting) return;
        exporting = id;
        try {
            await exportCharacterFile($activeCharacter.id, request);
        } finally {
            exporting = null;
        }
    }

    async function handleDeleteCharacter() {
        if (!$activeCharacter || deleting) return;
        const target = $activeCharacter;
        deleting = true;
        try {
            const confirmed = await appConfirm({
                title: 'Delete character?',
                description: `Delete "${target.name}" and its owned resources? This cannot be undone.`,
                confirmText: 'Delete',
                variant: 'destructive'
            });
            if (!confirmed || $activeCharacter?.id !== target.id) return;
            await deleteCharacter(target.id);
            backToChat();
        } catch (error) {
            toast.error({
                title: 'Could not delete character',
                description: getErrorMessage(error)
            });
        } finally {
            deleting = false;
        }
    }
</script>

{#snippet identityAvatar(sizeClass: string)}
    <div
        class="flex {sizeClass} shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted"
    >
        <AssetView
            asset={$activeCharacter?.avatar
                ? {
                      scopeType: $activeCharacter.scopeType,
                      scopeId: $activeCharacter.scopeId,
                      ownerTable: 'characters',
                      ownerId: $activeCharacter.id,
                      hash: $activeCharacter.avatar.hash,
                      encKey: $activeCharacter.avatar.encKey
                  }
                : null}
            alt={$activeCharacter?.name ?? 'Character'}
            class="size-full object-cover"
            fallback="none"
        >
            {#if !$activeCharacter?.avatar}
                <User class="size-5 text-muted-foreground" />
            {/if}
        </AssetView>
    </div>
{/snippet}

<div class="flex h-full min-h-0 flex-col bg-background">
    <div class="flex min-h-0 flex-1 overflow-hidden">
        <!-- Sidebar Navigation -->
        <nav
            class="min-h-0 w-full shrink-0 flex-col border-r bg-muted/30 md:flex md:min-w-64 md:w-[max(16rem,calc((100vw-72rem)/2+16rem))] {hasSelectedTab
                ? 'hidden'
                : 'flex'}"
            aria-label="Character Studio sections"
        >
            <div class="flex h-14 shrink-0 items-center border-b px-2 md:hidden">
                {@render identityAvatar('size-8')}
                <div class="min-w-0 flex-1 px-2">
                    <p class="truncate text-sm font-semibold">
                        {$activeCharacter?.name ?? 'Character'}
                    </p>
                    <p class="text-[11px] text-muted-foreground">Character Studio</p>
                </div>
                <Button variant="ghost" size="icon" onclick={backToChat} aria-label="Close studio">
                    <X class="size-5" />
                </Button>
            </div>
            <div
                class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-4 md:ml-auto md:w-64 md:flex-none md:px-4 md:pb-4 md:pt-8"
            >
                {#if $activeCharacter}
                    <div class="mb-4 hidden items-center gap-3 px-3 md:flex">
                        {@render identityAvatar('size-10')}
                        <div class="min-w-0">
                            <p class="truncate text-sm font-medium">{$activeCharacter.name}</p>
                            <p class="text-xs text-muted-foreground">Character Studio</p>
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
                    aria-label="Back to Character Studio sections"
                >
                    <ChevronLeft class="size-5" />
                </Button>
                <div class="md:hidden">{@render identityAvatar('size-8')}</div>
                <div class="min-w-0 flex-1 px-2 md:px-0">
                    <p class="truncate text-sm font-semibold md:text-xl">{activeTabLabel}</p>
                    {#if $activeCharacter}
                        <p class="hidden truncate text-xs text-muted-foreground md:block">
                            {$activeCharacter.name}
                        </p>
                    {/if}
                </div>
                <Button variant="ghost" size="icon" onclick={backToChat} aria-label="Close studio">
                    <X class="size-5" />
                </Button>
            </div>
            {#if !$activeCharacter}
                <div class="flex flex-1 items-center justify-center">
                    <p class="text-muted-foreground">Loading character data...</p>
                </div>
            {:else}
                <ScrollArea class="min-h-0 flex-1">
                    <div class="max-w-4xl p-4 md:px-8 md:pb-8 md:pt-4">
                        {#if activeTab === 'profile'}
                            <ProfileTab
                                character={$activeCharacter}
                                onUpdate={async (changes) => {
                                    await updateCharacter(changes);
                                }}
                                onUpdateAvatar={async (file) => {
                                    await updateCharacterAvatar($activeCharacter!.id, file);
                                }}
                                onRemoveAvatar={async () => {
                                    await removeCharacterAvatar($activeCharacter!.id);
                                }}
                            />
                        {:else if activeTab === 'greetings'}
                            <GreetingsTab
                                character={$activeCharacter}
                                onCreate={handleCreateGreeting}
                                onUpdate={handleUpdateGreeting}
                                onDelete={handleDeleteGreeting}
                            />
                        {:else if activeTab === 'display'}
                            <DisplayTab
                                character={$activeCharacter}
                                onUpdate={async (changes) => {
                                    await updateCharacter(changes);
                                }}
                            />
                        {:else if activeTab === 'lorebooks'}
                            <LorebooksTab
                                lorebooks={$characterLorebooks}
                                config={$activeCharacter!.lorebooks}
                                onCreate={async (data) => {
                                    return createCharacterLorebook(
                                        $activeCharacter!.id,
                                        data as Lorebook
                                    );
                                }}
                                onUpdate={async (id, changes) => {
                                    await updateCharacterLorebook(
                                        $activeCharacter!.id,
                                        id,
                                        changes
                                    );
                                }}
                                onDelete={async (id) => {
                                    await deleteCharacterLorebook($activeCharacter!.id, id);
                                }}
                                onCreateFolder={(
                                    name: string,
                                    parentId?: string,
                                    sortOrder?: string
                                ) =>
                                    createCharacterFolder(
                                        $activeCharacter!.id,
                                        'lorebooks',
                                        name,
                                        parentId,
                                        sortOrder
                                    )}
                                onUpdateFolder={(id, changes) =>
                                    updateCharacterFolder(
                                        $activeCharacter!.id,
                                        'lorebooks',
                                        id,
                                        changes
                                    )}
                                onDeleteFolder={(id) =>
                                    deleteCharacterFolder($activeCharacter!.id, 'lorebooks', id)}
                                onMoveItem={(itemId, newFolderId, newSortOrder) =>
                                    moveCharacterItem(
                                        $activeCharacter!.id,
                                        'lorebooks',
                                        itemId,
                                        newFolderId,
                                        newSortOrder
                                    )}
                            />
                        {:else if activeTab === 'scripts'}
                            <ScriptsTab
                                scripts={$characterScripts}
                                charJS={$characterCharJS}
                                scriptsConfig={$activeCharacter!.scripts}
                                charjsConfig={$activeCharacter!.charjs}
                                onCreateScript={async (data) => {
                                    return createCharacterScript(
                                        $activeCharacter!.id,
                                        data as Script
                                    );
                                }}
                                onUpdateScript={async (id, changes) => {
                                    await updateCharacterScript($activeCharacter!.id, id, changes);
                                }}
                                onDeleteScript={async (id) => {
                                    await deleteCharacterScript($activeCharacter!.id, id);
                                }}
                                onCreateCharJS={async (data) => {
                                    return createCharacterCharJS(
                                        $activeCharacter!.id,
                                        data as CharJS
                                    );
                                }}
                                onUpdateCharJS={async (id, changes) => {
                                    await updateCharacterCharJS($activeCharacter!.id, id, changes);
                                }}
                                onDeleteCharJS={async (id) => {
                                    await deleteCharacterCharJS($activeCharacter!.id, id);
                                }}
                                scriptFolders={{
                                    onCreateFolder: (
                                        name: string,
                                        parentId?: string,
                                        sortOrder?: string
                                    ) =>
                                        createCharacterFolder(
                                            $activeCharacter!.id,
                                            'scripts',
                                            name,
                                            parentId,
                                            sortOrder
                                        ),
                                    onUpdateFolder: (id, changes) =>
                                        updateCharacterFolder(
                                            $activeCharacter!.id,
                                            'scripts',
                                            id,
                                            changes
                                        ),
                                    onDeleteFolder: (id) =>
                                        deleteCharacterFolder($activeCharacter!.id, 'scripts', id),
                                    onMoveItem: (itemId, newFolderId, newSortOrder) =>
                                        moveCharacterItem(
                                            $activeCharacter!.id,
                                            'scripts',
                                            itemId,
                                            newFolderId,
                                            newSortOrder
                                        )
                                }}
                                charjsFolders={{
                                    onCreateFolder: (
                                        name: string,
                                        parentId?: string,
                                        sortOrder?: string
                                    ) =>
                                        createCharacterFolder(
                                            $activeCharacter!.id,
                                            'charjs',
                                            name,
                                            parentId,
                                            sortOrder
                                        ),
                                    onUpdateFolder: (id, changes) =>
                                        updateCharacterFolder(
                                            $activeCharacter!.id,
                                            'charjs',
                                            id,
                                            changes
                                        ),
                                    onDeleteFolder: (id) =>
                                        deleteCharacterFolder($activeCharacter!.id, 'charjs', id),
                                    onMoveItem: (itemId, newFolderId, newSortOrder) =>
                                        moveCharacterItem(
                                            $activeCharacter!.id,
                                            'charjs',
                                            itemId,
                                            newFolderId,
                                            newSortOrder
                                        )
                                }}
                            />
                        {:else if activeTab === 'assets'}
                            <AssetsTab character={$activeCharacter} />
                        {:else if activeTab === 'advanced'}
                            <AdvancedTab
                                character={$activeCharacter}
                                {exporting}
                                {deleting}
                                showLightExport={isKeiServer()}
                                onUpdate={async (changes) => {
                                    await updateCharacter(changes);
                                }}
                                onExport={handleExport}
                                onDelete={handleDeleteCharacter}
                            />
                        {/if}
                    </div>
                </ScrollArea>
            {/if}
        </main>
    </div>
</div>
