<script lang="ts">
    import {
        Check,
        Edit3,
        Folder,
        FolderOpen,
        MessageSquare,
        Pin,
        Plus,
        Search,
        Trash2,
        UserRound,
        X
    } from 'lucide-svelte';
    import AssetView from '$lib/components/AssetView.svelte';
    import EmptyListPlaceholder from '$lib/components/EmptyListPlaceholder.svelte';
    import MediaEntityCard from '$lib/components/entitylist/MediaEntityCard.svelte';
    import ParticipantCardMenu from '$lib/components/ParticipantCardMenu.svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import {
        activeChat,
        activePreset,
        activeRoom,
        appSettings,
        chatSelections,
        createChat,
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
        updateChat,
        updateRoom,
        updateRoomFolder
    } from '$lib/stores';
    import { appAlert, appConfirm, characterPickerOpen, toast } from '$lib/ui';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
    import { getFolderColorClass } from '$lib/components/entitylist/folders';
    import TogglePanelRuntime from '$lib/components/toggles/TogglePanelRuntime.svelte';
    import type { RouteState } from '$lib/router';
    import {
        navigateToCharacterStudio,
        resolveToggleSources,
        syncChatGreetings
    } from '$lib/managers';
    import { getErrorMessage } from '$lib/types/errors';

    interface Props {
        route: RouteState;
        onNavigate: (route: RouteState) => void;
    }

    let { route, onNavigate }: Props = $props();

    let chatSearch = $state('');
    let editingChatId = $state<string | null>(null);
    let editingChatTitle = $state('');
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
        await runPanelAction('create-chat', 'Could not create chat', async () => {
            const chat = await createChat(roomId, {
                title: `New Chat ${$roomChats.length + 1}`
            });
            await syncChatGreetings(chat.id);
            if ($activeRoom?.id === roomId) {
                onNavigate({ view: 'room', roomId, chatId: chat.id });
            }
        });
    }

    function handleOpenCharacter(characterId: string): void {
        void runPanelAction(`open-character:${characterId}`, 'Could not open character', () =>
            navigateToCharacterStudio(characterId)
        );
    }

    async function handleSelectCharacter(characterId: string): Promise<void> {
        if (!$activeChat) return;
        const chatId = $activeChat.id;
        await runPanelAction(`select-character:${characterId}`, 'Could not select character', () =>
            setChatSelectedCharacter(chatId, characterId)
        );
    }

    async function handleSetDefaultCharacter(characterId: string): Promise<void> {
        if (!$activeChat) return;
        const chatId = $activeChat.id;
        await runPanelAction(
            `default-character:${characterId}`,
            'Could not set default character',
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
            'Could not remove character',
            async () => {
                const confirmed = await appConfirm({
                    title: 'Remove character from room?',
                    description: `Remove "${character?.name ?? 'this character'}" from this room?`,
                    confirmText: 'Remove',
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
        await runPanelAction(`select-chat:${chatId}`, 'Could not open chat', async () => {
            await syncChatGreetings(chatId);
            if ($activeRoom?.id === roomId) onNavigate({ view: 'room', roomId, chatId });
        });
    }

    async function handleRenameChat(chatId: string): Promise<void> {
        const title = editingChatTitle.trim();
        if (!title) return;

        await runPanelAction(`rename-chat:${chatId}`, 'Could not rename chat', async () => {
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
        await runPanelAction('rename-room', 'Could not rename room', async () => {
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
        await runPanelAction('delete-room', 'Could not delete room', async () => {
            const confirmed = await appConfirm({
                title: 'Delete room?',
                description: `Delete room "${roomName}"?`,
                confirmText: 'Delete',
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
        await runPanelAction(`delete-chat:${chatId}`, 'Could not delete chat', async () => {
            if ($roomChats.length <= 1) {
                await appAlert({
                    title: 'Cannot delete chat',
                    description: 'A room must contain at least one chat.'
                });
                return;
            }
            const confirmed = await appConfirm({
                title: 'Delete chat?',
                description: `Delete "${chat?.title || 'Untitled Chat'}" and its messages?`,
                confirmText: 'Delete',
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
                            aria-label="Save room name"
                            disabled={panelAction !== null}
                            aria-busy={panelAction === 'rename-room'}
                        >
                            <Check class="size-3.5" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Cancel room rename"
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
                            Multi Room
                        </span>
                    {/if}
                    {#if !$isMultiRoom}
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            class="shrink-0 text-muted-foreground"
                            title="Rename room"
                            aria-label="Rename room"
                            disabled={panelAction !== null}
                            onclick={startRenameRoom}
                        >
                            <Edit3 class="size-3.5" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            class="shrink-0 text-muted-foreground hover:text-destructive"
                            title="Delete room"
                            aria-label={`Delete ${$activeRoom.name}`}
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
                        <UserRound class="size-3" /> Characters
                    </p>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        class="text-muted-foreground hover:text-foreground"
                        title="Add characters"
                        aria-label="Add characters"
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
                            <EmptyListPlaceholder message="No characters." />
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
                                        <AssetView
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
                                                title="Default character"
                                                aria-label={`${character.name} is the default character`}
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
                        placeholder="Search chats..."
                        class="h-8 pl-8 text-xs"
                    />
                </div>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    class="shrink-0"
                    title="New chat"
                    aria-label="New chat"
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
                            <EmptyListPlaceholder message="No chats yet." />
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
                            <div
                                class="group rounded-md px-2 py-2 text-sm transition-colors {selected
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
                                            aria-label="Save chat name"
                                            disabled={panelAction !== null}
                                            aria-busy={panelAction === `rename-chat:${chat.id}`}
                                        >
                                            <Check class="size-3" />
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-sm"
                                            aria-label="Cancel chat rename"
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
                                    <div class="flex items-center gap-2">
                                        <div
                                            class="flex min-w-0 flex-1 items-center gap-2 text-left"
                                        >
                                            <MessageSquare class="size-3.5 shrink-0" />
                                            <span class="min-w-0 flex-1 truncate text-foreground">
                                                {chat.title || 'Untitled Chat'}
                                            </span>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-sm"
                                            class="touch-visible text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                                            title="Rename chat"
                                            aria-label={`Rename ${chat.title || 'Untitled Chat'}`}
                                            disabled={panelAction !== null}
                                            onclick={() =>
                                                startRenameChat(
                                                    chat.id,
                                                    chat.title || 'Untitled Chat'
                                                )}
                                        >
                                            <Edit3 class="size-3.5" />
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-sm"
                                            class="touch-visible text-destructive opacity-0 transition-opacity hover:bg-destructive/10 group-hover:opacity-100 focus-visible:opacity-100"
                                            title="Delete chat"
                                            aria-label={`Delete ${chat.title || 'Untitled Chat'}`}
                                            disabled={panelAction !== null}
                                            aria-busy={panelAction === `delete-chat:${chat.id}`}
                                            onclick={() => handleDeleteChat(chat.id)}
                                        >
                                            <Trash2 class="size-3.5" />
                                        </Button>
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
                        Toggles
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
</style>
