<script lang="ts">
    import './app.css';
    import { onMount, onDestroy } from 'svelte';
    import { get } from 'svelte/store';
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
        selectChat,
        clearActiveRoom,
        clearActiveCharacter,
        clearActiveModule,
        clearActivePersona,
        activeCharacter,
        activeModule,
        activePersona,
        activeChat,
        activeChatId,
        activeRoom,
        initDefaultContents,
        selectModule
    } from '$lib/stores';
    import {
        restoreCharacterContext,
        restorePersonaContext,
        restoreRoomContext
    } from '$lib/managers';
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

    function navigateFromSidebar(r: RouteState) {
        if (window.matchMedia('(max-width: 767px)').matches) {
            sidebarCollapsed = true;
        }
        navigate(r);
    }

    // Restore route from URL on boot
    async function restoreRoute(initial: RouteState): Promise<void> {
        try {
            if (initial.view === 'settings') {
                navigate(initial);
            } else if (initial.view === 'room' && initial.roomId) {
                await restoreRoomContext(initial.roomId);
                if (initial.chatId) {
                    await selectChat(initial.chatId);
                }
                const resolvedChatId = get(activeChatId);
                navigate({ ...initial, chatId: initial.chatId ?? resolvedChatId ?? undefined });
            } else if (initial.view === 'characterStudio' && initial.charId) {
                await restoreCharacterContext(initial.charId);
                navigate(initial);
            } else if (initial.view === 'moduleStudio' && initial.moduleId) {
                await selectModule(initial.moduleId);
                navigate(initial);
            } else if (initial.view === 'personaStudio' && initial.personaId) {
                await restorePersonaContext(initial.personaId);
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
            prevRoute.moduleId === r.moduleId &&
            prevRoute.settingsTab === r.settingsTab &&
            prevRoute.characterTab === r.characterTab &&
            prevRoute.moduleTab === r.moduleTab &&
            prevRoute.personaTab === r.personaTab
        ) {
            prevRoute = r;
            return;
        }
        prevRoute = r;

        (async () => {
            try {
                if (r.view === 'home' || r.view === 'multiRoom') {
                    clearActiveRoom();
                    clearActiveCharacter();
                    clearActiveModule();
                    clearActivePersona();
                } else if (r.view === 'room') {
                    if (r.roomId && $activeRoom?.id !== r.roomId) {
                        await restoreRoomContext(r.roomId);
                    }
                    if (r.chatId && $activeChat?.id !== r.chatId) {
                        await selectChat(r.chatId);
                    } else if (!r.chatId) {
                        const resolvedChatId = get(activeChatId);
                        if (resolvedChatId) {
                            navigate({ ...r, chatId: resolvedChatId });
                        }
                    }
                } else if (r.view === 'characterStudio') {
                    if (r.charId && $activeCharacter?.id !== r.charId) {
                        await restoreCharacterContext(r.charId);
                    }
                } else if (r.view === 'moduleStudio') {
                    if (r.moduleId && $activeModule?.id !== r.moduleId) {
                        await selectModule(r.moduleId);
                    }
                } else if (r.view === 'personaStudio') {
                    if (r.personaId && $activePersona?.id !== r.personaId) {
                        await restorePersonaContext(r.personaId);
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
            sidebarCollapsed = window.matchMedia('(max-width: 767px)').matches;
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
        {#if $route.view !== 'settings' && $route.view !== 'characterStudio' && $route.view !== 'moduleStudio' && $route.view !== 'personaStudio'}
            <!-- Sidebar -->
            <AppSidebar
                collapsed={sidebarCollapsed}
                route={$route}
                onToggle={() => (sidebarCollapsed = !sidebarCollapsed)}
                onNavigate={navigateFromSidebar}
            />
        {/if}

        <!-- Main Content -->
        <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
            {#if $route.view === 'room' && $route.roomId}
                {#await import('$lib/views/chat/ChatView.svelte') then m}
                    <m.default roomId={$route.roomId} chatId={$route.chatId} />
                {/await}
            {:else if $route.view === 'characterStudio' && $route.charId}
                {#await import('$lib/views/character/CharacterStudio.svelte') then m}
                    <m.default charId={$route.charId} characterTab={$route.characterTab} />
                {/await}
            {:else if $route.view === 'moduleStudio' && $route.moduleId}
                {#await import('$lib/views/modules/ModuleStudio.svelte') then m}
                    <m.default moduleId={$route.moduleId} moduleTab={$route.moduleTab} />
                {/await}
            {:else if $route.view === 'personaStudio' && $route.personaId}
                {#await import('$lib/views/persona/PersonaStudio.svelte') then m}
                    <m.default personaId={$route.personaId} personaTab={$route.personaTab} />
                {/await}
            {:else if $route.view === 'settings'}
                {#await import('$lib/views/settings/SettingsView.svelte') then m}
                    <m.default settingsTab={$route.settingsTab} />
                {/await}
            {:else if $route.view === 'multiRoom'}
                {#await import('$lib/views/home/HomeView.svelte') then m}
                    <m.default space="multiRooms" onNavigate={navigateFromHome} />
                {/await}
            {:else}
                {#await import('$lib/views/home/HomeView.svelte') then m}
                    <m.default space="library" onNavigate={navigateFromHome} />
                {/await}
            {/if}
        </div>
    {/if}
</main>
