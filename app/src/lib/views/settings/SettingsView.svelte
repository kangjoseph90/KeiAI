<script lang="ts">
    import {
        ChevronLeft,
        ChevronRight,
        X,
        User,
        Shield,
        Cpu,
        Palette,
        RefreshCw,
        Puzzle,
        MessageSquare,
        Languages
    } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
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

    let activeTab = $state<SettingsTab>('models');
    let { settingsTab }: { settingsTab?: SettingsTab } = $props();

    const tabs = [
        { id: 'models', label: 'Models', icon: Cpu },
        { id: 'chat', label: 'Chat', icon: MessageSquare },
        { id: 'plugins', label: 'Plugins', icon: Puzzle },
        { id: 'language', label: 'Language', icon: Languages },
        { id: 'profile', label: 'Profile', icon: User },
        { id: 'account', label: 'Account', icon: Shield },
        { id: 'appearance', label: 'Appearance', icon: Palette }
    ] as const;

    let hasSelectedTab = $derived(settingsTab !== undefined);
    let activeTabLabel = $derived(tabs.find((tab) => tab.id === activeTab)?.label ?? 'Settings');

    $effect(() => {
        if (settingsTab) {
            activeTab = settingsTab;
        }
    });

    async function handleToggleTheme() {
        const currentTheme = $appSettings?.theme === 'dark' ? 'light' : 'dark';
        await updateSettings({ theme: currentTheme });
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

<div class="flex h-full min-h-0 flex-col bg-background">
    <div class="flex min-h-0 flex-1 overflow-hidden">
        <!-- Sidebar Navigation -->
        <nav
            class="min-h-0 w-full shrink-0 flex-col border-r bg-muted/30 md:flex md:min-w-64 md:w-[max(16rem,calc((100vw-72rem)/2+16rem))] {hasSelectedTab
                ? 'hidden'
                : 'flex'}"
            aria-label="Settings sections"
        >
            <div class="flex h-14 shrink-0 items-center border-b px-2 md:hidden">
                <h1 class="min-w-0 flex-1 truncate px-2 text-sm font-semibold">Settings</h1>
                <Button
                    variant="ghost"
                    size="icon"
                    onclick={backToChat}
                    aria-label="Close settings"
                >
                    <X class="size-5" />
                </Button>
            </div>
            <div
                class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-4 md:ml-auto md:w-64 md:flex-none md:px-4 md:pb-4 md:pt-8"
            >
                {#each tabs as tab (tab.id)}
                    <button
                        class="flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors md:min-h-0 {activeTab ===
                        tab.id
                            ? hasSelectedTab
                                ? 'bg-primary text-primary-foreground shadow-sm'
                                : 'text-muted-foreground hover:bg-muted hover:text-foreground md:bg-primary md:text-primary-foreground md:shadow-sm'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
                        onclick={() => openTab(tab.id)}
                        aria-current={activeTab === tab.id ? 'page' : undefined}
                    >
                        <tab.icon class="size-4" />
                        <span>{tab.label}</span>
                        <ChevronRight class="ml-auto size-4 md:hidden" />
                    </button>
                {/each}
            </div>
        </nav>

        <!-- Main Workspace -->
        <main
            class="relative min-h-0 flex-1 flex-col overflow-hidden bg-background md:flex {hasSelectedTab
                ? 'flex'
                : 'hidden'}"
        >
            <div
                class="flex h-14 w-full max-w-4xl shrink-0 items-center border-b px-2 md:mt-4 md:border-b-0 md:px-8"
            >
                <Button
                    variant="ghost"
                    size="icon"
                    class="md:hidden"
                    onclick={returnToTabs}
                    aria-label="Back to settings sections"
                >
                    <ChevronLeft class="size-5" />
                </Button>
                <span class="min-w-0 flex-1 truncate px-2 text-sm font-semibold md:px-0 md:text-xl"
                    >{activeTabLabel}</span
                >
                <Button
                    variant="ghost"
                    size="icon"
                    onclick={backToChat}
                    aria-label="Close settings"
                >
                    <X class="size-5" />
                </Button>
            </div>

            <ScrollArea class="min-h-0 flex-1">
                <div class="max-w-4xl space-y-8 p-4 md:px-8 md:pb-8 md:pt-4">
                    {#if activeTab === 'models'}
                        <div class="h-[calc(100dvh-8rem)] min-h-[32rem]">
                            <ModelsSettings />
                        </div>
                    {:else if activeTab === 'chat'}
                        <div class="h-[calc(100dvh-8rem)] min-h-[32rem]">
                            <ChatSettings />
                        </div>
                    {:else if activeTab === 'plugins'}
                        <PluginsView />
                    {:else if activeTab === 'language'}
                        <LanguageSettings />
                    {:else if activeTab === 'profile'}
                        <ProfileSettings />
                    {:else if activeTab === 'account'}
                        <AccountSettings />
                    {:else if activeTab === 'appearance'}
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
                                        onclick={handleToggleTheme}
                                    >
                                        <RefreshCw class="size-4" />
                                        Toggle {$appSettings?.theme === 'dark' ? 'Light' : 'Dark'} Mode
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    {/if}
                </div>
            </ScrollArea>
        </main>
    </div>
</div>
