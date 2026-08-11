<script lang="ts">
    import { isTauri } from '@tauri-apps/api/core';
    import { AlertTriangle, Cloud, Network, Server, Unplug } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import {
        activeUser,
        changeProxyConnection,
        changeServerConnection,
        serverTransitionLocked,
        serverTransitionProgress,
        t
    } from '$lib/stores';
    import { isKeiDefaultProxy, isKeiDefaultServer, PB_URL, PROXY_URL } from '$lib/config';
    import type { ProxyMode, ServerMode } from '$lib/types/connections';
    import { getErrorMessage } from '$lib/types/errors';
    import { toast } from '$lib/ui';

    const nativeRuntime = isTauri();
    const defaultServerLabel = $derived(
        isKeiDefaultServer()
            ? $t('settings.connections.defaultServer')
            : $t('settings.connections.defaultServerBadge')
    );
    const defaultProxyLabel = $derived(
        isKeiDefaultProxy()
            ? $t('settings.connections.defaultProxy')
            : $t('settings.connections.defaultProxyBadge')
    );

    let hydratedUserId = $state('');
    let serverMode = $state<ServerMode>('default');
    let serverCustomUrl = $state('');
    let proxyMode = $state<ProxyMode>('default');
    let proxyCustomUrl = $state('');
    let serverBusy = $state(false);
    let proxyBusy = $state(false);

    $effect(() => {
        const user = $activeUser;
        if (!user || user.id === hydratedUserId) return;
        hydratedUserId = user.id;
        serverMode = user.connections.server.mode;
        serverCustomUrl = user.connections.server.customUrl ?? '';
        proxyMode = user.connections.proxy.mode;
        proxyCustomUrl = user.connections.proxy.customUrl ?? '';
    });

    async function saveServer(): Promise<void> {
        if (serverBusy) return;
        serverBusy = true;
        try {
            await changeServerConnection({
                mode: serverMode,
                customUrl: serverCustomUrl.trim() || undefined
            });
            toast.success({ title: $t('settings.connections.toast.serverUpdated') });
        } catch (error) {
            toast.error({
                title: $t('settings.connections.toast.serverFailed'),
                description: getErrorMessage(error)
            });
        } finally {
            serverBusy = false;
        }
    }

    async function saveProxy(): Promise<void> {
        if (proxyBusy) return;
        proxyBusy = true;
        try {
            await changeProxyConnection({
                mode: proxyMode,
                customUrl: proxyCustomUrl.trim() || undefined
            });
            toast.success({ title: $t('settings.connections.toast.proxyUpdated') });
        } catch (error) {
            toast.error({
                title: $t('settings.connections.toast.proxyFailed'),
                description: getErrorMessage(error)
            });
        } finally {
            proxyBusy = false;
        }
    }
</script>

