<script lang="ts">
    import {
        User,
        Shield,
        Cpu,
        Settings,
        RefreshCw,
        Puzzle,
        MessageSquare,
        Languages
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
    import { appSettings, updateSettings, activeRoom, activeChat } from '$lib/stores';
    import { navigate } from '$lib/router';
    import type { SettingsTab } from '$lib/router';
    import AccountSettings from './AccountSettings.svelte';
    import ProfileSettings from './ProfileSettings.svelte';
    import ModelsSettings from './ModelsSettings.svelte';
    import ChatSettings from './ChatSettings.svelte';
    import LanguageSettings from './LanguageSettings.svelte';
    import PluginsView from './PluginsView.svelte';
    import { toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';

    let activeTab = $state<SettingsTab>('models');
    let { settingsTab }: { settingsTab?: SettingsTab } = $props();
    let settingsBusy = $state(false);

    const tabs = [
        { id: 'models', label: 'Models', icon: Cpu },
        { id: 'chat', label: 'Chat', icon: MessageSquare },
        { id: 'plugins', label: 'Plugins', icon: Puzzle },
        { id: 'language', label: 'Language', icon: Languages },
        { id: 'profile', label: 'Profile', icon: User },
        { id: 'account', label: 'Account', icon: Shield },
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
                    </div>
                {/if}
            </div>
        </ScrollArea>
    {/if}
</WorkspaceShell>
