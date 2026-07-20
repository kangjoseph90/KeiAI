<script lang="ts">
    import {
        User,
        Shield,
        Cpu,
        Settings,
        RefreshCw,
        Puzzle,
        MessageSquare,
        Languages,
        Network,
        DatabaseZap,
        Trash2
    } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { WorkspaceShell } from '$lib/components/layout';
    import { Label } from '$lib/components/ui/label';
    import { ScrollArea } from '$lib/components/ui/scroll-area';
    import {
        Card,
        CardContent,
        CardHeader,
        CardTitle,
        CardDescription
    } from '$lib/components/ui/card';
    import {
        appSettings,
        updateSettings,
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
    import ChatSettings from './ChatSettings.svelte';
    import LanguageSettings from './LanguageSettings.svelte';
    import PluginsView from './PluginsView.svelte';
    import { appConfirm, toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';

    let activeTab = $state<SettingsTab>('models');
    let { settingsTab }: { settingsTab?: SettingsTab } = $props();
    let settingsBusy = $state(false);
    let maintenanceBusy = $state(false);

    const tabs = [
        { id: 'models', label: 'Models', icon: Cpu },
        { id: 'chat', label: 'Chat', icon: MessageSquare },
        { id: 'plugins', label: 'Plugins', icon: Puzzle },
        { id: 'language', label: 'Language', icon: Languages },
        { id: 'profile', label: 'Profile', icon: User },
        { id: 'account', label: 'Account', icon: Shield },
        { id: 'connections', label: 'Connections', icon: Network },
        { id: 'general', label: 'General', icon: Settings }
    ] as const;

    $effect(() => {
        if (settingsTab) {
            activeTab = settingsTab;
        }
    });

    async function handleToggleTheme() {
        const currentTheme = $appSettings?.theme === 'dark' ? 'light' : 'dark';
        await updateSettingsSafely({ theme: currentTheme });
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
        activeTab = tab;
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

<WorkspaceShell
    workspaceName="Settings"
    sections={tabs}
    activeSection={activeTab}
    showDetail={settingsTab !== undefined}
    onSelect={openTab}
    onBack={returnToTabs}
    onClose={backToChat}
    closeLabel="Close settings"
>
    {#if activeTab === 'models'}
        <div class="min-h-0 w-full max-w-4xl flex-1 px-4 pb-4 md:px-8 md:pb-8 md:pt-4">
            <ModelsSettings />
        </div>
    {:else if activeTab === 'chat'}
        <div class="min-h-0 w-full max-w-4xl flex-1 px-4 pb-4 md:px-8 md:pb-8 md:pt-4">
            <ChatSettings />
        </div>
    {:else}
        <ScrollArea class="min-h-0 flex-1">
            <div class="max-w-4xl space-y-8 p-4 md:px-8 md:pb-8 md:pt-4">
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
                    <div class="space-y-6">
                        <Card>
                            <CardHeader>
                                <CardTitle>Appearance</CardTitle>
                                <CardDescription
                                    >Customize how KeiAI looks on your screen.</CardDescription
                                >
                            </CardHeader>
                            <CardContent class="space-y-4">
                                <div
                                    class="flex items-center justify-between p-4 border rounded-lg"
                                >
                                    <div class="space-y-0.5">
                                        <Label>Color Theme</Label>
                                        <p class="text-xs text-muted-foreground">
                                            Switch between light and dark mode.
                                        </p>
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        class="gap-1.5"
                                        disabled={settingsBusy}
                                        aria-busy={settingsBusy}
                                        onclick={handleToggleTheme}
                                    >
                                        <RefreshCw class="size-4" />
                                        Toggle {$appSettings?.theme === 'dark' ? 'Light' : 'Dark'} Mode
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Chat Interface</CardTitle>
                                <CardDescription
                                    >Configure chat interface behaviors.</CardDescription
                                >
                            </CardHeader>
                            <CardContent class="space-y-4">
                                <div
                                    class="flex items-center justify-between gap-4 p-4 border rounded-lg"
                                >
                                    <div class="space-y-0.5">
                                        <Label>Save messages on swipe</Label>
                                        <p class="text-xs text-muted-foreground">
                                            Save message history when swiping between alternative
                                            responses.
                                        </p>
                                    </div>
                                    <input
                                        type="checkbox"
                                        class="size-5 shrink-0 rounded border-primary"
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

                                <div
                                    class="flex items-center justify-between gap-4 p-4 border rounded-lg"
                                >
                                    <div class="space-y-0.5">
                                        <Label>Expand trace steps during generation</Label>
                                        <p class="text-xs text-muted-foreground">
                                            Automatically expand reasoning steps when AI is
                                            generating responses.
                                        </p>
                                    </div>
                                    <input
                                        type="checkbox"
                                        class="size-5 shrink-0 rounded border-primary"
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
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Local Data Maintenance</CardTitle>
                                <CardDescription>
                                    Repair local sync state or permanently remove local data.
                                </CardDescription>
                            </CardHeader>
                            <CardContent class="space-y-3" aria-busy={maintenanceBusy}>
                                <Button
                                    variant="outline"
                                    class="w-full"
                                    disabled={maintenanceBusy ||
                                        !$isLoggedIn ||
                                        $serverTransitionLocked}
                                    onclick={handleResetSyncCursors}
                                >
                                    <DatabaseZap class="mr-2 size-4" /> Reset Sync Cursors
                                </Button>
                                <Button
                                    variant="outline"
                                    class="w-full"
                                    disabled={maintenanceBusy || $serverTransitionLocked}
                                    onclick={handlePurgeOrphans}
                                >
                                    <Trash2 class="mr-2 size-4" /> Purge Orphaned Data
                                </Button>
                                <Button
                                    variant="destructive"
                                    class="w-full"
                                    disabled={maintenanceBusy || $serverTransitionLocked}
                                    onclick={handleDeleteLocalUser}
                                >
                                    <Trash2 class="mr-2 size-4" /> Delete Local User
                                </Button>
                            </CardContent>
                        </Card>
                    </div>
                {/if}
            </div>
        </ScrollArea>
    {/if}
</WorkspaceShell>
