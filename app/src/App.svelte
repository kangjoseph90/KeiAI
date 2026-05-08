<script lang="ts">
    import { setGreetings } from '$lib/managers';

    import './app.css';
    import { onMount, onDestroy } from 'svelte';
    import { UserService } from '$lib/services';
    import { SyncManager } from '$lib/services/sync';
    import { clock } from '$lib/utils/clock';
    import { appKV } from '$lib/adapters/kv';
    import AppSidebar from '$lib/components/layout/AppSidebar.svelte';
    import {
        loadGlobalState,
        loadUser,
        startUserTracking,
        stopUserTracking,
        startSyncStatusTracking,
        stopSyncStatusTracking,
        selectCharacter,
        selectChat,
        clearActiveCharacter,
        activeCharacter,
        activeChat,
        chats,
        initDefaultContents,
        createChat
    } from '$lib/stores';
    import {
        route,
        navigate,
        initHashListener,
        getCurrentHashRoute,
        type RouteState
    } from '$lib/router';
    import { getErrorMessage } from '$lib/types/errors';
    import { createLogger } from '$lib/adapters/logger';

    let ready = $state(false);
    let errorMsg = $state('');
    let sidebarCollapsed = $state(false);
    const logger = createLogger('route:page');

    /**
     * Select a character and navigate to its latest chat.
     * If no chat exists, create one automatically.
     */
    async function handleSelectChar(charId: string) {
        try {
            await selectCharacter(charId);

            // Try to open the last active chat
            const charData = $activeCharacter;
            if (charData?.lastActiveChatId) {
                try {
                    await selectChat(charData.lastActiveChatId, charId);
                    navigate({ view: 'chat', charId, chatId: charData.lastActiveChatId });
                    return;
                } catch {
                    // lastActiveChatId may be stale, fall through
                }
            }

            // Try the most recent chat from the loaded list
            const chatList = $chats;
            if (chatList && chatList.length > 0) {
                const latestChat = chatList[0];
                await selectChat(latestChat.id, charId);
                navigate({ view: 'chat', charId, chatId: latestChat.id });
                return;
            }

            // No chats exist — create one
            const newChat = await createChat(charId, {
                title: `Chat`
            });
            await setGreetings(newChat.id, $activeCharacter?.greetings ?? {});
            await selectChat(newChat.id, charId);
            navigate({ view: 'chat', charId, chatId: newChat.id });
        } catch (e) {
            logger.error('Failed to select character:', e);
        }
    }

    // Restore route from URL on boot
    async function restoreRoute(initial: RouteState): Promise<void> {
        try {
            if (initial.view === 'settings') {
                navigate(initial);
            } else if (
                (initial.view === 'chat' || initial.view === 'characterStudio') &&
                initial.charId
            ) {
                if (initial.view === 'chat' && !initial.chatId) {
                    await handleSelectChar(initial.charId);
                    return;
                }
                await selectCharacter(initial.charId);
                if (initial.chatId) {
                    await selectChat(initial.chatId, initial.charId);
                }
                navigate(initial);
            } else {
                navigate(initial);
            }
        } catch (e) {
            logger.warn('Route restore failed, falling back to home:', e);
            clearActiveCharacter();
            navigate({ view: 'home' });
        }
    }

    // Sync store state when route changes (back/forward nav)
    let prevRoute: RouteState | null = null;
    $effect(() => {
        const r = $route;
        if (!ready || !prevRoute) {
            prevRoute = r;
            return;
        }
        if (
            prevRoute.view === r.view &&
            prevRoute.charId === r.charId &&
            prevRoute.chatId === r.chatId
        ) {
            prevRoute = r;
            return;
        }
        prevRoute = r;

        (async () => {
            try {
                if (r.view === 'home') {
                    clearActiveCharacter();
                } else if (r.view === 'chat' || r.view === 'characterStudio') {
                    if (r.charId && $activeCharacter?.id !== r.charId) {
                        await selectCharacter(r.charId);
                    }
                    if (r.chatId && $activeChat?.id !== r.chatId) {
                        await selectChat(r.chatId, r.charId ?? '');
                    }
                }
            } catch (e) {
                logger.error('Navigation failed:', e);
                navigate({ view: 'home' });
            }
        })();
    });

    let _cleanupHash: (() => void) | undefined;

    onMount(async () => {
        try {
            startSyncStatusTracking();
            await clock.init(appKV);
            const { user, restored } = await UserService.restoreOrCreateUser();
            await UserService.setActiveUser(user.id, { preserveAuth: restored });
            if (!restored) {
                await initDefaultContents();
            }
            await loadUser();
            startUserTracking();
            await loadGlobalState();
            SyncManager.startAutoSync();
            await SyncManager.syncAll();
            const initialRoute = getCurrentHashRoute();
            await restoreRoute(initialRoute);
            ready = true;

            _cleanupHash = initHashListener();
        } catch (err) {
            errorMsg = getErrorMessage(err);
        }
    });

    onDestroy(() => {
        SyncManager.stopAutoSync();
        stopUserTracking();
        stopSyncStatusTracking();
        _cleanupHash?.();
    });
</script>

<main class="flex h-screen bg-background text-foreground overflow-hidden">
    {#if errorMsg}
        <div
            class="absolute inset-x-0 top-0 z-50 bg-destructive px-4 py-2 text-center text-sm font-medium text-white"
        >
            {errorMsg}
        </div>
    {/if}

    {#if !ready}
        <div class="flex flex-1 items-center justify-center">
            <p class="text-muted-foreground text-sm">Initializing Secure Local Session...</p>
        </div>
    {:else}
        <!-- Sidebar -->
        <AppSidebar
            collapsed={sidebarCollapsed}
            route={$route}
            onToggle={() => (sidebarCollapsed = !sidebarCollapsed)}
            onNavigate={(r) => {
                if (r.view === 'chat' && r.charId && !r.chatId) {
                    handleSelectChar(r.charId);
                } else {
                    navigate(r);
                }
            }}
        />

        <!-- Main Content -->
        <div class="flex flex-1 flex-col overflow-hidden">
            {#if $route.view === 'chat' && $route.charId}
                {#await import('$lib/views/chat/ChatView.svelte') then m}
                    <m.default chatId={$route.chatId ?? ''} />
                {/await}
            {:else if $route.view === 'characterStudio' && $route.charId}
                {#await import('$lib/views/character/CharacterStudio.svelte') then m}
                    <m.default charId={$route.charId} />
                {/await}
            {:else if $route.view === 'settings'}
                {#await import('$lib/views/settings/SettingsView.svelte') then m}
                    <m.default />
                {/await}
            {:else}
                {#await import('$lib/views/home/HomeView.svelte') then m}
                    <m.default onSelectCharacter={handleSelectChar} />
                {/await}
            {/if}
        </div>
    {/if}
</main>
