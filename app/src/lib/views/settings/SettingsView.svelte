<script lang="ts">
    import {
        ArrowLeft,
        User,
        Shield,
        Cpu,
        Palette,
        RefreshCw,
        Puzzle,
        Package
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
    import ChatBotSettings from './ChatBotSettings.svelte';
    import PluginsView from './PluginsView.svelte';
    import ModulesView from './ModulesView.svelte';

    let activeTab = $state<SettingsTab>('chatbot');
    let {
        settingsTab,
        pluginId,
        moduleId
    }: { settingsTab?: SettingsTab; pluginId?: string; moduleId?: string } = $props();

    $effect(() => {
        if (pluginId) {
            activeTab = 'plugin';
        } else if (moduleId) {
            activeTab = 'module';
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

    const tabs = [
        { id: 'chatbot', label: 'AI Engine', icon: Cpu },
        { id: 'plugin', label: 'Plugins', icon: Puzzle },
        { id: 'module', label: 'Global Modules', icon: Package },
        { id: 'profile', label: 'My Profile', icon: User },
        { id: 'account', label: 'Cloud Sync', icon: Shield },
        { id: 'display', label: 'Appearance', icon: Palette }
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
                    onclick={() => (activeTab = tab.id)}
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
                    {#if activeTab === 'chatbot'}
                        <div class="space-y-6">
                            <div class="flex flex-col gap-1">
                                <h2 class="text-2xl font-bold tracking-tight">AI Engine</h2>
                                <p class="text-muted-foreground">
                                    Manage AI models, prompt presets, and runtime parameters.
                                </p>
                            </div>
                            <Separator />
                            <div class="h-[calc(100vh-12rem)] min-h-[32rem]">
                                <ChatBotSettings />
                            </div>
                        </div>
                    {:else if activeTab === 'plugin'}
                        <PluginsView {pluginId} />
                    {:else if activeTab === 'module'}
                        <ModulesView {moduleId} />
                    {:else if activeTab === 'profile'}
                        <ProfileSettings />
                    {:else if activeTab === 'account'}
                        <AccountSettings />
                    {:else if activeTab === 'display'}
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
