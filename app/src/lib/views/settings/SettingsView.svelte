<script lang="ts">
    import {
        User,
        Shield,
        Cpu,
        Sparkles,
        Settings,
        Puzzle,
        MessageSquare,
        Languages,
        Network,
        DatabaseZap,
        Trash2,
        BrainCircuit,
        Brain,
        Layers,
        LayoutGrid,
        Wand2,
        Shapes
    } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import OptionSelect from '$lib/components/OptionSelect.svelte';
    import SettingRow from '$lib/components/SettingRow.svelte';
    import { WorkspaceShell } from '$lib/components/layout';
    import { Label } from '$lib/components/ui/label';
    import { ScrollArea } from '$lib/components/ui/scroll-area';

    import { Badge } from '$lib/components/ui/badge';
    import {
        appSettings,
        t,
        themePreference,
        updateSettings,
        updateThemePreference,
        activePreset,
        activeRoom,
        activeChat,
        deleteActiveLocalUser,
        isLoggedIn,
        performPurgeOrphans,
        performResetSyncCursors,
        serverTransitionLocked
    } from '$lib/stores';
    import { navigate } from '$lib/router';
    import type { SettingsTab } from '$lib/router';
    import AccountSettings from './AccountSettings.svelte';
    import ConnectionsSettings from './ConnectionsSettings.svelte';
    import ProfileSettings from './ProfileSettings.svelte';
    import ModelsSettings from './ModelsSettings.svelte';
    import ServicesSettings from './ServicesSettings.svelte';
    import ChatSettings from './ChatSettings.svelte';
    import LanguageSettings from './LanguageSettings.svelte';
    import PluginsView from './PluginsView.svelte';
    import { appConfirm, toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';
    import type { ThemePreference } from '$lib/stores';
    import WorkflowSummaryCard from '$lib/views/workflow/WorkflowSummaryCard.svelte';
    import WorkflowEditorModal from '$lib/views/workflow/WorkflowEditorModal.svelte';

    let { settingsTab }: { settingsTab?: SettingsTab } = $props();
    let localTab = $state<SettingsTab>('models');
    let activeTab = $derived(settingsTab ?? localTab);
    let settingsBusy = $state(false);
    let themeBusy = $state(false);
    let maintenanceBusy = $state(false);
    let suggestionWorkflowEditorOpen = $state(false);
    let titleWorkflowEditorOpen = $state(false);

    const tabs = $derived([
        { id: 'models', label: $t('settings.tabs.models'), icon: Layers },
        { id: 'chat', label: $t('settings.tabs.chat'), icon: MessageSquare },
        { id: 'services', label: $t('settings.tabs.services'), icon: LayoutGrid },
        { id: 'plugins', label: $t('settings.tabs.plugins'), icon: Puzzle },
        { id: 'language', label: $t('settings.tabs.language'), icon: Languages },
        { id: 'profile', label: $t('settings.tabs.profile'), icon: User },
        { id: 'account', label: $t('settings.tabs.account'), icon: Shield },
        { id: 'connections', label: $t('settings.tabs.connections'), icon: Network },
        { id: 'general', label: $t('settings.tabs.general'), icon: Settings }
    ] as const);

    async function handleThemeChange(preference: ThemePreference): Promise<void> {
        if (themeBusy || preference === $themePreference) return;
        themeBusy = true;
        try {
            await updateThemePreference(preference);
        } catch (error) {
            toast.error({
                title: $t('settings.theme.updateFailed'),
                description: getErrorMessage(error)
            });
        } finally {
            themeBusy = false;
        }
    }

    async function updateSettingsSafely(
        changes: Parameters<typeof updateSettings>[0]
    ): Promise<void> {
        if (settingsBusy) return;
        settingsBusy = true;
        try {
            await updateSettings(changes);
        } catch (error) {
            toast.error({
                title: $t('settings.updateFailed'),
                description: getErrorMessage(error)
            });
        } finally {
            settingsBusy = false;
        }
    }

    function backToChat() {
        if ($activeRoom && $activeChat) {
            navigate({ view: 'room', roomId: $activeRoom.id, chatId: $activeChat.id });
        } else if ($activeRoom) {
            navigate({ view: 'room', roomId: $activeRoom.id });
        } else {
            navigate({ view: 'home' });
        }
    }

    function openTab(tab: SettingsTab) {
        localTab = tab;
        navigate({ view: 'settings', settingsTab: tab });
    }

    function returnToTabs() {
        navigate({ view: 'settings' });
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
                title: $t('settings.general.maintenance.maintenanceFailed'),
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
                title: $t('settings.general.maintenance.resetTitle'),
                description: $t('settings.general.maintenance.resetBody'),
                confirmText: $t('common.confirm.reset')
            },
            $t('settings.general.maintenance.resetSuccess')
        );
    }

    function handlePurgeOrphans(): void {
        void runMaintenance(
            performPurgeOrphans,
            {
                title: $t('settings.general.maintenance.purgeTitle'),
                description: $t('settings.general.maintenance.purgeBody'),
                confirmText: $t('common.actions.delete'),
                variant: 'destructive'
            },
            $t('settings.general.maintenance.purgeSuccess')
        );
    }

    function handleDeleteLocalUser(): void {
        void runMaintenance(deleteActiveLocalUser, {
            title: $t('settings.general.maintenance.deleteUserTitle'),
            description: $t('settings.general.maintenance.deleteUserBody'),
            confirmText: $t('settings.general.maintenance.deleteUser'),
            variant: 'destructive'
        });
    }
