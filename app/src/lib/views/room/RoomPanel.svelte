<script lang="ts">
    import {
        Check,
        Loader2,
        Edit3,
        Folder,
        FolderOpen,
        MessageSquare,
        MoreVertical,
        Pin,
        Plus,
        Search,
        Trash2,
        UserRound,
        Wand2,
        X
    } from 'lucide-svelte';
    import MediaView from '$lib/components/MediaView.svelte';
    import EmptyListPlaceholder from '$lib/components/EmptyListPlaceholder.svelte';
    import MediaEntityCard from '$lib/components/entitylist/MediaEntityCard.svelte';
    import ParticipantCardMenu from '$lib/components/ParticipantCardMenu.svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
    import {
        activeChat,
        collectedTasks,
        activePreset,
        activeRoom,
        appSettings,
        chatSelections,
        createChat,
        getChatTaskIndicator,
        createRoomFolder,
        deleteChat,
        deleteRoom,
        deleteRoomFolder,
        isMultiRoom,
        modules,
        moveRoomItem,
        removeRoomCharacter,
        roomChats,
        roomCharacters,
        selectActiveModules,
        setChatDefaultCharacter,
        setChatSelectedCharacter,
        titleTasks,
        updateChat,
        updateRoom,
        updateRoomFolder,
        t
    } from '$lib/stores';
    import { appAlert, appConfirm, characterPickerOpen, toast } from '$lib/ui';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
    import { getFolderColorClass } from '$lib/components/entitylist/folders';
    import TogglePanelRuntime from '$lib/components/toggles/TogglePanelRuntime.svelte';
    import TypewriterText from '$lib/components/TypewriterText.svelte';
    import type { RouteState } from '$lib/router';
    import {
        navigateToCharacterStudio,
        resolveToggleSources,
        syncChatGreetings
    } from '$lib/managers';
    import { getErrorMessage } from '$lib/types/errors';
    import { runTitle } from '$lib/tasks';

    interface Props {
        route: RouteState;
        onNavigate: (route: RouteState) => void;
    }

    let { route, onNavigate }: Props = $props();

    let chatSearch = $state('');
    let editingChatId = $state<string | null>(null);
    let editingChatTitle = $state('');
    let openChatMenuId = $state<string | null>(null);
    let editingRoomName = $state(false);
    let roomNameDraft = $state('');
    let panelAction = $state<string | null>(null);

    const toggleSources = $derived(
        resolveToggleSources($activePreset, selectActiveModules($appSettings, $modules)).filter(
            (source) =>
                Object.keys(source.panel.refs).length > 0 ||
                Object.keys(source.panel.folders).length > 0
        )
    );

    const filteredChats = $derived(() => {
        const query = chatSearch.trim().toLowerCase();
        if (!query) return $roomChats;
        return $roomChats.filter((chat) => chat.title.toLowerCase().includes(query));
    });

    async function runPanelAction(
        key: string,
        errorTitle: string,
        action: () => void | Promise<void>
    ): Promise<void> {
        if (panelAction) return;
        panelAction = key;
        try {
            await action();
        } catch (error) {
            toast.error({ title: errorTitle, description: getErrorMessage(error) });
        } finally {
            panelAction = null;
        }
    }

    async function handleCreateChat(): Promise<void> {
        if (!$activeRoom) return;
        const roomId = $activeRoom.id;
        await runPanelAction('create-chat', $t('library.toast.createChat'), async () => {
            const chat = await createChat(roomId, {
                // i18n-ignore: default fallback chat title
                title: `New Chat ${$roomChats.length + 1}`
            });
            await syncChatGreetings(chat.id);
            if ($activeRoom?.id === roomId) {
                onNavigate({ view: 'room', roomId, chatId: chat.id });
            }
        });
    }

    function handleOpenCharacter(characterId: string): void {
        void runPanelAction(
            `open-character:${characterId}`,
            $t('library.toast.openCharacter'),
            () => navigateToCharacterStudio(characterId)
        );
    }

    async function handleSelectCharacter(characterId: string): Promise<void> {
        if (!$activeChat) return;
        const chatId = $activeChat.id;
        await runPanelAction(
            `select-character:${characterId}`,
            $t('library.toast.selectCharacter'),
            () => setChatSelectedCharacter(chatId, characterId)
        );
    }

    async function handleSetDefaultCharacter(characterId: string): Promise<void> {
        if (!$activeChat) return;
        const chatId = $activeChat.id;
        await runPanelAction(
            `default-character:${characterId}`,
            $t('library.toast.setDefaultCharacter'),
            () => setChatDefaultCharacter(chatId, characterId)
        );
    }

    async function handleRemoveCharacter(characterId: string): Promise<void> {
        if (!$activeRoom) return;
        const roomId = $activeRoom.id;
        const chatId = $activeChat?.id;
        const character = $roomCharacters.find((item) => item.id === characterId);
        await runPanelAction(
            `remove-character:${characterId}`,
            $t('library.toast.removeCharacter'),
            async () => {
                const confirmed = await appConfirm({
                    title: $t('library.room.removeCharacterTitle'),
                    description: $t('library.room.removeCharacterBody', {
                        name: character?.name ?? $t('common.label.name')
                    }),
                    confirmText: $t('common.confirm.remove'),
                    variant: 'destructive'
                });
                if (!confirmed || $activeRoom?.id !== roomId) return;
                await removeRoomCharacter(roomId, characterId);
                if (chatId) await syncChatGreetings(chatId);
            }
        );
    }

    async function handleSelectChat(chatId: string): Promise<void> {
        if (!$activeRoom) return;
        const roomId = $activeRoom.id;
        await runPanelAction(`select-chat:${chatId}`, $t('library.toast.openChat'), async () => {
            await syncChatGreetings(chatId);
            if ($activeRoom?.id === roomId) onNavigate({ view: 'room', roomId, chatId });
        });
    }

    async function handleRenameChat(chatId: string): Promise<void> {
        const title = editingChatTitle.trim();
        if (!title) return;

        await runPanelAction(`rename-chat:${chatId}`, $t('library.toast.renameChat'), async () => {
            await updateChat(chatId, { title });
            editingChatId = null;
            editingChatTitle = '';
        });
    }

    async function handleRenameRoom(): Promise<void> {
        if (!$activeRoom || $isMultiRoom) return;
        const name = roomNameDraft.trim();
        if (!name) return;
        const roomId = $activeRoom.id;
        await runPanelAction('rename-room', $t('library.toast.renameRoom'), async () => {
            await updateRoom(roomId, { name });
            editingRoomName = false;
            roomNameDraft = '';
        });
    }

    function startRenameRoom(): void {
        if (!$activeRoom || $isMultiRoom) return;
        roomNameDraft = $activeRoom.name;
        editingRoomName = true;
    }

    async function handleDeleteRoom(): Promise<void> {
        if (!$activeRoom || $isMultiRoom) return;
        const roomId = $activeRoom.id;
        const roomName = $activeRoom.name;
        await runPanelAction('delete-room', $t('library.toast.deleteRoom'), async () => {
            const confirmed = await appConfirm({
                title: $t('library.room.deleteTitle'),
                description: $t('library.room.deleteBody', { name: roomName }),
                confirmText: $t('common.confirm.delete'),
                variant: 'destructive'
            });
            if (!confirmed || $activeRoom?.id !== roomId) return;
            await deleteRoom(roomId);
            onNavigate({ view: 'home' });
        });
    }

    async function handleDeleteChat(chatId: string): Promise<void> {
        if (!$activeRoom) return;
        const roomId = $activeRoom.id;
        const chat = $roomChats.find((item) => item.id === chatId);
        await runPanelAction(`delete-chat:${chatId}`, $t('library.toast.deleteChat'), async () => {
            if ($roomChats.length <= 1) {
                await appAlert({
                    title: $t('library.room.cannotDeleteChatTitle'),
                    description: $t('library.room.cannotDeleteChatBody')
                });
                return;
            }
            const confirmed = await appConfirm({
                title: $t('library.room.deleteChatTitle'),
                description: $t('library.room.deleteChatBody', {
                    name: chat?.title || $t('library.room.untitledChat')
                }),
                confirmText: $t('common.confirm.delete'),
                variant: 'destructive'
            });
            if (!confirmed || $activeRoom?.id !== roomId) return;
            const wasActive = $activeChat?.id === chatId;
            const nextChatId = await deleteChat(chatId, roomId);
            if ($activeRoom?.id === roomId && wasActive && nextChatId) {
                onNavigate({ view: 'room', roomId, chatId: nextChatId });
            }
        });
    }

    function startRenameChat(chatId: string, title: string): void {
        editingChatId = chatId;
        editingChatTitle = title;
    }

    function handleGenerateTitle(chatId: string): void {
        void runTitle(chatId).catch((error) => {
            if (error instanceof DOMException && error.name === 'AbortError') return;
            toast.error({
                title: $t('library.toast.generateTitle'),
                description: getErrorMessage(error)
            });
        });
    }

    function initial(name: string): string {
        return (name.trim().charAt(0) || '?').toUpperCase();
    }
