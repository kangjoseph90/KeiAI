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

    const tabs = [
        { id: 'models', label: 'Models', icon: Layers },
        { id: 'chat', label: 'Chat', icon: MessageSquare },
        { id: 'services', label: 'Services', icon: LayoutGrid },
        { id: 'plugins', label: 'Plugins', icon: Puzzle },
        { id: 'language', label: 'Language', icon: Languages },
        { id: 'profile', label: 'Profile', icon: User },
        { id: 'account', label: 'Account', icon: Shield },
        { id: 'connections', label: 'Connections', icon: Network },
        { id: 'general', label: 'General', icon: Settings }
    ] as const;

    async function handleThemeChange(preference: ThemePreference): Promise<void> {
        if (themeBusy || preference === $themePreference) return;
        themeBusy = true;
        try {
            await updateThemePreference(preference);
        } catch (error) {
            toast.error({ title: 'Theme update failed', description: getErrorMessage(error) });
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
            toast.error({ title: 'Setting update failed', description: getErrorMessage(error) });
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
            toast.error({ title: 'Maintenance failed', description: getErrorMessage(error) });
        } finally {
            maintenanceBusy = false;
        }
    }

    function handleResetSyncCursors(): void {
        void runMaintenance(
            performResetSyncCursors,
            {
                title: 'Reset sync cursors?',
                description:
                    'The current user will fetch all data again from this sync server. Local data is not deleted.',
                confirmText: 'Reset'
            },
            'Sync cursors reset. A full sync has completed.'
        );
    }

    function handlePurgeOrphans(): void {
        void runMaintenance(
            performPurgeOrphans,
            {
                title: 'Purge orphaned data?',
                description:
                    'This permanently removes local records and assets that no longer belong to an existing user or accessible multi-room.',
                confirmText: 'Purge',
                variant: 'destructive'
            },
            'Orphaned local data was purged.'
        );
    }

    function handleDeleteLocalUser(): void {
        void runMaintenance(deleteActiveLocalUser, {
            title: 'Delete local user?',
            description:
                'This permanently deletes this user and all of their local data from this device. The remote account is not deleted.',
            confirmText: 'Delete user',
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
    workspaceName="Settings"
    sections={tabs}
    activeSection={activeTab}
    showDetail={settingsTab !== undefined}
    onSelect={openTab}
    onBack={returnToTabs}
    onClose={backToChat}
    closeLabel="Close settings"
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
                                    Appearance
                                </h3>
                                <p class="text-sm text-muted-foreground">
                                    Customize how KeiAI looks on your screen.
                                </p>
                            </div>
                            <div class="divide-y divide-border">
                                <div class="flex items-center justify-between py-3.5">
                                    <div class="space-y-0.5">
                                        <Label for="setting-color-theme" class="text-sm font-medium"
                                            >Color Theme</Label
                                        >
                                        <p class="text-xs text-muted-foreground">
                                            Choose a theme for this device.
                                        </p>
                                    </div>
                                    <OptionSelect
                                        id="setting-color-theme"
                                        class="w-auto min-w-28"
                                        value={$themePreference}
                                        disabled={themeBusy}
                                        ariaBusy={themeBusy}
                                        options={[
                                            { value: 'system', label: 'System' },
                                            { value: 'light', label: 'Light' },
                                            { value: 'dark', label: 'Dark' }
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
                                    Chat Interface
                                </h3>
                                <p class="text-sm text-muted-foreground">
                                    Configure chat interface behaviors.
                                </p>
                            </div>
                            <div class="divide-y divide-border">
                                <div class="flex items-center justify-between py-3.5">
                                    <div class="space-y-0.5 pr-4">
                                        <Label
                                            for="setting-auto-generate-response"
                                            class="text-sm font-medium cursor-pointer"
                                        >
                                            Generate response after sending
                                        </Label>
                                        <p class="text-xs text-muted-foreground">
                                            Automatically start generating a response after you send
                                            a message.
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
                                            Save messages on swipe
                                        </Label>
                                        <p class="text-xs text-muted-foreground">
                                            Save message history when swiping between alternative
                                            responses.
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
                                            Expand trace steps during generation
                                        </Label>
                                        <p class="text-xs text-muted-foreground">
                                            Automatically expand reasoning steps when AI is
                                            generating responses.
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
                                    Chat Inference
                                </h3>
                                <p class="text-sm text-muted-foreground">
                                    Configure global workflows used for auxiliary chat inference.
                                </p>
                            </div>
                            {#if $appSettings}
                                <div class="grid gap-4 sm:grid-cols-2">
                                    <WorkflowSummaryCard
                                        fullWidth
                                        workflow={$appSettings.suggestion.workflow}
                                        onEditWorkflow={() => (suggestionWorkflowEditorOpen = true)}
                                        workflowLabel="Suggestion workflow"
                                    />
                                    <WorkflowSummaryCard
                                        fullWidth
                                        workflow={$appSettings.titleGeneration.workflow}
                                        onEditWorkflow={() => (titleWorkflowEditorOpen = true)}
                                        workflowLabel="Title generation workflow"
                                    />
                                </div>
                            {/if}
                        </section>

                        <div class="border-t border-border"></div>

                        <!-- Local Data Maintenance Section -->
                        <section class="space-y-3">
                            <div>
                                <h3 class="text-lg font-semibold tracking-tight text-foreground">
                                    Local Data Maintenance
                                </h3>
                                <p class="text-sm text-muted-foreground">
                                    Repair local sync state or permanently remove local data.
                                </p>
                            </div>
                            <div class="divide-y divide-border" aria-busy={maintenanceBusy}>
                                <div class="flex items-center justify-between py-3.5">
                                    <div class="space-y-0.5 pr-4">
                                        <Label class="text-sm font-medium">Reset Sync Cursors</Label
                                        >
                                        <p class="text-xs text-muted-foreground">
                                            Fetch all data again from the sync server without
                                            deleting local data.
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
                                        <DatabaseZap class="size-4" /> Reset Sync Cursors
                                    </Button>
                                </div>

                                <div class="flex items-center justify-between py-3.5">
                                    <div class="space-y-0.5 pr-4">
                                        <Label class="text-sm font-medium"
                                            >Purge Orphaned Data</Label
                                        >
                                        <p class="text-xs text-muted-foreground">
                                            Permanently remove local records and assets that no
                                            longer belong to an active user.
                                        </p>
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        class="gap-1.5 shrink-0"
                                        disabled={maintenanceBusy || $serverTransitionLocked}
                                        onclick={handlePurgeOrphans}
                                    >
                                        <Trash2 class="size-4" /> Purge Orphaned Data
                                    </Button>
                                </div>

                                <div class="flex items-center justify-between py-3.5">
                                    <div class="space-y-0.5 pr-4">
                                        <Label class="text-sm font-medium text-destructive"
                                            >Delete Local User</Label
                                        >
                                        <p class="text-xs text-muted-foreground">
                                            Permanently remove this user and all local data from
                                            this device.
                                        </p>
                                    </div>
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        class="gap-1.5 shrink-0"
                                        disabled={maintenanceBusy || $serverTransitionLocked}
                                        onclick={handleDeleteLocalUser}
                                    >
                                        <Trash2 class="size-4" /> Delete Local User
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
        title="Suggestion Workflow"
        onPatch={(patch) => updateSettings({ suggestion: { workflow: patch } })}
    />
    <WorkflowEditorModal
        bind:open={titleWorkflowEditorOpen}
        workflow={$appSettings.titleGeneration.workflow}
        title="Title Workflow"
        onPatch={(patch) => updateSettings({ titleGeneration: { workflow: patch } })}
    />
{/if}
