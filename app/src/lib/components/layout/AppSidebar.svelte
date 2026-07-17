<script lang="ts">
    import {
        Check,
        ChevronDown,
        ChevronLeft,
        ChevronRight,
        Cloud,
        CloudOff,
        Edit3,
        Folder,
        FolderOpen,
        Home,
        LoaderCircle,
        LockKeyhole,
        MessageSquare,
        Pin,
        Plus,
        Search,
        Settings,
        RefreshCw,
        Trash2,
        User,
        UserCircle,
        UserPlus,
        UsersRound,
        X
    } from 'lucide-svelte';
    import AssetView from '$lib/components/AssetView.svelte';
    import EmptyListPlaceholder from '$lib/components/EmptyListPlaceholder.svelte';
    import ParticipantCardMenu from '$lib/components/ParticipantCardMenu.svelte';
    import RoomAvatar from '$lib/components/RoomAvatar.svelte';
    import { Button } from '$lib/components/ui/button';
    import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
    import { Input } from '$lib/components/ui/input';
    import {
        activeChat,
        activeUser,
        activePreset,
        activeRoom,
        assetSyncStatus,
        appSettings,
        chatSelections,
        createChat,
        createGlobalFolder,
        createRoomFolder,
        deleteChat,
        deleteGlobalFolder,
        deleteRoomFolder,
        dataSyncStatus,
        isMultiRoom,
        isSyncLinked,
        localUsers,
        serverTransitionLocked,
        multiSyncStatus,
        moveGlobalItem,
        moveRoomItem,
        removeRoomCharacter,
        roomChats,
        roomCharacters,
        rooms,
        setChatDefaultCharacter,
        setChatSelectedCharacter,
        updateChat,
        updateGlobalFolder,
        updateRoom,
        updateRoomFolder,
        userSyncStatus,
        loadLocalUsers,
        switchLocalUser,
        createAndSwitchLocalUser
    } from '$lib/stores';
    import { appConfirm, characterPickerOpen, toast } from '$lib/ui';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
    import { getFolderColorClass } from '$lib/components/entitylist/folders';
    import { setGlobalVariable } from '$lib/managers';
    import type { RouteState } from '$lib/router';
    import { syncChatGreetings } from '$lib/managers';
    import { compareSortOrder } from '$lib/utils/ordering';
    import { getErrorMessage } from '$lib/types/errors';
    import { SyncManager, type SyncStatus } from '$lib/services/sync';

    interface Props {
        collapsed?: boolean;
        route: RouteState;
        onToggle: () => void;
        onNavigate: (route: RouteState) => void;
    }

    type SyncIndicatorState = SyncStatus['state'] | 'server-transition';

    const SYNC_ICON_DELAY_MS = 400;
    const SYNC_ICON_MIN_VISIBLE_MS = 500;

    let { collapsed = false, route, onToggle, onNavigate }: Props = $props();

    let chatSearch = $state('');
    let editingChatId = $state<string | null>(null);
    let editingChatTitle = $state('');
    let editingRoomName = $state(false);
    let roomNameDraft = $state('');
    let switchingUserId = $state<string | null>(null);
    let creatingUser = $state(false);
    let retryingSync = $state(false);
    let sidebarAction = $state<string | null>(null);
    let syncIconState = $state<SyncIndicatorState>('idle');
    let syncIconStartedAt = 0;

    const syncState = $derived.by(() => {
        if ($serverTransitionLocked) return 'server-transition';
        const states = [
            $dataSyncStatus.state,
            $userSyncStatus.state,
            $assetSyncStatus.state,
            $multiSyncStatus.state
        ];
        if (states.includes('auth_error')) return 'auth_error';
        if (states.includes('quota_error')) return 'quota_error';
        if (states.includes('network_error')) return 'network_error';
        if (states.includes('syncing')) return 'syncing';
        return 'idle';
    });
    const syncLabel = $derived(
        syncState === 'server-transition'
            ? 'Server change in progress'
            : syncState === 'syncing'
              ? 'Syncing encrypted data'
              : syncState === 'network_error'
                ? 'Sync paused: network unavailable. Activate to retry.'
                : syncState === 'quota_error'
                  ? 'Sync paused: remote storage quota reached. Activate to retry.'
                  : syncState === 'auth_error'
                    ? 'Sync paused: sign-in needs attention. Activate to retry.'
                    : 'Encrypted data is synced. Activate to sync now.'
    );

    $effect(() => {
        const nextState = syncState;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const showState = (state: SyncIndicatorState): void => {
            syncIconState = state;
            syncIconStartedAt = state === 'syncing' ? Date.now() : 0;
        };

        if (nextState === 'syncing' && syncIconState !== 'syncing') {
            timer = setTimeout(() => showState('syncing'), SYNC_ICON_DELAY_MS);
        } else if (nextState === 'idle' && syncIconState === 'syncing') {
            const remaining = SYNC_ICON_MIN_VISIBLE_MS - (Date.now() - syncIconStartedAt);
            if (remaining > 0) timer = setTimeout(() => showState('idle'), remaining);
            else showState('idle');
        } else {
            showState(nextState);
        }

        return () => {
            if (timer) clearTimeout(timer);
        };
    });

    function syncStatusLabel(status: SyncStatus): string {
        if (status.state === 'syncing') return 'Syncing';
        if (status.state === 'network_error') return 'Network error';
        if (status.state === 'quota_error') return 'Quota error';
        if (status.state === 'auth_error') return 'Authentication error';
        return 'Up to date';
    }

    function syncStatusColor(status: SyncStatus): string {
        if (status.state === 'syncing') return 'bg-blue-500';
        if (status.state === 'idle') return 'bg-green-500';
        return 'bg-destructive';
    }

    function syncProgressLabel(status: SyncStatus): string | null {
        if (status.progress) {
            return `${status.progress.completed}/${status.progress.total}`;
        }
        return null;
    }

    const filteredChats = $derived(() => {
        const query = chatSearch.trim().toLowerCase();
        if (!query) return $roomChats;
        return $roomChats.filter((chat) => chat.title.toLowerCase().includes(query));
    });

    const otherUsers = $derived(() =>
        $localUsers.filter((user) => user.id !== $activeUser?.id).reverse()
    );

    $effect(() => {
        void loadLocalUsers();
    });

    async function handleSync(): Promise<void> {
        if (retryingSync || syncState === 'syncing') return;
        retryingSync = true;
        try {
            await SyncManager.syncAll();
        } catch (error) {
            toast.error({ title: 'Could not sync', description: getErrorMessage(error) });
        } finally {
            retryingSync = false;
        }
    }

    async function runSidebarAction(
        key: string,
        errorTitle: string,
        action: () => void | Promise<void>
    ): Promise<void> {
        if (sidebarAction) return;
        sidebarAction = key;
        try {
            await action();
        } catch (error) {
            toast.error({ title: errorTitle, description: getErrorMessage(error) });
        } finally {
            sidebarAction = null;
        }
    }

    async function handleCreateChat() {
        if (!$activeRoom) return;
        const roomId = $activeRoom.id;
        await runSidebarAction('create-chat', 'Could not create chat', async () => {
            const chat = await createChat(roomId, {
                title: `New Chat ${$roomChats.length + 1}`
            });
            await syncChatGreetings(chat.id);
            if ($activeRoom?.id === roomId) {
                onNavigate({ view: 'room', roomId, chatId: chat.id });
            }
        });
    }

    function handleSelectRoom(roomId: string) {
        onNavigate({ view: 'room', roomId });
    }

    function handleOpenCharacter(characterId: string) {
        onNavigate({ view: 'characterStudio', charId: characterId });
    }

    async function handleSelectCharacter(characterId: string) {
        if (!$activeChat) return;
        const chatId = $activeChat.id;
        await runSidebarAction(
            `select-character:${characterId}`,
            'Could not select character',
            () => setChatSelectedCharacter(chatId, characterId)
        );
    }

    async function handleSetDefaultCharacter(characterId: string) {
        if (!$activeChat) return;
        const chatId = $activeChat.id;
        await runSidebarAction(
            `default-character:${characterId}`,
            'Could not set default character',
            () => setChatDefaultCharacter(chatId, characterId)
        );
    }

    async function handleRemoveCharacter(characterId: string) {
        if (!$activeRoom) return;
        const roomId = $activeRoom.id;
        const chatId = $activeChat?.id;
        const character = $roomCharacters.find((item) => item.id === characterId);
        await runSidebarAction(
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

    async function handleSelectChat(chatId: string) {
        if (!$activeRoom) return;
        const roomId = $activeRoom.id;
        await runSidebarAction(`select-chat:${chatId}`, 'Could not open chat', async () => {
            await syncChatGreetings(chatId);
            if ($activeRoom?.id === roomId) onNavigate({ view: 'room', roomId, chatId });
        });
    }

    async function handleRenameChat(chatId: string) {
        const title = editingChatTitle.trim();
        if (!title) return;

        await runSidebarAction(`rename-chat:${chatId}`, 'Could not rename chat', async () => {
            await updateChat(chatId, { title });
            editingChatId = null;
            editingChatTitle = '';
        });
    }

    async function handleRenameRoom() {
        if (!$activeRoom || $isMultiRoom) return;
        const name = roomNameDraft.trim();
        if (!name) return;
        const roomId = $activeRoom.id;
        await runSidebarAction('rename-room', 'Could not rename room', async () => {
            await updateRoom(roomId, { name });
            editingRoomName = false;
            roomNameDraft = '';
        });
    }

    function startRenameRoom() {
        if (!$activeRoom || $isMultiRoom) return;
        roomNameDraft = $activeRoom.name;
        editingRoomName = true;
    }

    async function handleDeleteChat(chatId: string) {
        if (!$activeRoom) return;
        const roomId = $activeRoom.id;
        const chat = $roomChats.find((item) => item.id === chatId);
        await runSidebarAction(`delete-chat:${chatId}`, 'Could not delete chat', async () => {
            const confirmed = await appConfirm({
                title: 'Delete chat?',
                description: `Delete "${chat?.title || 'Untitled Chat'}" and its messages?`,
                confirmText: 'Delete',
                variant: 'destructive'
            });
            if (!confirmed || $activeRoom?.id !== roomId) return;
            await deleteChat(chatId, roomId);
            if ($activeRoom?.id === roomId && $activeChat?.id === chatId) {
                onNavigate({ view: 'room', roomId });
            }
        });
    }

    async function handleToggleChange(key: string, value: string) {
        try {
            await setGlobalVariable(`toggle_${key}`, value);
        } catch (error) {
            toast.error({
                title: 'Could not update variable',
                description: getErrorMessage(error)
            });
        }
    }

    async function handleSwitchUser(userId: string) {
        if ($serverTransitionLocked || switchingUserId || creatingUser) return;
        switchingUserId = userId;
        try {
            await switchLocalUser(userId);
        } catch (error) {
            toast.error({ title: 'Could not switch user', description: getErrorMessage(error) });
        } finally {
            switchingUserId = null;
        }
    }

    async function handleCreateUser() {
        if ($serverTransitionLocked || switchingUserId || creatingUser) return;
        creatingUser = true;
        try {
            await createAndSwitchLocalUser();
        } catch (error) {
            toast.error({ title: 'Could not create user', description: getErrorMessage(error) });
        } finally {
            creatingUser = false;
        }
    }

    function startRenameChat(chatId: string, title: string) {
        editingChatId = chatId;
        editingChatTitle = title;
    }

    function initial(name: string): string {
        return (name.trim().charAt(0) || '?').toUpperCase();
    }
</script>

{#snippet syncStatusRow(label: string, status: SyncStatus)}
    {@const progress = syncProgressLabel(status)}
    <div class="flex items-center gap-2 px-2 py-1.5 text-xs">
        <span class={`size-2 shrink-0 rounded-full ${syncStatusColor(status)}`}></span>
        <span class="min-w-0 flex-1 font-medium">{label}</span>
        <span class="text-muted-foreground">{syncStatusLabel(status)}</span>
        {#if progress}
            <span class="min-w-10 text-right font-mono text-muted-foreground">{progress}</span>
        {/if}
    </div>
{/snippet}

{#if !collapsed}
    <button
        type="button"
        class="fixed inset-0 z-30 bg-black/35 lg:hidden"
        aria-label="Close room panel"
        onclick={onToggle}
    ></button>
{/if}

<aside
    data-compact-open={!collapsed}
    class="app-sidebar relative z-20 flex h-full shrink-0 bg-sidebar text-sidebar-foreground {collapsed
        ? 'border-r max-lg:z-20 max-lg:w-0 max-lg:border-0'
        : 'border-r max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-40 max-lg:shadow-xl'}"
>
    <div
        class="flex w-14 flex-col border-r border-sidebar-border bg-sidebar {collapsed
            ? 'max-lg:hidden'
            : ''}"
    >
        <div class="flex h-14 items-center justify-center border-b border-sidebar-border">
            <Button
                variant={route.view === 'home' ? 'secondary' : 'ghost'}
                size="icon"
                class="size-9"
                title="Library"
                aria-label="Library"
                onclick={() => onNavigate({ view: 'home' })}
            >
                <Home class="size-4" />
            </Button>
        </div>

        <div class="flex-1 overflow-y-auto px-2 py-2">
            <div class="flex flex-col items-center gap-2 w-full">
                <Button
                    variant={route.view === 'multiRoom' || $isMultiRoom ? 'secondary' : 'ghost'}
                    size="icon"
                    class="size-10"
                    title="Multi Rooms"
                    aria-label="Multi Rooms"
                    onclick={() => onNavigate({ view: 'multiRoom' })}
                >
                    <UsersRound class="size-4" />
                </Button>
                <div class="h-px w-8 bg-sidebar-border"></div>
                {#if $appSettings}
                    <EntityList
                        entities={$rooms}
                        config={$appSettings.rooms}
                        layout="list"
                        gridClass="flex flex-col gap-2 items-center w-full"
                        listClass="flex flex-col gap-2 items-center w-full"
                        childContainerClass="relative my-1 py-1.5 flex flex-col gap-2 items-center w-full"
                        onItemClick={(room) => handleSelectRoom(room.id)}
                        onCreateFolder={(name, parentId, sortOrder) =>
                            createGlobalFolder('rooms', name, parentId, sortOrder)}
                        onUpdateFolder={(id, changes) => updateGlobalFolder('rooms', id, changes)}
                        onDeleteFolder={(id) => deleteGlobalFolder('rooms', id)}
                        onMoveItem={(itemId, newFolderId, newSortOrder) =>
                            moveGlobalItem('rooms', itemId, newFolderId, newSortOrder)}
                    >
                        {#snippet folder({ folder: f, collapsed, toggle })}
                            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
                            <div
                                class="relative flex size-10 items-center justify-center overflow-hidden rounded-md border transition-colors select-none cursor-pointer
                                    {f.color
                                    ? getFolderColorClass(f.color)
                                    : 'border-transparent bg-muted/30 text-foreground hover:bg-muted/50 hover:border-sidebar-border'}"
                                onclick={toggle}
                                title={f.name}
                            >
                                {#if collapsed}
                                    <Folder strokeWidth={2.5} class="size-4 text-inherit" />
                                {:else}
                                    <FolderOpen strokeWidth={2.5} class="size-4 text-inherit" />
                                {/if}
                            </div>
                        {/snippet}

                        {#snippet item({ entity: room })}
                            {@const selected = route.roomId === room.id}
                            <div
                                class="relative flex size-10 items-center justify-center rounded-md border bg-background text-xs font-semibold transition-colors {selected
                                    ? 'border-primary ring-2 ring-primary/20'
                                    : 'border-transparent hover:border-sidebar-border'} group"
                                title={room.name}
                            >
                                <RoomAvatar {room} class="size-full" />
                            </div>
                        {/snippet}
                    </EntityList>
                {/if}
            </div>
        </div>

        <div class="flex flex-col items-center gap-2 border-t border-sidebar-border p-2">
            {#if $isSyncLinked || $serverTransitionLocked}
                <DropdownMenu.Root>
                    <DropdownMenu.Trigger>
                        <Button
                            variant="ghost"
                            size="icon"
                            class="size-9"
                            title={syncLabel}
                            aria-label={`View sync status: ${syncLabel}`}
                            aria-busy={retryingSync || syncState === 'syncing'}
                        >
                            {#if syncIconState === 'server-transition'}
                                <LockKeyhole
                                    class="size-4 text-amber-600 dark:text-amber-400"
                                    aria-hidden="true"
                                />
                            {:else if syncIconState === 'syncing'}
                                <LoaderCircle class="size-4 animate-spin" aria-hidden="true" />
                            {:else if syncIconState === 'idle'}
                                <Cloud
                                    class="size-4 text-green-600 dark:text-green-400"
                                    aria-hidden="true"
                                />
                            {:else}
                                <CloudOff class="size-4 text-destructive" aria-hidden="true" />
                            {/if}
                        </Button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content side="right" align="end" sideOffset={10} class="w-72 p-1">
                        <DropdownMenu.Label class="px-2 py-1.5 text-xs"
                            >Sync status</DropdownMenu.Label
                        >
                        {#if $serverTransitionLocked}
                            <div class="mx-1 mb-1 rounded-md bg-amber-500/10 px-2.5 py-2 text-xs">
                                <p class="font-medium text-amber-700 dark:text-amber-300">
                                    Server change in progress
                                </p>
                                <p class="mt-1 leading-4 text-muted-foreground">
                                    Sync is paused until the server change finishes.
                                </p>
                            </div>
                            <DropdownMenu.Separator />
                        {/if}
                        {@render syncStatusRow('User', $userSyncStatus)}
                        {@render syncStatusRow('Records', $dataSyncStatus)}
                        {@render syncStatusRow('Assets', $assetSyncStatus)}
                        {@render syncStatusRow('Multi-room', $multiSyncStatus)}
                        <DropdownMenu.Separator />
                        <DropdownMenu.Item
                            class="cursor-pointer gap-2"
                            disabled={$serverTransitionLocked ||
                                retryingSync ||
                                syncState === 'syncing'}
                            onclick={() => void handleSync()}
                        >
                            <RefreshCw class="size-4" />
                            {retryingSync || syncState === 'syncing' ? 'Syncing...' : 'Sync now'}
                        </DropdownMenu.Item>
                    </DropdownMenu.Content>
                </DropdownMenu.Root>
            {/if}
            <Button
                variant="ghost"
                size="icon"
                class="size-9"
                title="Settings"
                aria-label="Settings"
                onclick={() => onNavigate({ view: 'settings' })}
            >
                <Settings class="size-4" />
            </Button>
            <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                    <Button
                        variant="ghost"
                        size="icon"
                        class="size-9 overflow-hidden rounded-md"
                        title={$activeUser?.name ?? 'Current user'}
                        aria-label={`Current user: ${$activeUser?.name ?? 'Unknown'}`}
                    >
                        {#if $activeUser?.avatar}
                            <img
                                src={$activeUser.avatar}
                                alt={$activeUser.name}
                                class="size-6 rounded-full object-cover"
                            />
                        {:else}
                            <UserCircle class="size-4" />
                        {/if}
                    </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content
                    side="right"
                    align="end"
                    sideOffset={10}
                    class="w-56 px-1 py-0"
                >
                    {#if $activeUser}
                        <DropdownMenu.Item
                            class="flex cursor-pointer items-center gap-2.5 rounded-none px-2.5 py-1.5 my-1 text-sm"
                            disabled={$serverTransitionLocked ||
                                creatingUser ||
                                switchingUserId !== null}
                            onclick={() => onNavigate({ view: 'settings', settingsTab: 'profile' })}
                        >
                            <img
                                src={$activeUser.avatar}
                                alt={$activeUser.name}
                                class="size-7 shrink-0 rounded-full object-cover ring-2 ring-primary/25"
                            />
                            <div class="min-w-0 flex-1">
                                <p class="truncate font-medium">{$activeUser.name}</p>
                                <p class="truncate text-[11px] text-muted-foreground">Current</p>
                            </div>
                        </DropdownMenu.Item>
                    {/if}

                    {#if otherUsers().length > 0}
                        <DropdownMenu.Separator class="my-1" />
                        {#each otherUsers() as user (user.id)}
                            <DropdownMenu.Item
                                class="flex cursor-pointer items-center gap-2.5 rounded-none px-2.5 py-1.5 my-1 text-sm"
                                disabled={$serverTransitionLocked ||
                                    creatingUser ||
                                    switchingUserId !== null}
                                onclick={() => handleSwitchUser(user.id)}
                            >
                                <img
                                    src={user.avatar}
                                    alt={user.name}
                                    class="size-7 shrink-0 rounded-full object-cover"
                                />
                                <div class="min-w-0 flex-1">
                                    <p class="truncate font-medium">{user.name}</p>
                                </div>
                            </DropdownMenu.Item>
                        {/each}
                    {/if}

                    <DropdownMenu.Separator class="my-1" />
                    <DropdownMenu.Item
                        class="flex cursor-pointer items-center gap-2.5 rounded-none px-2.5 py-1.5 my-1 text-sm"
                        disabled={$serverTransitionLocked ||
                            creatingUser ||
                            switchingUserId !== null}
                        onclick={handleCreateUser}
                    >
                        <div
                            class="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
                        >
                            <UserPlus class="size-3.5" />
                        </div>
                        <div class="min-w-0 flex-1">
                            <p class="truncate font-medium">New user</p>
                        </div>
                    </DropdownMenu.Item>
                </DropdownMenu.Content>
            </DropdownMenu.Root>
        </div>
    </div>

    {#if $activeRoom}
        {#if !collapsed}
            <div class="relative flex">
                <div class="app-sidebar-room-panel flex w-[360px] flex-col bg-sidebar">
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
                                    size="icon"
                                    class="size-8"
                                    aria-label="Save room name"
                                    disabled={sidebarAction !== null}
                                    aria-busy={sidebarAction === 'rename-room'}
                                >
                                    <Check class="size-3.5" />
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    class="size-8"
                                    disabled={sidebarAction !== null}
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
                            {#if !$isMultiRoom}
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    class="size-8 shrink-0 text-muted-foreground"
                                    title="Rename room"
                                    aria-label="Rename room"
                                    disabled={sidebarAction !== null}
                                    onclick={startRenameRoom}
                                >
                                    <Edit3 class="size-3.5" />
                                </Button>
                            {/if}
                        {/if}
                    </div>

                    <div class="border-b border-sidebar-border p-3">
                        <div class="mb-2 flex items-center justify-between">
                            <p
                                class="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-muted-foreground"
                            >
                                <User class="size-3" /> Characters
                            </p>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                class="size-6 text-muted-foreground hover:text-foreground"
                                title="Add characters"
                                aria-label="Add characters"
                                disabled={sidebarAction !== null}
                                onclick={() => ($characterPickerOpen = true)}
                            >
                                <Plus class="size-3.5" />
                            </Button>
                        </div>
                        <EntityList
                            entities={$roomCharacters}
                            config={$activeRoom.characters}
                            layout="grid"
                            gridClass="grid grid-cols-3 gap-2"
                            listClass="grid grid-cols-3 gap-2"
                            childContainerClass="relative my-1 py-1.5 pl-2"
                            onItemClick={(character) => {
                                if ($activeChat) {
                                    void handleSelectCharacter(character.id);
                                }
                            }}
                            onCreateFolder={(name, parentId, sortOrder) =>
                                createRoomFolder(
                                    $activeRoom.id,
                                    'characters',
                                    name,
                                    parentId,
                                    sortOrder
                                )}
                            onUpdateFolder={(id, changes) =>
                                updateRoomFolder($activeRoom.id, 'characters', id, changes)}
                            onDeleteFolder={(id) =>
                                deleteRoomFolder($activeRoom.id, 'characters', id)}
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
                                <div class="col-span-3">
                                    <EmptyListPlaceholder message="No characters." />
                                </div>
                            {/snippet}
                            {#snippet item({ entity: character })}
                                {@const selected = $chatSelections?.characterId === character.id}
                                {@const isDefault =
                                    $activeChat?.defaultCharacterId === character.id}
                                <div class="group relative">
                                    <div
                                        class="flex w-full min-w-0 flex-col items-center gap-1 rounded-md border bg-background p-2 text-center transition-colors {selected
                                            ? 'border-primary ring-2 ring-primary/20'
                                            : 'hover:bg-sidebar-accent'}"
                                        title={character.name}
                                    >
                                        <div
                                            class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-xs font-semibold"
                                        >
                                            {#if character.avatar}
                                                <AssetView
                                                    asset={{
                                                        scopeType: character.scopeType,
                                                        scopeId: character.scopeId,
                                                        ownerTable: 'characters',
                                                        ownerId: character.id,
                                                        hash: character.avatar.hash,
                                                        encKey: character.avatar.encKey
                                                    }}
                                                    alt={character.name}
                                                    class="size-full object-cover"
                                                />
                                            {:else}
                                                {initial(character.name)}
                                            {/if}
                                        </div>
                                        <span class="w-full truncate text-[11px]"
                                            >{character.name}</span
                                        >
                                    </div>
                                    <ParticipantCardMenu
                                        kind="character"
                                        name={character.name}
                                        {isDefault}
                                        disabled={sidebarAction !== null}
                                        defaultDisabled={!$activeChat}
                                        defaultBusy={sidebarAction ===
                                            `default-character:${character.id}`}
                                        removeBusy={sidebarAction ===
                                            `remove-character:${character.id}`}
                                        onOpen={() => handleOpenCharacter(character.id)}
                                        onSetDefault={() => handleSetDefaultCharacter(character.id)}
                                        onRemove={() => handleRemoveCharacter(character.id)}
                                    />
                                    <button
                                        class="absolute -left-1 -top-1 hidden size-5 items-center justify-center rounded-full bg-background text-muted-foreground opacity-0 shadow-sm ring-1 ring-border transition-opacity hover:text-foreground group-hover:opacity-100 lg:flex"
                                        title="Open character studio"
                                        aria-label={`Open ${character.name} studio`}
                                        onclick={() => handleOpenCharacter(character.id)}
                                    >
                                        <Settings class="size-3" />
                                    </button>
                                    <button
                                        class="absolute left-5 -top-1 hidden size-5 items-center justify-center rounded-full bg-background shadow-sm ring-1 ring-border transition-opacity lg:flex {isDefault
                                            ? 'text-primary opacity-100'
                                            : 'text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100'}"
                                        title="Set default character"
                                        aria-label={`Set ${character.name} as default character`}
                                        disabled={!$activeChat || sidebarAction !== null}
                                        aria-busy={sidebarAction ===
                                            `default-character:${character.id}`}
                                        onclick={() => handleSetDefaultCharacter(character.id)}
                                    >
                                        <Pin class="size-3" />
                                    </button>
                                    <button
                                        class="absolute -right-1 -top-1 hidden size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100 lg:flex"
                                        title="Remove from room"
                                        aria-label={`Remove ${character.name} from room`}
                                        disabled={sidebarAction !== null}
                                        aria-busy={sidebarAction ===
                                            `remove-character:${character.id}`}
                                        onclick={() => handleRemoveCharacter(character.id)}
                                    >
                                        <X class="size-3" />
                                    </button>
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
                            size="icon"
                            class="size-8 shrink-0"
                            title="New chat"
                            aria-label="New chat"
                            disabled={sidebarAction !== null}
                            aria-busy={sidebarAction === 'create-chat'}
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
                                    createRoomFolder(
                                        $activeRoom.id,
                                        'chats',
                                        name,
                                        parentId,
                                        sortOrder
                                    )}
                                onUpdateFolder={(id, changes) =>
                                    updateRoomFolder($activeRoom.id, 'chats', id, changes)}
                                onDeleteFolder={(id) =>
                                    deleteRoomFolder($activeRoom.id, 'chats', id)}
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
                                    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
                                    <div
                                        class="relative group/folder flex items-center justify-between rounded-md px-2 py-2 text-sm select-none cursor-pointer transition-colors hover:bg-sidebar-accent/50 w-full"
                                        onclick={toggle}
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
                                                    size="icon"
                                                    class="size-7"
                                                    aria-label="Save chat name"
                                                    disabled={sidebarAction !== null}
                                                    aria-busy={sidebarAction ===
                                                        `rename-chat:${chat.id}`}
                                                >
                                                    <Check class="size-3" />
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    class="size-7"
                                                    disabled={sidebarAction !== null}
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
                                                    <span
                                                        class="min-w-0 flex-1 truncate text-foreground"
                                                    >
                                                        {chat.title || 'Untitled Chat'}
                                                    </span>
                                                </div>
                                                <button
                                                    class="touch-visible flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                                                    title="Rename chat"
                                                    aria-label={`Rename ${chat.title || 'Untitled Chat'}`}
                                                    disabled={sidebarAction !== null}
                                                    onclick={() =>
                                                        startRenameChat(
                                                            chat.id,
                                                            chat.title || 'Untitled Chat'
                                                        )}
                                                >
                                                    <Edit3 class="size-3" />
                                                </button>
                                                <button
                                                    class="touch-visible flex size-6 shrink-0 items-center justify-center rounded text-destructive opacity-0 transition-opacity hover:bg-destructive/10 group-hover:opacity-100"
                                                    title="Delete chat"
                                                    aria-label={`Delete ${chat.title || 'Untitled Chat'}`}
                                                    disabled={sidebarAction !== null}
                                                    aria-busy={sidebarAction ===
                                                        `delete-chat:${chat.id}`}
                                                    onclick={() => handleDeleteChat(chat.id)}
                                                >
                                                    <Trash2 class="size-3" />
                                                </button>
                                            </div>
                                        {/if}
                                    </div>
                                {/snippet}
                            </EntityList>
                        </div>
                    </div>

                    {#if $activePreset && Object.keys($activePreset.customToggles).length > 0}
                        <div
                            class="max-h-[40%] min-h-0 overflow-y-auto border-t border-sidebar-border p-3"
                        >
                            <p
                                class="mb-2 text-[11px] font-semibold uppercase text-muted-foreground"
                            >
                                Toggles
                            </p>
                            <div class="flex flex-col gap-2">
                                {#each Object.values($activePreset.customToggles).sort( (a, b) => compareSortOrder(a.sortOrder, b.sortOrder) ) as toggle (toggle.id)}
                                    {#if toggle.type === 'caption'}
                                        <p class="text-[11px] text-muted-foreground">
                                            {toggle.label}
                                        </p>
                                    {:else if toggle.type === 'divider'}
                                        <div class="flex items-center gap-2 py-1">
                                            {#if toggle.label}
                                                <span class="text-[10px] text-muted-foreground"
                                                    >{toggle.label}</span
                                                >
                                            {/if}
                                            <div class="h-px flex-1 bg-sidebar-border"></div>
                                        </div>
                                    {:else if toggle.type === 'group' || toggle.type === 'groupEnd'}
                                        {#if toggle.type === 'group' && toggle.label}
                                            <p class="pt-1 text-[11px] font-medium">
                                                {toggle.label}
                                            </p>
                                        {/if}
                                    {:else if toggle.type === 'select'}
                                        <label
                                            class="flex items-center justify-between gap-2 text-xs"
                                        >
                                            <span class="truncate">{toggle.label}</span>
                                            <select
                                                class="h-7 w-32 rounded-md border bg-background px-2 text-xs"
                                                value={$activePreset.globalVariables[
                                                    `toggle_${toggle.key}`
                                                ] ?? '0'}
                                                onchange={(event) =>
                                                    handleToggleChange(
                                                        toggle.key,
                                                        event.currentTarget.value
                                                    )}
                                            >
                                                {#each toggle.options as option, optionIndex (optionIndex)}
                                                    <option value={String(optionIndex)}
                                                        >{option}</option
                                                    >
                                                {/each}
                                            </select>
                                        </label>
                                    {:else if toggle.type === 'text'}
                                        <label
                                            class="flex items-center justify-between gap-2 text-xs"
                                        >
                                            <span class="truncate">{toggle.label}</span>
                                            <Input
                                                class="h-7 w-32 text-xs"
                                                value={$activePreset.globalVariables[
                                                    `toggle_${toggle.key}`
                                                ] ?? ''}
                                                oninput={(event) =>
                                                    handleToggleChange(
                                                        toggle.key,
                                                        event.currentTarget.value
                                                    )}
                                            />
                                        </label>
                                    {:else if toggle.type === 'textarea'}
                                        <label class="flex flex-col gap-1 text-xs">
                                            <span class="truncate">{toggle.label}</span>
                                            <textarea
                                                class="min-h-16 rounded-md border bg-background px-2 py-1 text-xs"
                                                value={$activePreset.globalVariables[
                                                    `toggle_${toggle.key}`
                                                ] ?? ''}
                                                oninput={(event) =>
                                                    handleToggleChange(
                                                        toggle.key,
                                                        event.currentTarget.value
                                                    )}
                                            ></textarea>
                                        </label>
                                    {:else if toggle.key}
                                        {@const toggleKey = toggle.key}
                                        <label class="flex items-center gap-2 text-xs">
                                            <input
                                                type="checkbox"
                                                class="size-3.5 rounded border-gray-300 text-primary focus:ring-primary"
                                                checked={$activePreset.globalVariables[
                                                    `toggle_${toggleKey}`
                                                ] === '1'}
                                                onchange={(event) =>
                                                    handleToggleChange(
                                                        toggleKey,
                                                        event.currentTarget.checked ? '1' : '0'
                                                    )}
                                            />
                                            <span class="truncate">{toggle.label}</span>
                                        </label>
                                    {/if}
                                {/each}
                            </div>
                        </div>
                    {/if}
                </div>
                <Button
                    variant="outline"
                    size="icon-lg"
                    class="absolute left-full top-1.5 z-30 size-11 rounded-none rounded-r-md border-sidebar-border bg-sidebar text-muted-foreground shadow-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:bg-sidebar dark:hover:bg-sidebar-accent max-lg:hidden"
                    title="Hide room panel"
                    aria-label="Hide room panel"
                    onclick={onToggle}
                >
                    <ChevronLeft class="size-4" />
                </Button>
            </div>
        {:else}
            <Button
                variant="outline"
                size="icon-lg"
                class="absolute left-full top-1.5 z-50 size-11 rounded-none rounded-r-md border-sidebar-border bg-sidebar/70 text-muted-foreground opacity-50 shadow-none backdrop-blur-sm transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:opacity-100 focus-visible:opacity-100 dark:bg-sidebar/70 dark:hover:bg-sidebar-accent"
                title="Show room panel"
                aria-label="Show room panel"
                onclick={onToggle}
            >
                <ChevronRight class="size-4" />
            </Button>
        {/if}
    {/if}

    {#if !$activeRoom && collapsed}
        <Button
            variant="outline"
            size="icon-lg"
            class="absolute left-full top-1.5 z-50 size-11 rounded-none rounded-r-md border-sidebar-border bg-sidebar/70 text-muted-foreground opacity-50 shadow-none backdrop-blur-sm transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:opacity-100 focus-visible:opacity-100 dark:bg-sidebar/70 dark:hover:bg-sidebar-accent lg:hidden"
            title="Show sidebar"
            aria-label="Show sidebar"
            onclick={onToggle}
        >
            <ChevronRight class="size-4" />
        </Button>
    {/if}
</aside>
