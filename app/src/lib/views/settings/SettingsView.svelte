<script lang="ts">
    import {
        User,
        Shield,
        Settings,
        Puzzle,
        MessageSquare,
        Languages,
        Network,
        HardDrive,
        Layers,
        LayoutGrid
    } from 'lucide-svelte';
    import OptionSelect from '$lib/components/OptionSelect.svelte';
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
        activeChat
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
    import SystemSettings from './SystemSettings.svelte';
    import { toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';
    import type { ThemePreference } from '$lib/stores';
    import WorkflowSummaryCard from '$lib/views/workflow/WorkflowSummaryCard.svelte';
    import WorkflowEditorModal from '$lib/views/workflow/WorkflowEditorModal.svelte';

    let { settingsTab }: { settingsTab?: SettingsTab } = $props();
    let localTab = $state<SettingsTab>('models');
    let activeTab = $derived(settingsTab ?? localTab);
    let settingsBusy = $state(false);
    let themeBusy = $state(false);
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
        { id: 'general', label: $t('settings.tabs.general'), icon: Settings },
        { id: 'system', label: $t('settings.tabs.system'), icon: HardDrive }
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
                {:else if activeTab === 'system'}
                    <SystemSettings />
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
