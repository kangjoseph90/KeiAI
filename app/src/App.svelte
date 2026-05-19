<script lang="ts">
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
        startSyncStatusTracking,
        stopSyncStatusTracking,
        selectCharacter,
        selectPersona,
        selectChat,
        selectRoom,
        clearActiveRoom,
        clearActiveChat,
        clearActiveCharacter,
        clearActivePersona,
        activeCharacter,
        activePersona,
        activeChat,
        activeRoom,
        initDefaultContents
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

    function navigateFromHome(r: RouteState) {
        navigate(r);
    }

    // Restore route from URL on boot
    async function restoreRoute(initial: RouteState): Promise<void> {
        try {
            if (initial.view === 'settings') {
                navigate(initial);
            } else if (initial.view === 'room' && initial.roomId) {
                await selectRoom(initial.roomId);
                if (initial.chatId) {
                    await selectChat(initial.chatId);
                } else {
                    clearActiveChat();
                }
                navigate(initial);
            } else if (initial.view === 'characterStudio' && initial.charId) {
                await selectCharacter(initial.charId);
                navigate(initial);
            } else if (initial.view === 'personaStudio' && initial.personaId) {
                await selectPersona(initial.personaId);
                navigate(initial);
            } else {
                navigate(initial);
            }
        } catch (e) {
            logger.warn('Route restore failed, falling back to home:', e);
            clearActiveRoom();
            clearActiveCharacter();
            clearActivePersona();
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
            prevRoute.roomId === r.roomId &&
            prevRoute.charId === r.charId &&
            prevRoute.chatId === r.chatId &&
            prevRoute.personaId === r.personaId &&
            prevRoute.pluginId === r.pluginId &&
            prevRoute.moduleId === r.moduleId
        ) {
            prevRoute = r;
            return;
        }
        prevRoute = r;

        (async () => {
            try {
                if (r.view === 'home') {
                    clearActiveRoom();
                    clearActiveCharacter();
                    clearActivePersona();
                } else if (r.view === 'room') {
                    if (r.roomId && $activeRoom?.id !== r.roomId) {
                        await selectRoom(r.roomId);
                    }
                    if (r.chatId && $activeChat?.id !== r.chatId) {
                        await selectChat(r.chatId);
                    } else if (!r.chatId) {
                        clearActiveChat();
                    }
                } else if (r.view === 'characterStudio') {
                    if (r.charId && $activeCharacter?.id !== r.charId) {
                        await selectCharacter(r.charId);
                    }
                } else if (r.view === 'personaStudio') {
                    if (r.personaId && $activePersona?.id !== r.personaId) {
                        await selectPersona(r.personaId);
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
            onNavigate={(r) => navigate(r)}
        />

        <!-- Main Content -->
        <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
            {#if $route.view === 'room' && $route.roomId}
                {#await import('$lib/views/chat/ChatView.svelte') then m}
                    <m.default roomId={$route.roomId} chatId={$route.chatId} />
                {/await}
            {:else if $route.view === 'characterStudio' && $route.charId}
                {#await import('$lib/views/character/CharacterStudio.svelte') then m}
                    <m.default charId={$route.charId} />
                {/await}
            {:else if $route.view === 'personaStudio' && $route.personaId}
                {#await import('$lib/views/persona/PersonaStudio.svelte') then m}
                    <m.default personaId={$route.personaId} />
                {/await}
            {:else if $route.view === 'settings'}
                {#await import('$lib/views/settings/SettingsView.svelte') then m}
                    <m.default pluginId={$route.pluginId} moduleId={$route.moduleId} />
                {/await}
            {:else}
                {#await import('$lib/views/home/HomeView.svelte') then m}
                    <m.default onNavigate={navigateFromHome} />
                {/await}
            {/if}
        </div>
    {/if}
</main>
