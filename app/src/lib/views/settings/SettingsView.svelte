<script lang="ts">
    import {
        ArrowLeft,
        User,
        Shield,
        Cpu,
        Palette,
        RefreshCw,
        UserCircle,
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
    import { appSettings, updateSettings, activeCharacter, activeChat } from '$lib/stores';
    import { navigate } from '$lib/router';
    import AccountSettings from './AccountSettings.svelte';
    import ProfileSettings from './ProfileSettings.svelte';
    import ChatBotSettings from './ChatBotSettings.svelte';
    import PersonasView from './PersonasView.svelte';
    import PluginsView from './PluginsView.svelte';
    import ModulesView from './ModulesView.svelte';

    type SettingTab =
        | 'profile'
        | 'account'
        | 'chatbot'
        | 'display'
        | 'persona'
        | 'plugin'
        | 'module';
    let activeTab = $state<SettingTab>('chatbot');

    async function handleToggleTheme() {
        const currentTheme = $appSettings?.theme === 'dark' ? 'light' : 'dark';
        await updateSettings({ theme: currentTheme });
    }

    function backToChat() {
        if ($activeCharacter && $activeChat) {
            navigate({ view: 'chat', charId: $activeCharacter.id, chatId: $activeChat.id });
        } else {
            navigate({ view: 'home' });
        }
    }

    const tabs = [
        { id: 'chatbot', label: 'AI Engine', icon: Cpu },
        { id: 'persona', label: 'Personas', icon: UserCircle },
        { id: 'plugin', label: 'Plugins', icon: Puzzle },
        { id: 'module', label: 'Global Modules', icon: Package },
        { id: 'profile', label: 'My Profile', icon: User },
        { id: 'account', label: 'Cloud Sync', icon: Shield },
        { id: 'display', label: 'Appearance', icon: Palette }
    ] as const;
</script>

<div class="flex flex-col h-full bg-background">
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

    <div class="flex flex-1 overflow-hidden">
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
        <main class="flex-1 flex flex-col overflow-hidden bg-background">
            <ScrollArea class="flex-1">
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
                            <div class="h-[70vh]">
                                <ChatBotSettings />
                            </div>
                        </div>
                    {:else if activeTab === 'persona'}
                        <PersonasView />
                    {:else if activeTab === 'plugin'}
                        <PluginsView />
                    {:else if activeTab === 'module'}
                        <ModulesView />
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