<div class="space-y-8 pb-8">
    <!-- Server Section -->
    <section class="space-y-4">
        <div>
            <h3
                class="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground"
            >
                <Server class="size-5" />
                {$t('settings.connections.serverTitle')}
            </h3>
            <p class="text-sm text-muted-foreground">
                {$t('settings.connections.serverDescription')}
            </p>
        </div>

        <div class="space-y-4" aria-busy={serverBusy || $serverTransitionLocked}>
            <div class="grid gap-2 sm:grid-cols-2">
                <button
                    type="button"
                    class="min-h-13 rounded-lg border border-border px-3 py-2 text-left transition-colors {serverMode ===
                    'default'
                        ? 'border-foreground/25 bg-accent/50'
                        : 'hover:bg-muted/50'}"
                    onclick={() => (serverMode = 'default')}
                >
                    <div class="flex items-center gap-2 font-medium">
                        <Cloud class="size-4" />
                        {defaultServerLabel}
                    </div>
                    <p class="mt-1 truncate text-xs text-muted-foreground">{PB_URL}</p>
                </button>
                <button
                    type="button"
                    class="min-h-13 rounded-lg border border-border px-3 py-2 text-left transition-colors {serverMode ===
                    'custom'
                        ? 'border-foreground/25 bg-accent/50'
                        : 'hover:bg-muted/50'}"
                    onclick={() => (serverMode = 'custom')}
                >
                    <div class="flex items-center gap-2 font-medium">
                        <Server class="size-4" />
                        {$t('settings.connections.custom')}
                    </div>
                    <p class="mt-1 text-xs text-muted-foreground">
                        {$t('settings.connections.serverCustomHelp')}
                    </p>
                </button>
            </div>

            {#if serverMode === 'custom'}
                <div class="space-y-2">
                    <Label for="custom-server-url"
                        >{$t('settings.connections.customServerLabel')}</Label
                    >
                    <Input
                        id="custom-server-url"
                        bind:value={serverCustomUrl}
                        type="url"
                        placeholder="https://server.example.com"
                        disabled={serverBusy || $serverTransitionLocked}
                    />
                </div>
            {/if}

            <p class="text-xs text-muted-foreground">
                {$t('settings.connections.serverChangeWarning')}
            </p>

            {#if $serverTransitionProgress}
                <div class="space-y-2 text-xs text-muted-foreground">
                    <div class="flex justify-between">
                        <span>{$serverTransitionProgress.phase}</span>
                        <span>
                            {$serverTransitionProgress.completed} / {$serverTransitionProgress.total}
                        </span>
                    </div>
                    <div class="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                            class="h-full bg-primary transition-all"
                            style={`width: ${
                                $serverTransitionProgress.total
                                    ? ($serverTransitionProgress.completed /
                                          $serverTransitionProgress.total) *
                                      100
                                    : 0
                            }%`}
                        ></div>
                    </div>
                </div>
            {/if}

            <Button size="sm" disabled={serverBusy || $serverTransitionLocked} onclick={saveServer}>
                {$t('settings.connections.saveServer')}
            </Button>
        </div>
    </section>

    {#if !nativeRuntime}
        <div class="border-t border-border"></div>

        <!-- Proxy Section -->
        <section class="space-y-4">
            <div>
                <h3
                    class="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground"
                >
                    <Network class="size-5" />
                    {$t('settings.connections.proxyTitle')}
                </h3>
                <p class="text-sm text-muted-foreground">
                    {$t('settings.connections.proxyDescription')}
                </p>
            </div>

            <div class="space-y-4" aria-busy={proxyBusy}>
                <div class="grid gap-2 sm:grid-cols-3">
                    <button
                        type="button"
                        class="min-h-13 rounded-lg border border-border px-3 py-2 text-left transition-colors {proxyMode ===
                        'default'
                            ? 'border-foreground/25 bg-accent/50'
                            : 'hover:bg-muted/50'}"
                        onclick={() => (proxyMode = 'default')}
                    >
                        <div class="flex items-center gap-2 font-medium">
                            <Network class="size-4" />
                            {defaultProxyLabel}
                        </div>
                        <p class="mt-1 truncate text-xs text-muted-foreground">{PROXY_URL}</p>
                    </button>
                    <button
                        type="button"
                        class="min-h-13 rounded-lg border border-border px-3 py-2 text-left transition-colors {proxyMode ===
                        'custom'
                            ? 'border-foreground/25 bg-accent/50'
                            : 'hover:bg-muted/50'}"
                        onclick={() => (proxyMode = 'custom')}
                    >
                        <div class="flex items-center gap-2 font-medium">
                            <Server class="size-4" />
                            {$t('settings.connections.custom')}
                        </div>
                        <p class="mt-1 text-xs text-muted-foreground">
                            {$t('settings.connections.proxyCustomHelp')}
                        </p>
                    </button>
                    <button
                        type="button"
                        class="min-h-13 rounded-lg border border-border px-3 py-2 text-left transition-colors {proxyMode ===
                        'off'
                            ? 'border-foreground/25 bg-accent/50'
                            : 'hover:bg-muted/50'}"
                        onclick={() => (proxyMode = 'off')}
                    >
                        <div class="flex items-center gap-2 font-medium">
                            <Unplug class="size-4" />
                            {$t('settings.connections.off')}
                        </div>
                        <p class="mt-1 text-xs text-muted-foreground">
                            {$t('settings.connections.proxyOffHelp')}
                        </p>
                    </button>
                </div>

                {#if proxyMode === 'custom'}
                    <div class="space-y-2">
                        <Label for="custom-proxy-url"
                            >{$t('settings.connections.customProxyLabel')}</Label
                        >
                        <Input
                            id="custom-proxy-url"
                            bind:value={proxyCustomUrl}
                            type="url"
                            placeholder="https://proxy.example.com"
                            disabled={proxyBusy}
                        />
                        <div
                            class="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300"
                        >
                            <AlertTriangle class="mt-0.5 size-4 shrink-0" />
                            <span>
                                {$t('settings.connections.proxyWarning')}
                            </span>
                        </div>
                    </div>
                {:else if proxyMode === 'off'}
                    <div
                        class="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300"
                    >
                        <AlertTriangle class="mt-0.5 size-4 shrink-0" />
                        <span>{$t('settings.connections.proxyCorsNote')}</span>
                    </div>
                {/if}

                <Button size="sm" disabled={proxyBusy} onclick={saveProxy}
                    >{$t('settings.connections.saveProxy')}</Button
                >
            </div>
        </section>
    {/if}
</div>