</script>

{#snippet titleExtra()}
    {#if $activePreset && (activeTab === 'models' || activeTab === 'chat')}
        <Badge variant="outline" class="font-mono text-xs shrink-0">
            {$activePreset.name}
        </Badge>
    {/if}
{/snippet}

<WorkspaceShell
    workspaceName={$t('settings.title')}
    sections={tabs}
    activeSection={activeTab}
    showDetail={settingsTab !== undefined}
    onSelect={openTab}
    onBack={returnToTabs}
    onClose={backToChat}
    closeLabel={$t('settings.close')}
    {titleExtra}
>
    {#if activeTab === 'models'}
        <div class="min-h-0 w-full max-w-4xl flex-1 px-4 pt-3 pb-4 md:px-8 md:pb-8 md:pt-1">
            <ModelsSettings />
        </div>
    {:else if activeTab === 'chat'}
        <div class="min-h-0 w-full max-w-4xl flex-1 px-4 pt-3 pb-4 md:px-8 md:pb-8 md:pt-1">
            <ChatSettings />
        </div>
    {:else if activeTab === 'services'}
        <div class="min-h-0 w-full max-w-4xl flex-1 px-4 pt-3 pb-4 md:px-8 md:pb-8 md:pt-1">
            <ServicesSettings />
        </div>
    {:else}
        <ScrollArea class="min-h-0 flex-1">
            <div class="max-w-4xl space-y-5 p-4 md:px-8 md:pb-8 md:pt-4">
                {#if activeTab === 'plugins'}
                    <PluginsView />
                {:else if activeTab === 'language'}
                    <LanguageSettings />
                {:else if activeTab === 'profile'}
                    <ProfileSettings />
                {:else if activeTab === 'account'}
                    <AccountSettings />
                {:else if activeTab === 'connections'}
                    <ConnectionsSettings />
                {:else if activeTab === 'general'}
                    <div class="space-y-8 pb-8">
                        <!-- Appearance Section -->
                        <section class="space-y-3">
                            <div>
                                <h3 class="text-lg font-semibold tracking-tight text-foreground">
                                    {$t('settings.general.appearance.title')}
                                </h3>
                                <p class="text-sm text-muted-foreground">
                                    {$t('settings.general.appearance.description')}
                                </p>
                            </div>
                            <div class="divide-y divide-border">
                                <div class="flex items-center justify-between py-3.5">
                                    <div class="space-y-0.5">
                                        <Label for="setting-color-theme" class="text-sm font-medium"
                                            >{$t('settings.general.theme.label')}</Label
                                        >
                                        <p class="text-xs text-muted-foreground">
                                            {$t('settings.general.theme.description')}
                                        </p>
                                    </div>
                                    <OptionSelect
                                        id="setting-color-theme"
                                        class="w-auto min-w-28"
                                        value={$themePreference}
                                        disabled={themeBusy}
                                        ariaBusy={themeBusy}
                                        options={[
                                            {
                                                value: 'system',
                                                label: $t('settings.general.theme.system')
                                            },
                                            {
                                                value: 'light',
                                                label: $t('settings.general.theme.light')
                                            },
                                            {
                                                value: 'dark',
                                                label: $t('settings.general.theme.dark')
                                            }
                                        ]}
                                        onChange={(value) =>
                                            handleThemeChange(value as ThemePreference)}
                                    />
                                </div>
                            </div>
                        </section>

                        <div class="border-t border-border"></div>

                        <!-- Chat Interface Section -->
                        <section class="space-y-3">
                            <div>
                                <h3 class="text-lg font-semibold tracking-tight text-foreground">
                                    {$t('settings.general.chatInterface.title')}
                                </h3>
                                <p class="text-sm text-muted-foreground">
                                    {$t('settings.general.chatInterface.description')}
                                </p>
                            </div>
                            <div class="divide-y divide-border">
                                <div class="flex items-center justify-between py-3.5">
                                    <div class="space-y-0.5 pr-4">
                                        <Label
                                            for="setting-auto-generate-response"
                                            class="text-sm font-medium cursor-pointer"
                                        >
                                            {$t('settings.general.chatInterface.autoGenerate')}
                                        </Label>
                                        <p class="text-xs text-muted-foreground">
                                            {$t('settings.general.chatInterface.autoGenerateHelp')}
                                        </p>
                                    </div>
                                    <input
                                        id="setting-auto-generate-response"
                                        type="checkbox"
                                        class="size-5 shrink-0 rounded border-primary cursor-pointer"
                                        checked={$appSettings?.chat?.autoGenerateResponse !== false}
                                        disabled={settingsBusy}
                                        onchange={(e) =>
                                            updateSettingsSafely({
                                                chat: {
                                                    autoGenerateResponse: e.currentTarget.checked
                                                }
                                            })}
                                    />
                                </div>

                                <div class="flex items-center justify-between py-3.5">
                                    <div class="space-y-0.5 pr-4">
                                        <Label
                                            for="setting-save-messages-on-swipe"
                                            class="text-sm font-medium cursor-pointer"
                                        >
                                            {$t('settings.general.chatInterface.saveOnSwipe')}
                                        </Label>
                                        <p class="text-xs text-muted-foreground">
                                            {$t('settings.general.chatInterface.saveOnSwipeHelp')}
                                        </p>
                                    </div>
                                    <input
                                        id="setting-save-messages-on-swipe"
                                        type="checkbox"
                                        class="size-5 shrink-0 rounded border-primary cursor-pointer"
                                        checked={$appSettings?.chat?.saveMessagesOnSwipe !== false}
                                        disabled={settingsBusy}
                                        onchange={(e) =>
                                            updateSettingsSafely({
                                                chat: {
                                                    saveMessagesOnSwipe: e.currentTarget.checked
                                                }
                                            })}
                                    />
                                </div>

                                <div class="flex items-center justify-between py-3.5">
                                    <div class="space-y-0.5 pr-4">
                                        <Label
                                            for="setting-expand-steps"
                                            class="text-sm font-medium cursor-pointer"
                                        >
                                            {$t('settings.general.chatInterface.expandSteps')}
                                        </Label>
                                        <p class="text-xs text-muted-foreground">
                                            {$t('settings.general.chatInterface.expandStepsHelp')}
                                        </p>
                                    </div>
                                    <input
                                        id="setting-expand-steps"
                                        type="checkbox"
                                        class="size-5 shrink-0 rounded border-primary cursor-pointer"
                                        checked={$appSettings?.chat?.expandStepsOnGeneration !==
                                            false}
                                        disabled={settingsBusy}
                                        onchange={(e) =>
                                            updateSettingsSafely({
                                                chat: {
                                                    expandStepsOnGeneration: e.currentTarget.checked
                                                }
                                            })}
                                    />
                                </div>
                            </div>
                        </section>

                        <div class="border-t border-border"></div>

                        <section class="space-y-3">
                            <div>
                                <h3 class="text-lg font-semibold tracking-tight text-foreground">
                                    {$t('settings.general.inference.title')}
                                </h3>
                                <p class="text-sm text-muted-foreground">
                                    {$t('settings.general.inference.description')}
                                </p>
                            </div>
                            {#if $appSettings}
                                <div class="grid gap-4 sm:grid-cols-2">
                                    <WorkflowSummaryCard
                                        fullWidth
                                        workflow={$appSettings.suggestion.workflow}
                                        onEditWorkflow={() => (suggestionWorkflowEditorOpen = true)}
                                        onPatch={(patch) =>
                                            updateSettings({ suggestion: { workflow: patch } })}
                                        workflowLabel={$t(
                                            'settings.general.inference.suggestionWorkflow'
                                        )}
                                    />
                                    <WorkflowSummaryCard
                                        fullWidth
                                        workflow={$appSettings.titleGeneration.workflow}
                                        onEditWorkflow={() => (titleWorkflowEditorOpen = true)}
                                        onPatch={(patch) =>
                                            updateSettings({
                                                titleGeneration: { workflow: patch }
                                            })}
                                        workflowLabel={$t(
                                            'settings.general.inference.titleWorkflow'
                                        )}
                                    />
                                </div>
                            {/if}
                        </section>

                        <div class="border-t border-border"></div>

                        <!-- Local Data Maintenance Section -->
                        <section class="space-y-3">
                            <div>
                                <h3 class="text-lg font-semibold tracking-tight text-foreground">
                                    {$t('settings.general.maintenance.title')}
                                </h3>
                                <p class="text-sm text-muted-foreground">
                                    {$t('settings.general.maintenance.description')}
                                </p>
                            </div>
                            <div class="divide-y divide-border" aria-busy={maintenanceBusy}>
                                <div class="flex items-center justify-between py-3.5">
                                    <div class="space-y-0.5 pr-4">
                                        <Label class="text-sm font-medium"
                                            >{$t('settings.general.maintenance.resetSync')}</Label
                                        >
                                        <p class="text-xs text-muted-foreground">
                                            {$t('settings.general.maintenance.resetSyncHelp')}
                                        </p>
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        class="gap-1.5 shrink-0"
                                        disabled={maintenanceBusy ||
                                            !$isLoggedIn ||
                                            $serverTransitionLocked}
                                        onclick={handleResetSyncCursors}
                                    >
                                        <DatabaseZap class="size-4" />
                                        {$t('settings.general.maintenance.resetButton')}
                                    </Button>
                                </div>

                                <div class="flex items-center justify-between py-3.5">
                                    <div class="space-y-0.5 pr-4">
                                        <Label class="text-sm font-medium"
                                            >{$t(
                                                'settings.general.maintenance.purgeOrphans'
                                            )}</Label
                                        >
                                        <p class="text-xs text-muted-foreground">
                                            {$t('settings.general.maintenance.purgeOrphansHelp')}
                                        </p>
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        class="gap-1.5 shrink-0"
                                        disabled={maintenanceBusy || $serverTransitionLocked}
                                        onclick={handlePurgeOrphans}
                                    >
                                        <Trash2 class="size-4" />
                                        {$t('settings.general.maintenance.purgeButton')}
                                    </Button>
                                </div>

                                <div class="flex items-center justify-between py-3.5">
                                    <div class="space-y-0.5 pr-4">
                                        <Label class="text-sm font-medium text-destructive"
                                            >{$t('settings.general.maintenance.deleteUser')}</Label
                                        >
                                        <p class="text-xs text-muted-foreground">
                                            {$t('settings.general.maintenance.deleteUserHelp')}
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
                                        {$t('settings.general.maintenance.deleteButton')}
                                    </Button>
                                </div>
                            </div>
                        </section>
                    </div>
                {/if}
            </div>
        </ScrollArea>
    {/if}
</WorkspaceShell>

{#if $appSettings}
    <WorkflowEditorModal
        bind:open={suggestionWorkflowEditorOpen}
        workflow={$appSettings.suggestion.workflow}
        title={$t('settings.general.inference.suggestionWorkflow')}
        onPatch={(patch) => updateSettings({ suggestion: { workflow: patch } })}
    />
    <WorkflowEditorModal
        bind:open={titleWorkflowEditorOpen}
        workflow={$appSettings.titleGeneration.workflow}
        title={$t('settings.general.inference.titleWorkflow')}
        onPatch={(patch) => updateSettings({ titleGeneration: { workflow: patch } })}
    />
{/if}
