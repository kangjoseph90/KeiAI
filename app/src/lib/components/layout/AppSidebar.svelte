<script lang="ts">
    import {
        ChevronDown,
        ChevronLeft,
        ChevronRight,
        Cloud,
        CloudOff,
        Folder,
        FolderOpen,
        Home,
        LoaderCircle,
        LockKeyhole,
        RefreshCw,
        Settings,
        UserCircle,
        UserPlus,
        UsersRound
    } from 'lucide-svelte';
    import type { Snippet } from 'svelte';
    import RoomAvatar from '$lib/components/RoomAvatar.svelte';
    import { Button } from '$lib/components/ui/button';
    import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
    import {
        activeChat,
        activeRoom,
        activeUser,
        assetSyncStatus,
        appSettings,
        createAndSwitchLocalUser,
        createGlobalFolder,
        dataSyncStatus,
        deleteGlobalFolder,
        isMultiRoom,
        isLoggedIn,
        loadLocalUsers,
        localUsers,
        moveGlobalItem,
        multiSyncStatus,
        rooms,
        serverTransitionLocked,
        selectRoom,
        switchLocalUser,
        updateGlobalFolder,
        userSyncStatus,
        t
    } from '$lib/stores';
    import { toast } from '$lib/ui';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
    import { getFolderColorClass } from '$lib/components/entitylist/folders';
    import type { RouteState } from '$lib/router';
    import { getErrorMessage } from '$lib/types/errors';
    import { SyncManager, type SyncStatus } from '$lib/services/sync';

    interface Props {
        collapsed?: boolean;
        compact?: boolean;
        route: RouteState;
        onToggle: () => void;
        onNavigate: (route: RouteState) => void;
        panel?: Snippet;
        hasPanel?: boolean;
    }

    type SyncIndicatorState = SyncStatus['state'] | 'server-transition';

    const SYNC_ICON_DELAY_MS = 400;
    const SYNC_ICON_MIN_VISIBLE_MS = 500;

    let {
        collapsed = false,
        compact = false,
        route,
        onToggle,
        onNavigate,
        panel,
        hasPanel = false
    }: Props = $props();

    let switchingUserId = $state<string | null>(null);
    let creatingUser = $state(false);
    let retryingSync = $state(false);
    let selectingRoomId = $state<string | null>(null);
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
            ? $t('shell.sidebar.sync.indicatorServerTransition')
            : syncState === 'syncing'
              ? $t('shell.sidebar.sync.indicatorSyncing')
              : syncState === 'network_error'
                ? $t('shell.sidebar.sync.indicatorNetwork')
                : syncState === 'quota_error'
                  ? $t('shell.sidebar.sync.indicatorQuota')
                  : syncState === 'auth_error'
                    ? $t('shell.sidebar.sync.indicatorAuth')
                    : $t('shell.sidebar.sync.indicatorIdle')
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
        if (status.state === 'syncing') return $t('shell.sidebar.sync.statusSyncing');
        if (status.state === 'network_error') return $t('shell.sidebar.sync.statusNetworkError');
        if (status.state === 'quota_error') return $t('shell.sidebar.sync.statusQuotaError');
        if (status.state === 'auth_error') return $t('shell.sidebar.sync.statusAuthError');
        return $t('shell.sidebar.sync.statusUpToDate');
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
            toast.error({
                title: $t('shell.sidebar.toast.sync'),
                description: getErrorMessage(error)
            });
        } finally {
            retryingSync = false;
        }
    }

    async function handleSelectRoom(roomId: string): Promise<void> {
        if (route.view === 'room') {
            onNavigate({ view: 'room', roomId });
            return;
        }
        if (selectingRoomId) return;
        selectingRoomId = roomId;
        try {
            await selectRoom(roomId);
            if ($activeRoom?.id === roomId) {
                onNavigate({ view: 'room', roomId, chatId: $activeChat?.id });
            }
        } catch (error) {
            toast.error({
                title: $t('library.toast.openRoom'),
                description: getErrorMessage(error)
            });
        } finally {
            selectingRoomId = null;
        }
    }

    async function handleSwitchUser(userId: string) {
        if ($serverTransitionLocked || switchingUserId || creatingUser) return;
        switchingUserId = userId;
        try {
            await switchLocalUser(userId);
        } catch (error) {
            toast.error({
                title: $t('shell.sidebar.toast.switchUser'),
                description: getErrorMessage(error)
            });
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
            toast.error({
                title: $t('shell.sidebar.toast.createUser'),
                description: getErrorMessage(error)
            });
        } finally {
            creatingUser = false;
        }
    }
    function handleBackdropClick(): void {
        const hasOpenOverlay = Boolean(
            document.querySelector(
                '[data-slot="dropdown-menu-content"], [data-slot="popover-content"], [data-slot="dialog-content"], [role="menu"]'
            )
        );
        if (hasOpenOverlay) return;
        onToggle();
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

<button
    type="button"
    class="app-sidebar-backdrop fixed inset-0 z-30 bg-black/35 lg:hidden"
    data-open={!collapsed}
    aria-hidden={collapsed}
    aria-label={$t('shell.sidebar.closeNavigation')}
    tabindex={collapsed ? -1 : 0}
    onclick={handleBackdropClick}
></button>

<aside
    data-compact-open={!collapsed}
    data-collapsed={collapsed}
    data-panel-open={hasPanel && !collapsed}
    aria-hidden={compact && collapsed}
    inert={compact && collapsed}
    class="app-sidebar relative z-40 flex h-full shrink-0 bg-sidebar text-sidebar-foreground max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:shadow-xl"
>
    <div class="flex w-14 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div class="flex h-14 items-center justify-center border-b border-sidebar-border">
            <Button
                variant={route.view === 'home' ? 'secondary' : 'ghost'}
                size="icon"
                title={$t('shell.sidebar.library')}
                aria-label={$t('shell.sidebar.library')}
                onclick={() => onNavigate({ view: 'home' })}
            >
                <Home class="size-4" />
            </Button>
        </div>

        <div class="flex items-center justify-center border-b border-sidebar-border px-2 py-2">
            <Button
                variant={route.view === 'multiRoom' || $isMultiRoom ? 'secondary' : 'ghost'}
                size="icon"
                title={$t('shell.sidebar.multiRooms')}
                aria-label={$t('shell.sidebar.multiRooms')}
                onclick={() => onNavigate({ view: 'multiRoom' })}
            >
                <UsersRound class="size-4" />
            </Button>
        </div>

        <div class="flex-1 overflow-y-auto px-2 py-2">
            <div class="flex w-full flex-col items-center gap-2">
                {#if $appSettings}
                    <EntityList
                        entities={$rooms}
                        config={$appSettings.rooms}
                        layout="list"
                        gridClass="flex flex-col gap-2 items-center w-full"
                        listClass="flex flex-col gap-2 items-center w-full"
                        childContainerClass="relative my-1 px-0 py-1.5 flex flex-col gap-2 items-center w-full"
                        onItemClick={(room) => handleSelectRoom(room.id)}
                        onCreateFolder={(name, parentId, sortOrder) =>
                            createGlobalFolder('rooms', name, parentId, sortOrder)}
                        onUpdateFolder={(id, changes) => updateGlobalFolder('rooms', id, changes)}
                        onDeleteFolder={(id) => deleteGlobalFolder('rooms', id)}
                        onMoveItem={(itemId, newFolderId, newSortOrder) =>
                            moveGlobalItem('rooms', itemId, newFolderId, newSortOrder)}
                    >
                        {#snippet folder({ folder: f, collapsed, toggle })}
                            <button
                                type="button"
                                class="relative flex size-10 items-center justify-center overflow-hidden rounded-md border transition-colors select-none cursor-pointer
                                    {f.color
                                    ? getFolderColorClass(f.color)
                                    : 'border-transparent bg-muted/30 text-foreground hover:bg-muted/50 hover:border-sidebar-border'}"
                                onclick={toggle}
                                title={f.name}
                                aria-label={f.name}
                                aria-expanded={!collapsed}
                            >
                                {#if collapsed}
                                    <Folder strokeWidth={2.5} class="size-4 text-inherit" />
                                {:else}
                                    <FolderOpen strokeWidth={2.5} class="size-4 text-inherit" />
                                {/if}
                            </button>
                        {/snippet}

                        {#snippet item({ entity: room })}
                            {@const selected = route.roomId === room.id}
                            <div
                                class="relative flex size-10 items-center justify-center overflow-hidden rounded-md border bg-background text-xs font-semibold transition-colors {selected
                                    ? 'border-primary ring-2 ring-primary/20'
                                    : 'border-transparent hover:border-sidebar-border'} group"
                                title={room.name}
                            >
                                <RoomAvatar
                                    {room}
                                    class="size-full"
                                    initialClass="text-[10px] font-semibold"
                                />
                            </div>
                        {/snippet}
                    </EntityList>
                {/if}
            </div>
        </div>

        <div class="flex flex-col items-center gap-2 border-t border-sidebar-border p-2">
            {#if $isLoggedIn || $serverTransitionLocked}
                <DropdownMenu.Root>
                    <DropdownMenu.Trigger>
                        <Button
                            variant="ghost"
                            size="icon"
                            title={syncLabel}
                            aria-label={`${$t('shell.sidebar.sync.viewStatus')}: ${syncLabel}`}
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
                            >{$t('shell.sidebar.sync.title')}</DropdownMenu.Label
                        >
                        {#if $serverTransitionLocked}
                            <div class="mx-1 mb-1 rounded-md bg-amber-500/10 px-2.5 py-2 text-xs">
                                <p class="font-medium text-amber-700 dark:text-amber-300">
                                    {$t('shell.sidebar.sync.serverTransitionTitle')}
                                </p>
                                <p class="mt-1 leading-4 text-muted-foreground">
                                    {$t('shell.sidebar.sync.serverTransitionBody')}
                                </p>
                            </div>
                            <DropdownMenu.Separator />
                        {/if}
                        {@render syncStatusRow($t('shell.sidebar.sync.user'), $userSyncStatus)}
                        {@render syncStatusRow($t('shell.sidebar.sync.records'), $dataSyncStatus)}
                        {@render syncStatusRow($t('shell.sidebar.sync.assets'), $assetSyncStatus)}
                        {@render syncStatusRow(
                            $t('shell.sidebar.sync.multiRoom'),
                            $multiSyncStatus
                        )}
                        <DropdownMenu.Separator />
                        <DropdownMenu.Item
                            class="cursor-pointer gap-2"
                            disabled={$serverTransitionLocked ||
                                retryingSync ||
                                syncState === 'syncing'}
                            onclick={() => void handleSync()}
                        >
                            <RefreshCw class="size-4" />
                            {retryingSync || syncState === 'syncing'
                                ? $t('shell.sidebar.sync.syncingNow')
                                : $t('shell.sidebar.sync.syncNow')}
                        </DropdownMenu.Item>
                    </DropdownMenu.Content>
                </DropdownMenu.Root>
            {/if}
            <Button
                variant="ghost"
                size="icon"
                title={$t('shell.sidebar.settings')}
                aria-label={$t('shell.sidebar.settings')}
                onclick={() => onNavigate({ view: 'settings' })}
            >
                <Settings class="size-4" />
            </Button>
            <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                    <Button
                        variant="ghost"
                        size="icon"
                        class="overflow-hidden rounded-md"
                        title={$activeUser?.name ?? $t('shell.sidebar.currentUser')}
                        aria-label={`${$t('shell.sidebar.currentUser')}: ${$activeUser?.name ?? $t('common.state.unknown')}`}
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
                                <p class="truncate text-[11px] text-muted-foreground">
                                    {$t('shell.sidebar.currentUser')}
                                </p>
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
                            <p class="truncate font-medium">{$t('shell.sidebar.newUser')}</p>
                        </div>
                    </DropdownMenu.Item>
                </DropdownMenu.Content>
            </DropdownMenu.Root>
        </div>
    </div>

    {#if hasPanel}
        <div class="app-room-panel-stage h-full shrink-0" aria-hidden={collapsed} inert={collapsed}>
            {@render panel?.()}
        </div>
        {#if !collapsed}
            <Button
                variant="outline"
                size="icon-lg"
                class="absolute left-full top-1.5 z-50 rounded-none rounded-r-md border-sidebar-border bg-sidebar/70 text-muted-foreground opacity-50 shadow-none backdrop-blur-sm transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:opacity-100 focus-visible:opacity-100 dark:bg-sidebar/70 dark:hover:bg-sidebar-accent max-lg:hidden"
                title={$t('shell.sidebar.hideRoomPanel')}
                aria-label={$t('shell.sidebar.hideRoomPanel')}
                onclick={onToggle}
            >
                <ChevronLeft class="size-4" />
            </Button>
        {/if}
        {#if collapsed}
            <Button
                variant="outline"
                size="icon-lg"
                class="absolute left-full top-1.5 z-50 rounded-none rounded-r-md border-sidebar-border bg-sidebar/70 text-muted-foreground opacity-50 shadow-none backdrop-blur-sm transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:opacity-100 focus-visible:opacity-100 dark:bg-sidebar/70 dark:hover:bg-sidebar-accent max-lg:hidden"
                title={$t('shell.sidebar.showRoomPanel')}
                aria-label={$t('shell.sidebar.showRoomPanel')}
                onclick={onToggle}
            >
                <ChevronRight class="size-4" />
            </Button>
        {/if}
    {/if}
</aside>

{#if collapsed}
    <Button
        variant="outline"
        size="icon-lg"
        class="fixed left-(--safe-area-left) top-[calc(var(--safe-area-top)+0.375rem)] z-50 rounded-none rounded-r-md border-sidebar-border bg-sidebar/70 text-muted-foreground opacity-50 shadow-none backdrop-blur-sm transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:opacity-100 focus-visible:opacity-100 dark:bg-sidebar/70 dark:hover:bg-sidebar-accent lg:hidden"
        title={hasPanel ? $t('shell.sidebar.showRoomPanel') : $t('shell.sidebar.showSidebar')}
        aria-label={hasPanel ? $t('shell.sidebar.showRoomPanel') : $t('shell.sidebar.showSidebar')}
        onclick={onToggle}
    >
        <ChevronRight class="size-4" />
    </Button>
{/if}

<style>
    .app-sidebar {
        transition: transform var(--motion-duration, 240ms) cubic-bezier(0.22, 1, 0.36, 1);
    }

    .app-sidebar[data-panel-open='true'] {
        border-right: 1px solid var(--sidebar-border);
    }

    .app-room-panel-stage {
        width: 360px;
        overflow: hidden;
        transition: width var(--motion-duration, 240ms) cubic-bezier(0.22, 1, 0.36, 1);
    }

    .app-sidebar-backdrop {
        opacity: 0;
        pointer-events: none;
        transition: opacity 180ms ease-out;
    }

    .app-sidebar-backdrop[data-open='true'] {
        opacity: 1;
        pointer-events: auto;
    }

    @media (min-width: 1024px) {
        .app-sidebar[data-collapsed='true'] .app-room-panel-stage {
            width: 0;
        }
    }

    @media (max-width: 1023.98px) {
        .app-room-panel-stage {
            width: min(
                22.75rem,
                calc(100vw - 6.25rem - var(--safe-area-left) - var(--safe-area-right))
            );
        }

        .app-sidebar[data-collapsed='true'] {
            transform: translateX(-100%);
            pointer-events: none;
        }
    }
</style>
