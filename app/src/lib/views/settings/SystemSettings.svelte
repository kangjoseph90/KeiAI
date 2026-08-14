<script lang="ts">
    import { onMount, tick } from 'svelte';
    import { SvelteSet } from 'svelte/reactivity';
    import { scale, slide } from 'svelte/transition';
    import {
        ArrowDown,
        Copy,
        Database,
        DatabaseZap,
        RefreshCw,
        Search,
        Trash2
    } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import {
        clearSystemLogs,
        deleteActiveLocalUser,
        isLoggedIn,
        performPurgeOrphans,
        performResetSyncCursors,
        serverTransitionLocked,
        systemLogs,
        t
    } from '$lib/stores';
    import type { LogEntry, LogLevel } from '$lib/adapters/logger';
    import {
        transformersModelCache,
        type TransformersModelCacheSnapshot
    } from '$lib/services/model_cache';
    import { appConfirm, toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';

    let cache = $state<TransformersModelCacheSnapshot | null>(null);
    let selected = $state<string[]>([]);
    let cacheBusy = $state(false);
    let maintenanceBusy = $state(false);

    // ─── System Logs State ──────────────────────────────────────────────
    let selectedLogLevel = $state<LogLevel | 'ALL'>('ALL');
    let logSearchQuery = $state('');
    let isAtBottom = $state(true);
    let hasNewLogs = $state(false);
    const expandedLogIds = new SvelteSet<string>();
    let logContainer = $state<HTMLElement | null>(null);

    function toggleLogExpand(id: string): void {
        if (expandedLogIds.has(id)) {
            expandedLogIds.delete(id);
        } else {
            expandedLogIds.add(id);
        }
    }

    const selectedSet = $derived(new Set(selected));
    const selectedBytes = $derived(
        cache?.models
            .filter((model) => selectedSet.has(model.key))
            .reduce((total, model) => total + model.sizeBytes, 0) ?? 0
    );
    const selectedUnknown = $derived(
        cache?.models.some((model) => selectedSet.has(model.key) && !model.sizeKnown) ?? false
    );

    const filteredLogs = $derived.by(() => {
        const query = logSearchQuery.trim().toLowerCase();
        return $systemLogs.filter((entry: LogEntry) => {
            if (selectedLogLevel !== 'ALL' && entry.level !== selectedLogLevel) {
                return false;
            }
            if (query.length > 0) {
                const inMsg = entry.message.toLowerCase().includes(query);
                const inNs = entry.namespace
                    ? entry.namespace.toLowerCase().includes(query)
                    : false;
                if (!inMsg && !inNs) return false;
            }
            return true;
        });
    });

    function handleScroll(): void {
        if (!logContainer) return;
        const threshold = 32;
        const atBottom =
            logContainer.scrollHeight - logContainer.scrollTop - logContainer.clientHeight <=
            threshold;
        isAtBottom = atBottom;
        if (atBottom) {
            hasNewLogs = false;
        }
    }

    function scrollToBottom(): void {
        if (!logContainer) return;
        logContainer.scrollTo({ top: logContainer.scrollHeight, behavior: 'smooth' });
        isAtBottom = true;
        hasNewLogs = false;
    }

    let previousLogCount = $state(0);

    $effect(() => {
        // Auto-scroll only when new logs are actually appended
        const currentCount = $systemLogs.length;
        if (currentCount > previousLogCount) {
            previousLogCount = currentCount;
            if (isAtBottom) {
                void tick().then(() => {
                    if (logContainer && isAtBottom) {
                        logContainer.scrollTop = logContainer.scrollHeight;
                    }
                });
            } else {
                hasNewLogs = true;
            }
        } else {
            previousLogCount = currentCount;
        }
    });

    onMount(() => {
        void refreshCache();
    });

    async function refreshCache(): Promise<void> {
        if (cacheBusy) return;
        cacheBusy = true;
        try {
            cache = await transformersModelCache.inspect();
            const availableKeys = new Set(cache.models.map((model) => model.key));
            selected = selected.filter((key) => availableKeys.has(key));
        } catch (error) {
            cache = { available: false, models: [], totalBytes: 0, totalSizeKnown: false };
            toast.error({
                title: $t('settings.system.modelCache.loadFailed'),
                description: getErrorMessage(error)
            });
        } finally {
            cacheBusy = false;
        }
    }

    function toggleModel(key: string, checked: boolean): void {
        selected = checked ? [...selected, key] : selected.filter((value) => value !== key);
    }

    async function clearSelectedModels(): Promise<void> {
        if (cacheBusy || selected.length === 0) return;
        if (
            !(await appConfirm({
                title: $t('settings.system.modelCache.clearTitle'),
                description: $t('settings.system.modelCache.clearBody'),
                confirmText: $t('settings.system.modelCache.clearButton'),
                variant: 'destructive'
            }))
        ) {
            return;
        }

        cacheBusy = true;
        try {
            await transformersModelCache.deleteModels(selected);
            selected = [];
            cache = await transformersModelCache.inspect();
            toast.success({ title: $t('settings.system.modelCache.clearSuccess') });
        } catch (error) {
            toast.error({
                title: $t('settings.system.modelCache.clearFailed'),
                description: getErrorMessage(error)
            });
        } finally {
            cacheBusy = false;
        }
    }

    async function runMaintenance(
        action: () => Promise<void>,
        confirmation: Parameters<typeof appConfirm>[0],
        successTitle?: string
    ): Promise<void> {
        if (maintenanceBusy) return;
        maintenanceBusy = true;
        try {
            if (!(await appConfirm(confirmation))) return;
            await action();
            if (successTitle) toast.success({ title: successTitle });
        } catch (error) {
            toast.error({
                title: $t('settings.system.maintenance.maintenanceFailed'),
                description: getErrorMessage(error)
            });
        } finally {
            maintenanceBusy = false;
        }
    }

    function handleResetSyncCursors(): void {
        void runMaintenance(
            performResetSyncCursors,
            {
                title: $t('settings.system.maintenance.resetTitle'),
                description: $t('settings.system.maintenance.resetBody'),
                confirmText: $t('common.confirm.reset')
            },
            $t('settings.system.maintenance.resetSuccess')
        );
    }

    function handlePurgeOrphans(): void {
        void runMaintenance(
            performPurgeOrphans,
            {
                title: $t('settings.system.maintenance.purgeTitle'),
                description: $t('settings.system.maintenance.purgeBody'),
                confirmText: $t('common.actions.delete'),
                variant: 'destructive'
            },
            $t('settings.system.maintenance.purgeSuccess')
        );
    }

    function handleDeleteLocalUser(): void {
        void runMaintenance(deleteActiveLocalUser, {
            title: $t('settings.system.maintenance.deleteUserTitle'),
            description: $t('settings.system.maintenance.deleteUserBody'),
            confirmText: $t('settings.system.maintenance.deleteUser'),
            variant: 'destructive'
        });
    }

    function formatBytes(bytes: number, approximate = false): string {
        if (approximate && bytes === 0) return $t('settings.system.modelCache.unknownSize');
        const suffix = approximate ? '+' : '';
        if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB${suffix}`;
        if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB${suffix}`;
        return `${(bytes / 1_000_000_000).toFixed(2)} GB${suffix}`;
    }

    function formatLogTime(date: Date): string {
        const d = date instanceof Date ? date : new Date(date);
        const h = String(d.getHours()).padStart(2, '0');
        const m = String(d.getMinutes()).padStart(2, '0');
        const s = String(d.getSeconds()).padStart(2, '0');
        const ms = String(d.getMilliseconds()).padStart(3, '0');
        return `${h}:${m}:${s}.${ms}`;
    }

    function getLogLevelBadgeClass(level: LogLevel): string {
        switch (level) {
            case 'DEBUG':
                return 'text-muted-foreground bg-muted';
            case 'INFO':
                return 'text-sky-600 bg-sky-500/10 dark:text-sky-400 dark:bg-sky-500/20';
            case 'WARN':
                return 'text-amber-600 bg-amber-500/10 dark:text-amber-400 dark:bg-amber-500/20';
            case 'ERROR':
                return 'text-destructive bg-destructive/10 dark:bg-destructive/20';
        }
    }

    async function handleCopyLogs(): Promise<void> {
        if (filteredLogs.length === 0) return;
        const text = filteredLogs
            .map((entry) => {
                const ns = entry.namespace ? `[${entry.namespace}]` : '';
                return `[${formatLogTime(entry.timestamp)}][${entry.level}]${ns} ${entry.message}`;
            })
            .join('\n');

        try {
            await navigator.clipboard.writeText(text);
            toast.success({ title: $t('settings.system.logs.copied') });
        } catch (error) {
            toast.error({
                title: $t('settings.system.logs.copy'),
                description: getErrorMessage(error)
            });
        }
    }
</script>

<div class="space-y-8 pb-8">
    <section class="space-y-3">
        <div class="flex items-start justify-between gap-4">
            <div>
                <h3 class="text-lg font-semibold tracking-tight text-foreground">
                    {$t('settings.system.modelCache.title')}
                </h3>
                <p class="text-sm text-muted-foreground">
                    {$t('settings.system.modelCache.description')}
                </p>
            </div>
            <Button
                variant="ghost"
                size="icon-sm"
                disabled={cacheBusy}
                aria-label={$t('settings.system.modelCache.refresh')}
                title={$t('settings.system.modelCache.refresh')}
                onclick={() => void refreshCache()}
            >
                <RefreshCw class={cacheBusy ? 'size-4 animate-spin' : 'size-4'} />
            </Button>
        </div>

        <div class="overflow-hidden rounded-lg border border-border bg-card">
            {#if cache === null && cacheBusy}
                <div class="px-4 py-8 text-center text-sm text-muted-foreground">
                    {$t('settings.system.modelCache.loading')}
                </div>
            {:else if cache && !cache.available}
                <div class="px-4 py-8 text-center text-sm text-muted-foreground">
                    {$t('settings.system.modelCache.unavailable')}
                </div>
            {:else if cache?.models.length === 0}
                <div class="px-4 py-8 text-center text-sm text-muted-foreground">
                    {$t('settings.system.modelCache.empty')}
                </div>
            {:else if cache}
                <div class="divide-y divide-border">
                    {#each cache.models as model (model.key)}
                        <label
                            class="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-muted/40"
                        >
                            <input
                                type="checkbox"
                                class="size-4 shrink-0 rounded border-primary"
                                checked={selectedSet.has(model.key)}
                                disabled={cacheBusy}
                                onchange={(event) =>
                                    toggleModel(model.key, event.currentTarget.checked)}
                            />
                            <span class="min-w-0 flex-1">
                                <span class="block truncate text-sm font-medium">{model.name}</span>
                                <span
                                    class="block truncate font-mono text-[11px] text-muted-foreground"
                                >
                                    {model.modelId}@{model.revision}
                                </span>
                            </span>
                            <span
                                class="shrink-0 font-mono text-sm tabular-nums text-muted-foreground"
                            >
                                {formatBytes(model.sizeBytes, !model.sizeKnown)}
                            </span>
                        </label>
                    {/each}
                </div>

                <div
                    class="flex min-h-12 flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/20 px-4 py-2.5"
                >
                    <span class="text-sm text-muted-foreground">
                        {$t('settings.system.modelCache.totalSize', {
                            size: formatBytes(cache.totalBytes, !cache.totalSizeKnown)
                        })}
                    </span>
                    <div class="flex items-center gap-3">
                        <span class="text-sm text-muted-foreground">
                            {$t('settings.system.modelCache.selectedSize', {
                                count: selected.length,
                                size: formatBytes(selectedBytes, selectedUnknown)
                            })}
                        </span>
                        <Button
                            variant={selected.length > 0 ? 'destructive' : 'outline'}
                            size="sm"
                            class="gap-1.5"
                            disabled={cacheBusy || selected.length === 0}
                            onclick={() => void clearSelectedModels()}
                        >
                            <Trash2 class="size-4" />
                            {$t('settings.system.modelCache.clearSelected')}
                        </Button>
                    </div>
                </div>
            {/if}
        </div>
    </section>

    <div class="border-t border-border"></div>

    <section class="space-y-3">
        <div>
            <h3 class="text-lg font-semibold tracking-tight text-foreground">
                {$t('settings.system.maintenance.title')}
            </h3>
            <p class="text-sm text-muted-foreground">
                {$t('settings.system.maintenance.description')}
            </p>
        </div>
        <div class="divide-y divide-border" aria-busy={maintenanceBusy}>
            <div class="flex items-center justify-between py-3.5">
                <div class="space-y-0.5 pr-4">
                    <Label class="text-sm font-medium"
                        >{$t('settings.system.maintenance.resetSync')}</Label
                    >
                    <p class="text-xs text-muted-foreground">
                        {$t('settings.system.maintenance.resetSyncHelp')}
                    </p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    class="gap-1.5 shrink-0"
                    disabled={maintenanceBusy || !$isLoggedIn || $serverTransitionLocked}
                    onclick={handleResetSyncCursors}
                >
                    <DatabaseZap class="size-4" />
                    {$t('settings.system.maintenance.resetButton')}
                </Button>
            </div>

            <div class="flex items-center justify-between py-3.5">
                <div class="space-y-0.5 pr-4">
                    <Label class="text-sm font-medium"
                        >{$t('settings.system.maintenance.purgeOrphans')}</Label
                    >
                    <p class="text-xs text-muted-foreground">
                        {$t('settings.system.maintenance.purgeOrphansHelp')}
                    </p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    class="gap-1.5 shrink-0"
                    disabled={maintenanceBusy || $serverTransitionLocked}
                    onclick={handlePurgeOrphans}
                >
                    <Database class="size-4" />
                    {$t('settings.system.maintenance.purgeButton')}
                </Button>
            </div>

            <div class="flex items-center justify-between py-3.5">
                <div class="space-y-0.5 pr-4">
                    <Label class="text-sm font-medium text-destructive">
                        {$t('settings.system.maintenance.deleteUser')}
                    </Label>
                    <p class="text-xs text-muted-foreground">
                        {$t('settings.system.maintenance.deleteUserHelp')}
                    </p>
                </div>
                <Button
                    variant="destructive"
                    size="sm"
                    class="gap-1.5 shrink-0"
                    disabled={maintenanceBusy || $serverTransitionLocked}
                    onclick={handleDeleteLocalUser}
                >
                    <Trash2 class="size-4" />
                    {$t('settings.system.maintenance.deleteButton')}
                </Button>
            </div>
        </div>
    </section>

    <div class="border-t border-border"></div>

    <!-- ─── System Logs Section ─────────────────────────────────────────── -->
    <section class="space-y-3">
        <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
                <h3 class="text-lg font-semibold tracking-tight text-foreground">
                    {$t('settings.system.logs.title')}
                </h3>
                <p class="text-sm text-muted-foreground">
                    {$t('settings.system.logs.description')}
                </p>
            </div>
            <div class="flex items-center gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    class="gap-1.5"
                    disabled={filteredLogs.length === 0}
                    onclick={() => void handleCopyLogs()}
                >
                    <Copy class="size-3.5" />
                    <span class="text-xs">{$t('settings.system.logs.copy')}</span>
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    class="gap-1.5"
                    disabled={$systemLogs.length === 0}
                    onclick={clearSystemLogs}
                >
                    <Trash2 class="size-3.5" />
                    <span class="text-xs">{$t('settings.system.logs.clear')}</span>
                </Button>
            </div>
        </div>

        <div class="space-y-2.5">
            <!-- Filter Toolbar -->
            <div class="flex flex-wrap items-center gap-2">
                <div class="relative flex-1 min-w-50">
                    <Search
                        class="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none"
                    />
                    <Input
                        type="text"
                        class="h-8 pl-8 text-xs"
                        placeholder={$t('settings.system.logs.searchPlaceholder')}
                        bind:value={logSearchQuery}
                    />
                </div>
                <select
                    class="h-8 rounded-md border border-input bg-background px-2.5 text-xs font-medium text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring"
                    bind:value={selectedLogLevel}
                >
                    <option value="ALL">{$t('settings.system.logs.filterAll')}</option>
                    <!-- i18n-ignore: standard log level names -->
                    <option value="DEBUG">DEBUG</option>
                    <!-- i18n-ignore: standard log level names -->
                    <option value="INFO">INFO</option>
                    <!-- i18n-ignore: standard log level names -->
                    <option value="WARN">WARN</option>
                    <!-- i18n-ignore: standard log level names -->
                    <option value="ERROR">ERROR</option>
                </select>
            </div>

            <!-- Console Log Container -->
            <div class="relative overflow-hidden rounded-lg border border-border bg-card">
                <div
                    bind:this={logContainer}
                    onscroll={handleScroll}
                    class="h-80 overflow-y-auto overflow-x-auto p-2.5 font-mono text-xs bg-muted/10 leading-relaxed divide-y divide-border/20"
                >
                    {#if filteredLogs.length === 0}
                        <div
                            class="flex h-full min-h-40 items-center justify-center text-sm text-muted-foreground"
                        >
                            {$t('settings.system.logs.empty')}
                        </div>
                    {:else}
                        {#each filteredLogs as entry (entry.id)}
                            {@const isExpanded = expandedLogIds.has(entry.id)}
                            <div
                                role="button"
                                tabindex="0"
                                class={`group rounded transition-colors hover:bg-muted/30 cursor-pointer -mx-1 px-1.5 py-1 ${
                                    isExpanded ? 'bg-muted/20' : ''
                                }`}
                                onclick={() => toggleLogExpand(entry.id)}
                                onkeydown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        toggleLogExpand(entry.id);
                                    }
                                }}
                            >
                                <div class="flex items-center gap-2">
                                    <span
                                        class={`w-11.5 shrink-0 text-center text-[10px] font-semibold px-1 py-0.5 rounded uppercase select-none ${getLogLevelBadgeClass(entry.level)}`}
                                    >
                                        {entry.level}
                                    </span>
                                    <span
                                        class="w-19.5 shrink-0 text-[11px] text-muted-foreground select-none tabular-nums"
                                    >
                                        {formatLogTime(entry.timestamp)}
                                    </span>
                                    {#if entry.namespace}
                                        <span
                                            class="shrink-0 text-[11px] text-muted-foreground font-medium select-none"
                                        >
                                            [{entry.namespace}]
                                        </span>
                                    {/if}
                                    {#if !isExpanded}
                                        <span
                                            class="min-w-0 flex-1 truncate select-text text-foreground"
                                        >
                                            {entry.message}
                                        </span>
                                    {/if}
                                </div>
                                {#if isExpanded}
                                    <div
                                        transition:slide={{ duration: 150 }}
                                        class="w-full break-all whitespace-pre-wrap select-text text-foreground text-xs leading-relaxed overflow-hidden pt-1"
                                    >
                                        {entry.message}
                                    </div>
                                {/if}
                            </div>
                        {/each}
                    {/if}
                </div>

                <!-- Floating Scroll-to-bottom button when user scrolled up -->
                {#if !isAtBottom}
                    <div
                        transition:scale={{ duration: 150, start: 0.85 }}
                        class="absolute bottom-3 right-4 z-10"
                    >
                        <Button
                            variant="secondary"
                            size="icon-sm"
                            class="flex items-center justify-center rounded-full border border-border/80 bg-background/80 shadow-md backdrop-blur-sm transition-all duration-150 active:scale-90 hover:scale-105 hover:bg-accent"
                            onclick={scrollToBottom}
                            aria-label={$t('settings.system.logs.scrollToBottom')}
                        >
                            <ArrowDown class="size-4" />
                        </Button>
                    </div>
                {/if}
            </div>
        </div>
    </section>
</div>
