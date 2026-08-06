<script lang="ts">
    import './app.css';
    import { onMount, onDestroy } from 'svelte';
    import { get } from 'svelte/store';
    import { AuthService, UserService } from '$lib/services';
    import { SyncManager } from '$lib/services/sync';
    import { clock } from '$lib/utils/clock';
    import { appKV } from '$lib/adapters/kv';
    import { AppSidebar } from '$lib/components/layout';
    import RoomPanel from '$lib/views/room/RoomPanel.svelte';
    import ChatView from '$lib/views/chat/ChatView.svelte';
    import CharacterStudio from '$lib/views/character/CharacterStudio.svelte';
    import HomeView from '$lib/views/home/HomeView.svelte';
    import ModuleStudio from '$lib/views/modules/ModuleStudio.svelte';
    import PersonaStudio from '$lib/views/persona/PersonaStudio.svelte';
    import SettingsView from '$lib/views/settings/SettingsView.svelte';
    import { Button } from '$lib/components/ui/button';
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
    import ModalHost from '$lib/components/app/ModalHost.svelte';
    import ToastHost from '$lib/components/app/ToastHost.svelte';
    import TaskCenter from '$lib/components/app/TaskCenter.svelte';
    import { getWebCryptoAvailabilityIssue, type WebCryptoAvailabilityIssue } from '$lib/crypto';
    import { getEnvironmentConfigIssue } from '$lib/config';

    let ready = $state(false);
    let errorMsg = $state('');
    let cryptoIssue = $state<WebCryptoAvailabilityIssue | null>(null);
    let sidebarCollapsed = $state(false);
    let chatPanelOpen = $state(false);
    let restoreRoomPanelAfterCompactConflict = false;
    let compactShell = $state(false);
    let shellTransitionSuppressed = $state(false);
    // Match Tailwind's `max-lg` range, including fractional CSS viewport widths.
    const COMPACT_SHELL_QUERY = '(max-width: 1023.98px)';
    let compactShellMedia: MediaQueryList | undefined;
    let shellTransitionFrame: number | undefined;
    let shellTransitionRestoreFrame: number | undefined;
    const appSidebarVisible = $derived(
        $route.view !== 'settings' &&
            $route.view !== 'characterStudio' &&
            $route.view !== 'moduleStudio' &&
            $route.view !== 'personaStudio'
    );
    const environmentIssue = getEnvironmentConfigIssue();
    const logger = createLogger('route:page');

    function navigateFromHome(r: RouteState) {
        navigate(r);
    }

    function navigateFromSidebar(r: RouteState) {
        if (isCompactShell()) sidebarCollapsed = true;
        navigate(r);
    }

    function isCompactShell(): boolean {
        return compactShellMedia?.matches ?? compactShell;
    }

    function handleSidebarToggle(): void {
        const opening = sidebarCollapsed;
        restoreRoomPanelAfterCompactConflict = false;
        if (opening && isCompactShell()) chatPanelOpen = false;
        sidebarCollapsed = !sidebarCollapsed;
    }

    function handleChatPanelOpen(): void {
        if (isCompactShell() && !sidebarCollapsed) {
            restoreRoomPanelAfterCompactConflict = true;
            sidebarCollapsed = true;
        }
        chatPanelOpen = true;
    }

    function handleChatPanelClose(): void {
        chatPanelOpen = false;
        restoreRoomPanelAfterCompactConflict = false;
    }

    function handleCompactShellChange(event: MediaQueryListEvent): void {
        compactShell = event.matches;
        suppressShellTransitions();
        if (event.matches && !sidebarCollapsed && chatPanelOpen) {
            restoreRoomPanelAfterCompactConflict = true;
            sidebarCollapsed = true;
        } else if (!event.matches && restoreRoomPanelAfterCompactConflict) {
            restoreRoomPanelAfterCompactConflict = false;
            sidebarCollapsed = false;
        }
    }

    function suppressShellTransitions(): void {
        if (shellTransitionFrame !== undefined) cancelAnimationFrame(shellTransitionFrame);
        if (shellTransitionRestoreFrame !== undefined) {
            cancelAnimationFrame(shellTransitionRestoreFrame);
        }

        shellTransitionSuppressed = true;
        shellTransitionFrame = requestAnimationFrame(() => {
            shellTransitionFrame = undefined;
            shellTransitionRestoreFrame = requestAnimationFrame(() => {
                shellTransitionRestoreFrame = undefined;
                shellTransitionSuppressed = false;
            });
        });
    }

    function handleShellKeydown(event: KeyboardEvent): void {
        if (event.defaultPrevented || event.key !== 'Escape') return;
        if (chatPanelOpen) {
            handleChatPanelClose();
        } else if (isCompactShell() && !sidebarCollapsed) {
            sidebarCollapsed = true;
        }
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
            clearActiveModule();
            clearActivePersona();
            navigate({ view: 'home' });
        }
    }

    // Sync store state when route changes (back/forward nav)
    let prevRoute: RouteState | null = null;
    let navigationVersion = 0;
    $effect(() => {
        const r = $route;
        if (r.view !== 'room') {
            chatPanelOpen = false;
            restoreRoomPanelAfterCompactConflict = false;
        }
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
        const version = ++navigationVersion;
        const isCurrent = () => version === navigationVersion;

        (async () => {
            try {
                if (r.view === 'home' || r.view === 'multiRoom') {
                    clearActiveRoom();
                    clearActiveCharacter();
                    clearActiveModule();
                    clearActivePersona();
                } else if (r.view === 'room') {
                    if (r.roomId && $activeRoom?.id !== r.roomId) {
                        await restoreRoomContext(r.roomId, isCurrent);
                        if (!isCurrent()) return;
                    }
                    if (r.chatId && $activeChat?.id !== r.chatId) {
                        await selectChat(r.chatId, isCurrent);
                    } else if (!r.chatId) {
                        const resolvedChatId = get(activeChatId);
                        if (resolvedChatId && isCurrent()) {
                            navigate({ ...r, chatId: resolvedChatId });
                        }
                    }
                } else if (r.view === 'characterStudio') {
                    if (r.charId && $activeCharacter?.id !== r.charId) {
                        await restoreCharacterContext(r.charId, isCurrent);
                    }
                } else if (r.view === 'moduleStudio') {
                    if (r.moduleId && $activeModule?.id !== r.moduleId) {
                        await selectModule(r.moduleId, isCurrent);
                    }
                } else if (r.view === 'personaStudio') {
                    if (r.personaId && $activePersona?.id !== r.personaId) {
                        await restorePersonaContext(r.personaId, isCurrent);
                    }
                }
            } catch (e) {
                logger.error('Navigation failed:', e);
                if (isCurrent()) navigate({ view: 'home' });
            }
        })();
    });

    let _cleanupHash: (() => void) | undefined;

    onMount(async () => {
        try {
            if (environmentIssue) return;

            cryptoIssue = getWebCryptoAvailabilityIssue();
            if (cryptoIssue) return;

            compactShellMedia = window.matchMedia(COMPACT_SHELL_QUERY);
            compactShell = compactShellMedia.matches;
            sidebarCollapsed = compactShell;
            compactShellMedia.addEventListener('change', handleCompactShellChange);
            startSyncStatusTracking();
            await clock.init(appKV);
            const { user, restored } = await UserService.restoreOrCreateUser();
            await UserService.setActiveUser(user.id);
            await AuthService.restorePbAuth(user.id);
            await AuthService.refreshPbAuth();
            AuthService.startAutoRefresh();
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

    function retryStartup(): void {
        window.location.reload();
    }

    onDestroy(() => {
        AuthService.stopAutoRefresh();
        SyncManager.stopAutoSync();
        stopSyncStatusTracking();
        compactShellMedia?.removeEventListener('change', handleCompactShellChange);
        if (shellTransitionFrame !== undefined) cancelAnimationFrame(shellTransitionFrame);
        if (shellTransitionRestoreFrame !== undefined) {
            cancelAnimationFrame(shellTransitionRestoreFrame);
        }
        _cleanupHash?.();
    });
</script>

<svelte:window onkeydown={handleShellKeydown} />

{#snippet startupIssue(
    label: string,
    title: string,
    message: string,
    instructions: string[],
    retryLabel: string | null
)}
    <div class="flex flex-1 items-center justify-center p-4 sm:p-6">
        <section
            class="w-full max-w-lg rounded-xl border bg-card p-5 shadow-sm sm:p-6"
            role="alert"
        >
            <div
                class="mb-4 inline-flex rounded-full bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive"
            >
                {label}
            </div>
            <h1 class="text-xl font-semibold">{title}</h1>
            <p class="mt-3 wrap-break-word text-sm leading-6 text-muted-foreground">{message}</p>
            {#if instructions.length > 0}
                <div class="mt-5 rounded-lg border bg-muted/30 p-4 text-sm">
                    <p class="font-medium">How to continue</p>
                    <ul class="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                        {#each instructions as instruction (instruction)}
                            <li>{instruction}</li>
                        {/each}
                    </ul>
                </div>
            {/if}
            {#if retryLabel}
                <Button class="mt-5" onclick={retryStartup}>{retryLabel}</Button>
            {/if}
        </section>
    </div>
{/snippet}

<main
    class="app-shell flex min-h-0 overflow-hidden bg-background text-foreground"
    data-layout-transition-suppressed={shellTransitionSuppressed}
    aria-busy={!ready && !environmentIssue && !cryptoIssue && !errorMsg}
>
    {#if environmentIssue}
        {@render startupIssue(
            'Startup blocked',
            environmentIssue.title,
            environmentIssue.message,
            [
                `Add ${environmentIssue.missingVariables.join(' and ')} to the root .env file.`,
                'Restart the development server or rebuild the app after updating the environment.'
            ],
            'Retry startup'
        )}
    {:else if cryptoIssue}
        {@render startupIssue(
            'Startup blocked',
            cryptoIssue.title,
            cryptoIssue.message,
            [
                'Open KeiAI from an HTTPS address.',
                'Use a modern browser with Web Crypto support.',
                'Use the native Tauri app when available.'
            ],
            null
        )}
    {:else if errorMsg}
        {@render startupIssue(
            'Startup failed',
            'KeiAI could not finish starting',
            errorMsg,
            [
                'Your local data has not been removed.',
                'Check storage permissions and connectivity before retrying.'
            ],
            'Retry startup'
        )}
    {:else if !ready}
        <div class="flex flex-1 items-center justify-center p-6">
            <p class="text-sm text-muted-foreground" role="status">Loading KeiAI...</p>
        </div>
    {:else}
        {#if appSidebarVisible}
            <!-- Sidebar -->
            <AppSidebar
                collapsed={sidebarCollapsed}
                compact={isCompactShell()}
                route={$route}
                onToggle={handleSidebarToggle}
                onNavigate={navigateFromSidebar}
                hasPanel={$route.view === 'room' && Boolean($activeRoom)}
            >
                {#snippet panel()}
                    <RoomPanel route={$route} onNavigate={navigateFromSidebar} />
                {/snippet}
            </AppSidebar>
        {/if}

        <!-- Main Content -->
        <div
            class="flex min-h-0 flex-1 flex-col overflow-hidden"
            inert={appSidebarVisible &&
                isCompactShell() &&
                !sidebarCollapsed &&
                $route.view !== 'room'}
        >
            {#if $route.view === 'room' && $route.roomId}
                <ChatView
                    roomId={$route.roomId}
                    bind:inspectorOpen={chatPanelOpen}
                    onRequestInspectorOpen={handleChatPanelOpen}
                    onRequestInspectorClose={handleChatPanelClose}
                    roomOverlayOpen={isCompactShell() && !sidebarCollapsed}
                />
            {:else if $route.view === 'characterStudio' && $route.charId}
                <CharacterStudio charId={$route.charId} characterTab={$route.characterTab} />
            {:else if $route.view === 'moduleStudio' && $route.moduleId}
                <ModuleStudio moduleId={$route.moduleId} moduleTab={$route.moduleTab} />
            {:else if $route.view === 'personaStudio' && $route.personaId}
                <PersonaStudio personaId={$route.personaId} personaTab={$route.personaTab} />
            {:else if $route.view === 'settings'}
                <SettingsView settingsTab={$route.settingsTab} />
            {:else if $route.view === 'multiRoom'}
                <HomeView space="multiRooms" onNavigate={navigateFromHome} />
            {:else}
                <HomeView space="library" onNavigate={navigateFromHome} />
            {/if}
        </div>
    {/if}
</main>

<ModalHost />
<TaskCenter />
<ToastHost />