</script>

{#if $activeRoom}
    <div class="app-sidebar-room-panel relative flex h-full w-90 shrink-0">
        <div class="flex h-full w-full flex-col bg-sidebar">
            <div class="flex h-14 items-center gap-2 border-b border-sidebar-border px-3">
                {#if editingRoomName}
                    <form
                        class="flex min-w-0 flex-1 items-center gap-1"
                        onsubmit={(event) => {
                            event.preventDefault();
                            handleRenameRoom();
                        }}
                    >
                        <Input
                            bind:value={roomNameDraft}
                            class="h-8 min-w-0 flex-1 text-sm"
                            autofocus
                            onkeydown={(event) => {
                                if (event.key === 'Escape') {
                                    editingRoomName = false;
                                    roomNameDraft = '';
                                }
                            }}
                        />
                        <Button
                            type="submit"
                            size="icon-sm"
                            aria-label={$t('library.room.rename.save')}
                            disabled={panelAction !== null}
                            aria-busy={panelAction === 'rename-room'}
                        >
                            <Check class="size-3.5" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={$t('library.room.rename.cancel')}
                            disabled={panelAction !== null}
                            onclick={() => {
                                editingRoomName = false;
                                roomNameDraft = '';
                            }}
                        >
                            <X class="size-3.5" />
                        </Button>
                    </form>
                {:else}
                    <p class="min-w-0 flex-1 truncate text-sm font-semibold">
                        {$activeRoom.name}
                    </p>
                    {#if $isMultiRoom}
                        <span
                            class="shrink-0 rounded-full border border-border/60 bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                        >
                            {$t('library.room.multiRoomBadge')}
                        </span>
                    {/if}
                    {#if !$isMultiRoom}
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            class="shrink-0 text-muted-foreground"
                            title={$t('library.room.renameButton')}
                            aria-label={$t('library.room.renameButton')}
                            disabled={panelAction !== null}
                            onclick={startRenameRoom}
                        >
                            <Edit3 class="size-3.5" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            class="shrink-0 text-muted-foreground hover:text-destructive"
                            title={$t('library.room.deleteButton')}
                            aria-label={$t('library.room.deleteNamed', { name: $activeRoom.name })}
                            disabled={panelAction !== null}
                            aria-busy={panelAction === 'delete-room'}
                            onclick={handleDeleteRoom}
                        >
                            <Trash2 class="size-3.5" />
                        </Button>
                    {/if}
                {/if}
            </div>

            <div class="border-b border-sidebar-border p-3">
                <div class="mb-2 flex items-center justify-between">
                    <p
                        class="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-muted-foreground"
                    >
                        <UserRound class="size-3" />
                        {$t('library.room.section.characters')}
                    </p>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        class="text-muted-foreground hover:text-foreground"
                        title={$t('library.room.addCharacters')}
                        aria-label={$t('library.room.addCharacters')}
                        disabled={panelAction !== null}
                        onclick={() => ($characterPickerOpen = true)}
                    >
                        <Plus class="size-3.5" />
                    </Button>
                </div>
                <EntityList
                    entities={$roomCharacters}
                    config={$activeRoom.characters}
                    layout="grid"
                    gridClass="room-panel-character-grid grid gap-2"
                    listClass="room-panel-character-grid grid gap-2"
                    gridOverlapInset={0.18}
                    childContainerClass="relative my-2 rounded-xl border border-border/60 bg-muted/20 p-2"
                    onItemClick={(character) => {
                        if ($activeChat) {
                            void handleSelectCharacter(character.id);
                        }
                    }}
                    onCreateFolder={(name, parentId, sortOrder) =>
                        createRoomFolder($activeRoom.id, 'characters', name, parentId, sortOrder)}
                    onUpdateFolder={(id, changes) =>
                        updateRoomFolder($activeRoom.id, 'characters', id, changes)}
                    onDeleteFolder={(id) => deleteRoomFolder($activeRoom.id, 'characters', id)}
                    onMoveItem={(itemId, newFolderId, newSortOrder) =>
                        moveRoomItem(
                            $activeRoom.id,
                            'characters',
                            itemId,
                            newFolderId,
                            newSortOrder
                        )}
                >
                    {#snippet empty()}
                        <div class="col-span-full">
                            <EmptyListPlaceholder message={$t('library.room.noCharacters')} />
                        </div>
                    {/snippet}
                    {#snippet folder({ folder: f, collapsed, toggle, parts })}
                        <div
                            role="button"
                            tabindex="0"
                            aria-expanded={!collapsed}
                            aria-label={f.name}
                            class="group/folder relative w-full cursor-pointer select-none"
                            onclick={toggle}
                            onkeydown={(event) => {
                                if (event.target !== event.currentTarget) return;
                                if (event.key !== 'Enter' && event.key !== ' ') return;
                                event.preventDefault();
                                toggle();
                            }}
                        >
                            <MediaEntityCard
                                name={f.name}
                                align="center"
                                density="compact"
                                interactive={false}
                                class="hover:border-foreground/25 hover:bg-sidebar-accent"
                                footerClass="py-1"
                            >
                                {#snippet visual()}
                                    {@render parts.icon({
                                        folder: f,
                                        collapsed,
                                        sizeClass: 'size-10 rounded-lg [&_svg]:size-4'
                                    })}
                                {/snippet}
                                {#snippet nameContent()}
                                    {@render parts.name({ folder: f })}
                                {/snippet}
                                {#snippet action()}
                                    {@render parts.actions({ folder: f })}
                                {/snippet}
                            </MediaEntityCard>
                        </div>
                    {/snippet}
                    {#snippet item({ entity: character })}
                        {@const selected = $chatSelections?.characterId === character.id}
                        {@const isDefault = $activeChat?.defaultCharacterId === character.id}
                        <div class="group relative">
                            <MediaEntityCard
                                name={character.name}
                                align="center"
                                density="compact"
                                interactive={false}
                                footerClass="py-1"
                                class={selected
                                    ? 'border-primary ring-2 ring-primary/20'
                                    : 'hover:border-foreground/25 hover:bg-sidebar-accent'}
                            >
                                {#snippet visual()}
                                    {#if character.avatar}
                                        <MediaView
                                            asset={{
                                                scopeType: character.scopeType,
                                                scopeId: character.scopeId,
                                                ownerTable: 'characters',
                                                ownerId: character.id,
                                                hash: character.avatar.hash,
                                                encKey: character.avatar.encKey,
                                                mimeType: character.avatar.mimeType
                                            }}
                                            alt={character.name}
                                            class="size-full object-cover"
                                            focus="top"
                                        />
                                    {:else}
                                        {initial(character.name)}
                                    {/if}
                                {/snippet}
                                {#snippet nameContent()}
                                    <span
                                        class="inline-flex max-w-full min-w-0 items-center justify-center gap-1"
                                    >
                                        {#if isDefault}
                                            <span
                                                role="img"
                                                class="inline-flex size-3 shrink-0 items-center justify-center text-primary"
                                                title={$t('library.room.defaultCharacter')}
                                                aria-label={$t(
                                                    'library.room.defaultCharacterHint',
                                                    { name: character.name }
                                                )}
                                            >
                                                <Pin class="size-3" />
                                            </span>
                                        {/if}
                                        <span class="min-w-0 truncate">{character.name}</span>
                                    </span>
                                {/snippet}
                            </MediaEntityCard>
                            <ParticipantCardMenu
                                kind="character"
                                name={character.name}
                                {isDefault}
                                disabled={panelAction !== null}
                                defaultDisabled={!$activeChat}
                                defaultBusy={panelAction === `default-character:${character.id}`}
                                removeBusy={panelAction === `remove-character:${character.id}`}
                                onOpen={() => handleOpenCharacter(character.id)}
                                onSetDefault={() => handleSetDefaultCharacter(character.id)}
                                onRemove={() => handleRemoveCharacter(character.id)}
                            />
                        </div>
                    {/snippet}
                </EntityList>
            </div>

            <div class="flex items-center gap-2 border-b border-sidebar-border p-3">
                <div class="relative flex-1">
                    <Search
                        class="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                        bind:value={chatSearch}
                        placeholder={$t('library.room.searchChats')}
                        class="h-8 pl-8 text-xs"
                    />
                </div>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    class="shrink-0"
                    title={$t('library.room.newChatButton')}
                    aria-label={$t('library.room.newChatButton')}
                    disabled={panelAction !== null}
                    aria-busy={panelAction === 'create-chat'}
                    onclick={handleCreateChat}
                >
                    <Plus class="size-4" />
                </Button>
            </div>

            <div class="flex-1 overflow-y-auto p-2">
                <div class="flex flex-col gap-1">
                    <EntityList
                        entities={filteredChats()}
                        config={$activeRoom.chats}
                        layout="list"
                        onItemClick={(chat) => handleSelectChat(chat.id)}
                        onCreateFolder={(name, parentId, sortOrder) =>
                            createRoomFolder($activeRoom.id, 'chats', name, parentId, sortOrder)}
                        onUpdateFolder={(id, changes) =>
                            updateRoomFolder($activeRoom.id, 'chats', id, changes)}
                        onDeleteFolder={(id) => deleteRoomFolder($activeRoom.id, 'chats', id)}
                        onMoveItem={(itemId, newFolderId, newSortOrder) =>
                            moveRoomItem(
                                $activeRoom.id,
                                'chats',
                                itemId,
                                newFolderId,
                                newSortOrder
                            )}
                    >
                        {#snippet empty()}
                            <EmptyListPlaceholder message={$t('library.room.noChats')} />
                        {/snippet}
                        {#snippet folder({ folder: f, collapsed, toggle, parts })}
                            <div
                                role="button"
                                tabindex="0"
                                aria-expanded={!collapsed}
                                aria-label={f.name}
                                class="relative group/folder flex items-center justify-between rounded-md px-2 py-2 text-sm select-none cursor-pointer transition-colors hover:bg-sidebar-accent/50 w-full"
                                onclick={toggle}
                                onkeydown={(event) => {
                                    if (event.target !== event.currentTarget) return;
                                    if (event.key !== 'Enter' && event.key !== ' ') return;
                                    event.preventDefault();
                                    toggle();
                                }}
                            >
                                <div class="flex items-center gap-2 min-w-0 flex-1">
                                    {#if collapsed}
                                        <Folder
                                            strokeWidth={2.5}
                                            class="size-4 shrink-0 {f.color
                                                ? getFolderColorClass(f.color)
                                                : ''}"
                                        />
                                    {:else}
                                        <FolderOpen
                                            strokeWidth={2.5}
                                            class="size-4 shrink-0 {f.color
                                                ? getFolderColorClass(f.color)
                                                : ''}"
                                        />
                                    {/if}
                                    <div class="flex-1 min-w-0 text-foreground">
                                        {@render parts.name({ folder: f })}
                                    </div>
                                </div>
                                <div class="ml-2">
                                    {@render parts.actions({ folder: f })}
                                </div>
                            </div>
                        {/snippet}
                        {#snippet item({ entity: chat })}
                            {@const selected = route.chatId === chat.id}
                            {@const taskIndicator = getChatTaskIndicator($collectedTasks, chat.id)}
                            <div
                                class="chat-row group rounded-md px-2 py-2 text-sm transition-colors {selected
                                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                                    : 'hover:bg-sidebar-accent/50'}"
                            >
                                {#if editingChatId === chat.id}
                                    <form
                                        class="flex gap-1"
                                        onsubmit={(event) => {
                                            event.preventDefault();
                                            handleRenameChat(chat.id);
                                        }}
                                    >
                                        <Input
                                            bind:value={editingChatTitle}
                                            class="h-7 flex-1 text-xs text-foreground bg-background"
                                            autofocus
                                            onkeydown={(event) => {
                                                if (event.key === 'Escape') {
                                                    editingChatId = null;
                                                    editingChatTitle = '';
                                                }
                                            }}
                                        />
                                        <Button
                                            type="submit"
                                            size="icon-sm"
                                            aria-label={$t('library.room.rename.save')}
                                            disabled={panelAction !== null}
                                            aria-busy={panelAction === `rename-chat:${chat.id}`}
                                        >
                                            <Check class="size-3" />
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-sm"
                                            aria-label={$t('library.room.rename.cancel')}
                                            disabled={panelAction !== null}
                                            onclick={() => {
                                                editingChatId = null;
                                                editingChatTitle = '';
                                            }}
                                        >
                                            <X class="size-3" />
                                        </Button>
                                    </form>
                                {:else}
                                    <div
                                        class="flex h-7 items-center justify-between gap-2 min-w-0"
                                    >
                                        <div
                                            class="chat-row-title flex min-w-0 flex-1 items-center gap-2 text-left pr-2 transition-[padding] duration-150 group-hover:pr-23 group-has-focus-visible:pr-23"
                                        >
                                            <MessageSquare
                                                class="size-3.5 shrink-0 text-muted-foreground"
                                            />
                                            <span class="min-w-0 flex-1 truncate text-foreground">
                                                <TypewriterText
                                                    text={chat.title ||
                                                        $t('library.room.untitledChat')}
                                                />
                                            </span>
                                        </div>

                                        {#if taskIndicator}
                                            <div
                                                class="chat-row-task-status pointer-events-none shrink-0 flex items-center justify-center transition-opacity"
                                            >
                                                {#if taskIndicator === 'running'}
                                                    <Loader2
                                                        class="size-3.5 animate-spin text-primary"
                                                        role="status"
                                                        aria-label={$t('library.room.taskRunning')}
                                                    />
                                                {:else if taskIndicator === 'error'}
                                                    <span
                                                        class="size-2 rounded-full bg-destructive"
                                                        role="status"
                                                        aria-label={$t('library.room.taskFailed')}
                                                    ></span>
                                                {:else if taskIndicator === 'completed'}
                                                    <span
                                                        class="size-2 rounded-full bg-emerald-500"
                                                        role="status"
                                                        aria-label={$t(
                                                            'library.room.taskCompleted'
                                                        )}
                                                    ></span>
                                                {/if}
                                            </div>
                                        {/if}

                                        <div
                                            class="chat-row-desktop-actions pointer-events-none absolute inset-y-0.5 right-1 flex items-center gap-0.5 rounded-r-md bg-inherit pl-1.5 opacity-0 transition-opacity"
                                        >
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-sm"
                                                class="text-muted-foreground hover:bg-muted hover:text-foreground"
                                                title={$t('library.room.generateTitleButton')}
                                                aria-label={$t('library.room.generateTitleNamed', {
                                                    name:
                                                        chat.title ||
                                                        $t('library.room.untitledChat')
                                                })}
                                                disabled={panelAction !== null ||
                                                    chat.messageCount === 0 ||
                                                    $titleTasks.get(chat.id)?.status ===
                                                        'generating'}
                                                aria-busy={$titleTasks.get(chat.id)?.status ===
                                                    'generating'}
                                                onclick={() => handleGenerateTitle(chat.id)}
                                            >
                                                <Wand2 class="size-3.5" />
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-sm"
                                                class="text-muted-foreground hover:bg-muted hover:text-foreground"
                                                title={$t('library.room.renameChatButton')}
                                                aria-label={$t('library.room.renameChatNamed', {
                                                    name:
                                                        chat.title ||
                                                        $t('library.room.untitledChat')
                                                })}
                                                disabled={panelAction !== null}
                                                onclick={() =>
                                                    startRenameChat(
                                                        chat.id,
                                                        chat.title ||
                                                            $t('library.room.untitledChat')
                                                    )}
                                            >
                                                <Edit3 class="size-3.5" />
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-sm"
                                                class="text-destructive hover:bg-destructive/10"
                                                title={$t('library.room.deleteChatButton')}
                                                aria-label={$t('library.room.deleteChatNamed', {
                                                    name:
                                                        chat.title ||
                                                        $t('library.room.untitledChat')
                                                })}
                                                disabled={panelAction !== null}
                                                aria-busy={panelAction === `delete-chat:${chat.id}`}
                                                onclick={() => handleDeleteChat(chat.id)}
                                            >
                                                <Trash2 class="size-3.5" />
                                            </Button>
                                        </div>

                                        <div
                                            class="chat-row-touch-menu shrink-0 hidden items-center"
                                        >
                                            <DropdownMenu.Root
                                                open={openChatMenuId === chat.id}
                                                onOpenChange={(open) =>
                                                    (openChatMenuId = open ? chat.id : null)}
                                            >
                                                <DropdownMenu.Trigger>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon-sm"
                                                        class="relative text-muted-foreground after:absolute after:-inset-2"
                                                        aria-label={$t('library.room.chatActions', {
                                                            name:
                                                                chat.title ||
                                                                $t('library.room.untitledChat')
                                                        })}
                                                        disabled={panelAction !== null}
                                                    >
                                                        <MoreVertical class="size-3.5" />
                                                    </Button>
                                                </DropdownMenu.Trigger>
                                                <DropdownMenu.Content
                                                    align="end"
                                                    sideOffset={4}
                                                    class="w-40"
                                                >
                                                    <DropdownMenu.Item
                                                        class="cursor-pointer"
                                                        disabled={panelAction !== null ||
                                                            chat.messageCount === 0 ||
                                                            $titleTasks.get(chat.id)?.status ===
                                                                'generating'}
                                                        onclick={() => handleGenerateTitle(chat.id)}
                                                    >
                                                        <Wand2 class="size-4" />
                                                        {$t('library.room.generateTitleButton')}
                                                    </DropdownMenu.Item>
                                                    <DropdownMenu.Item
                                                        class="cursor-pointer"
                                                        disabled={panelAction !== null}
                                                        onclick={() =>
                                                            startRenameChat(
                                                                chat.id,
                                                                chat.title ||
                                                                    $t('library.room.untitledChat')
                                                            )}
                                                    >
                                                        <Edit3 class="size-4" />
                                                        {$t('library.room.renameChatButton')}
                                                    </DropdownMenu.Item>
                                                    <DropdownMenu.Separator />
                                                    <DropdownMenu.Item
                                                        class="cursor-pointer"
                                                        variant="destructive"
                                                        disabled={panelAction !== null}
                                                        aria-busy={panelAction ===
                                                            `delete-chat:${chat.id}`}
                                                        onclick={() => handleDeleteChat(chat.id)}
                                                    >
                                                        <Trash2 class="size-4" />
                                                        {$t('library.room.deleteChatButton')}
                                                    </DropdownMenu.Item>
                                                </DropdownMenu.Content>
                                            </DropdownMenu.Root>
                                        </div>
                                    </div>
                                {/if}
                            </div>
                        {/snippet}
                    </EntityList>
                </div>
            </div>

            {#if $activePreset && toggleSources.length > 0}
                <div class="max-h-[40%] min-h-0 overflow-y-auto border-t border-sidebar-border p-3">
                    <p class="mb-2 text-[11px] font-semibold uppercase text-muted-foreground">
                        {$t('settings.chat.tabs.toggles')}
                    </p>
                    <div class="flex flex-col gap-3">
                        {#each toggleSources as source (`${source.owner.type}:${source.owner.id}`)}
                            <section class="flex flex-col gap-1.5">
                                {#if source.owner.type === 'module'}
                                    <p class="text-[10px] font-medium text-muted-foreground">
                                        {source.name}
                                    </p>
                                {/if}
                                <TogglePanelRuntime panel={source.panel} owner={source.owner} />
                            </section>
                        {/each}
                    </div>
                </div>
            {/if}
        </div>
    </div>
{/if}

<style>
    .app-sidebar-room-panel {
        container: room-panel / inline-size;
    }

    :global(.room-panel-character-grid) {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    @container room-panel (min-width: 20rem) {
        :global(.room-panel-character-grid) {
            grid-template-columns: repeat(3, minmax(0, 1fr));
        }
    }

    @media (hover: hover) {
        .chat-row:hover .chat-row-task-status,
        .chat-row:has(:focus-visible) .chat-row-task-status {
            opacity: 0;
            pointer-events: none;
        }

        .chat-row:hover .chat-row-desktop-actions,
        .chat-row:has(:focus-visible) .chat-row-desktop-actions {
            opacity: 1;
            pointer-events: auto;
        }
    }

    @media (hover: none), (pointer: coarse) {
        .chat-row-desktop-actions {
            display: none !important;
        }

        .chat-row-touch-menu {
            display: flex !important;
        }
    }
</style>
