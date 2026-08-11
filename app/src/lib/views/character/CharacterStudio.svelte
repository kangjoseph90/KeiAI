<script lang="ts">
    import {
        UserRound,
        MessageSquare,
        Book,
        Code,
        Image as ImageIcon,
        Settings2,
        Monitor
    } from 'lucide-svelte';
    import { WorkspaceShell } from '$lib/components/layout';
    import { ScrollArea } from '$lib/components/ui/scroll-area';
    import AssetView from '$lib/components/AssetView.svelte';
    import {
        activeCharacter,
        activeChat,
        activeRoom,
        t,
        updateCharacterContent,
        updateCharacterAvatar,
        removeCharacterAvatar,
        saveCharacterGreeting,
        deleteCharacterGreeting,
        saveCharacterLorebook,
        deleteCharacterLorebook,
        saveCharacterScript,
        deleteCharacterScript,
        saveCharacterCharJS,
        deleteCharacterCharJS,
        createCharacterFolder,
        updateCharacterFolder,
        deleteCharacterFolder,
        moveCharacterItem,
        deleteCharacter
    } from '$lib/stores';
    import { navigate, type CharacterStudioTab } from '$lib/router';
    import { isKeiServer } from '$lib/services';
    import {
        exportCharacterFile,
        syncChatGreetings,
        type ExportCharacterFileRequest
    } from '$lib/managers';
    import type { DeepPartial } from '$lib/utils/defaults';
    import type { CharacterContent, Greeting } from '$lib/services';
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
    const tabs = $derived([
        { id: 'profile', label: $t('character.studio.tabs.profile'), icon: UserRound },
        { id: 'greetings', label: $t('character.studio.tabs.greetings'), icon: MessageSquare },
        { id: 'lorebooks', label: $t('character.studio.tabs.lorebooks'), icon: Book },
        { id: 'scripts', label: $t('character.studio.tabs.scripts'), icon: Code },
        { id: 'display', label: $t('character.studio.tabs.display'), icon: Monitor },
        { id: 'assets', label: $t('character.studio.tabs.assets'), icon: ImageIcon },
        { id: 'advanced', label: $t('character.studio.tabs.advanced'), icon: Settings2 }
    ] as const);

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

    async function handleSaveGreeting(item: Greeting) {
        if (!$activeCharacter) return '';
        await saveCharacterGreeting($activeCharacter.id, item);
        if (isChatSynced() && $activeChat) {
            await syncChatGreetings($activeChat.id);
        }
        return item.id;
    }

    async function handleDeleteGreeting(id: string) {
        if (!$activeCharacter) return;
        await deleteCharacterGreeting($activeCharacter.id, id);
        if (isChatSynced() && $activeChat) {
            await syncChatGreetings($activeChat.id);
        }
    }

    async function handleExport(id: ExportButton, request: ExportCharacterFileRequest) {
        if (!$activeCharacter || exporting) return;
        exporting = id;
        try {
            await exportCharacterFile($activeCharacter.id, request);
        } catch (error) {
            toast.error({
                title: $t('character.toast.export'),
                description: getErrorMessage(error)
            });
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
                title: $t('character.deleteTitle'),
                description: $t('character.deleteBody', { name: target.name }),
                confirmText: $t('common.actions.delete'),
                variant: 'destructive'
            });
            if (!confirmed || $activeCharacter?.id !== target.id) return;
            await deleteCharacter(target.id);
            backToChat();
        } catch (error) {
            toast.error({
                title: $t('character.toast.delete'),
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
                      encKey: $activeCharacter.avatar.encKey,
                      mimeType: $activeCharacter.avatar.mimeType
                  }
                : null}
            alt={$activeCharacter?.name ?? $t('character.studio.avatarFallback')}
            class="size-full object-cover"
            fallback="none"
            focus="top"
        >
            {#if !$activeCharacter?.avatar}
                <UserRound class="size-5 text-muted-foreground" />
            {/if}
        </AssetView>
    </div>
{/snippet}

<WorkspaceShell
    workspaceName={$t('character.studio.title')}
    entityName={$activeCharacter?.name}
    sections={tabs}
    activeSection={activeTab}
    showDetail={characterTab !== undefined}
    onSelect={openTab}
    onBack={returnToTabs}
    onClose={backToChat}
    closeLabel={$t('character.studio.close')}
    identity={identityAvatar}
>
    {#if !$activeCharacter}
        <div class="flex flex-1 items-center justify-center">
            <p class="text-muted-foreground">{$t('character.studio.loading')}</p>
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
                        onUpdateAvatar={async (characterId, file) => {
                            await updateCharacterAvatar(characterId, file);
                        }}
                        onRemoveAvatar={async (characterId) => {
                            await removeCharacterAvatar(characterId);
                        }}
                    />
                {:else if activeTab === 'greetings'}
                    <GreetingsTab
                        character={$activeCharacter}
                        onSave={handleSaveGreeting}
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
                        config={$activeCharacter!.lorebooks}
                        onSave={async (item) => {
                            await saveCharacterLorebook($activeCharacter!.id, item);
                        }}
                        onDelete={async (id) => {
                            await deleteCharacterLorebook($activeCharacter!.id, id);
                        }}
                        onCreateFolder={(name: string, parentId?: string, sortOrder?: string) =>
                            createCharacterFolder(
                                $activeCharacter!.id,
                                'lorebooks',
                                name,
                                parentId,
                                sortOrder
                            )}
                        onUpdateFolder={(id, changes) =>
                            updateCharacterFolder($activeCharacter!.id, 'lorebooks', id, changes)}
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
                        scriptsConfig={$activeCharacter!.scripts}
                        charjsConfig={$activeCharacter!.charjs}
                        onSaveScript={async (item) => {
                            await saveCharacterScript($activeCharacter!.id, item);
                        }}
                        onDeleteScript={async (id) => {
                            await deleteCharacterScript($activeCharacter!.id, id);
                        }}
                        onSaveCharJS={async (item) => {
                            await saveCharacterCharJS($activeCharacter!.id, item);
                        }}
                        onDeleteCharJS={async (id) => {
                            await deleteCharacterCharJS($activeCharacter!.id, id);
                        }}
                        scriptFolders={{
                            onCreateFolder: (name: string, parentId?: string, sortOrder?: string) =>
                                createCharacterFolder(
                                    $activeCharacter!.id,
                                    'scripts',
                                    name,
                                    parentId,
                                    sortOrder
                                ),
                            onUpdateFolder: (id, changes) =>
                                updateCharacterFolder($activeCharacter!.id, 'scripts', id, changes),
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
                            onCreateFolder: (name: string, parentId?: string, sortOrder?: string) =>
                                createCharacterFolder(
                                    $activeCharacter!.id,
                                    'charjs',
                                    name,
                                    parentId,
                                    sortOrder
                                ),
                            onUpdateFolder: (id, changes) =>
                                updateCharacterFolder($activeCharacter!.id, 'charjs', id, changes),
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
</WorkspaceShell>
