<script lang="ts">
    import { onMount } from 'svelte';
    import { Database, DatabaseZap, RefreshCw, Trash2 } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Label } from '$lib/components/ui/label';
    import {
        deleteActiveLocalUser,
        isLoggedIn,
        performPurgeOrphans,
        performResetSyncCursors,
        serverTransitionLocked,
        t
    } from '$lib/stores';
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

    const selectedSet = $derived(new Set(selected));
    const selectedBytes = $derived(
        cache?.models
            .filter((model) => selectedSet.has(model.key))
            .reduce((total, model) => total + model.sizeBytes, 0) ?? 0
    );
    const selectedUnknown = $derived(
        cache?.models.some((model) => selectedSet.has(model.key) && !model.sizeKnown) ?? false
    );

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
</div>
