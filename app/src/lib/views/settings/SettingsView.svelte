<script lang="ts">
    import {
        ArrowLeft,
        User,
        Shield,
        Cpu,
        Palette,
        RefreshCw,
        Puzzle,
        Package,
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
    import { Separator } from '$lib/components/ui/separator';
    import { appSettings, updateSettings, activeRoom, activeChat } from '$lib/stores';
    import { navigate } from '$lib/router';
    import type { SettingsTab } from '$lib/router';
    import AccountSettings from './AccountSettings.svelte';
    import ProfileSettings from './ProfileSettings.svelte';
    import ModelsSettings from './ModelsSettings.svelte';
    import ChatSettings from './ChatSettings.svelte';
    import LanguageSettings from './LanguageSettings.svelte';
    import PluginsView from './PluginsView.svelte';
    import ModulesView from './ModulesView.svelte';

    let activeTab = $state<SettingsTab>('models');
    let {
        settingsTab,
        pluginId,
        moduleId
    }: { settingsTab?: SettingsTab; pluginId?: string; moduleId?: string } = $props();

    $effect(() => {
        if (pluginId) {
            activeTab = 'plugins';
        } else if (moduleId) {
            activeTab = 'modules';
        } else if (settingsTab) {
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

    const tabs = [
        { id: 'models', label: 'Models', icon: Cpu },
        { id: 'chat', label: 'Chat', icon: MessageSquare },
        { id: 'modules', label: 'Modules', icon: Package },
        { id: 'plugins', label: 'Plugins', icon: Puzzle },
        { id: 'language', label: 'Language', icon: Languages },
        { id: 'profile', label: 'Profile', icon: User },
        { id: 'account', label: 'Account', icon: Shield },
        { id: 'appearance', label: 'Appearance', icon: Palette }
    ] as const;
</script>

<div class="flex h-full min-h-0 flex-col bg-background">
    <!-- Settings Header -->
    <header class="flex items-center justify-between px-6 py-4 border-b shrink-0">
        <div class="flex items-center gap-4">
            <Button variant="ghost" size="icon" onclick={backToChat}>
                <ArrowLeft class="size-5" />
            </Button>
            <div>
                <h1 class="text-lg font-semibold">System Settings</h1>
                <p class="text-xs text-muted-foreground">
                    Global configuration for your AI instance
                </p>
            </div>
        </div>
        <Button variant="outline" size="sm" onclick={backToChat}>Done</Button>
    </header>

    <div class="flex min-h-0 flex-1 overflow-hidden">
        <!-- Sidebar Navigation -->
        <nav class="w-64 border-r bg-muted/30 p-4 flex flex-col gap-1 shrink-0">
            {#each tabs as tab (tab.id)}
                <button
                    class="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors {activeTab ===
                    tab.id
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
                    onclick={() => openTab(tab.id)}
                >
                    <tab.icon class="size-4" />
                    {tab.label}
                </button>
            {/each}
        </nav>

        <!-- Main Workspace -->
        <main class="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
            <ScrollArea class="min-h-0 flex-1">
                <div class="max-w-4xl mx-auto p-8 space-y-8">
                    {#if activeTab === 'models'}
                        <div class="space-y-6">
                            <div class="flex flex-col gap-1">
                                <h2 class="text-2xl font-bold tracking-tight">Models</h2>
                                <p class="text-muted-foreground">
                                    Manage model selection, parameters, and custom model entries.
                                </p>
                            </div>
                            <Separator />
                            <div class="h-[calc(100vh-12rem)] min-h-[32rem]">
                                <ModelsSettings />
                            </div>
                        </div>
                    {:else if activeTab === 'chat'}
                        <div class="space-y-6">
                            <div class="flex flex-col gap-1">
                                <h2 class="text-2xl font-bold tracking-tight">Chat</h2>
                                <p class="text-muted-foreground">
                                    Manage chat workflow, scripts, toggles, and presets.
                                </p>
                            </div>
                            <Separator />
                            <div class="h-[calc(100vh-12rem)] min-h-[32rem]">
                                <ChatSettings />
                            </div>
                        </div>
                    {:else if activeTab === 'plugins'}
                        <PluginsView {pluginId} />
                    {:else if activeTab === 'modules'}
                        <ModulesView {moduleId} />
                    {:else if activeTab === 'language'}
                        <div class="space-y-6">
                            <div class="flex flex-col gap-1">
                                <h2 class="text-2xl font-bold tracking-tight">Language</h2>
                                <p class="text-muted-foreground">
                                    Manage translation language and workflow behavior.
                                </p>
                            </div>
                            <Separator />
                            <LanguageSettings />
                        </div>
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
