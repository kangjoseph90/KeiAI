<script lang="ts">
    import {
        ArrowLeft,
        User,
        FileText,
        MessageSquare,
        Book,
        Code,
        Image as ImageIcon,
        Settings2,
        Download
    } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { ScrollArea } from '$lib/components/ui/scroll-area';
    import { Badge } from '$lib/components/ui/badge';
    import {
        activeCharacter,
        activeChat,
        activeRoom,
        updateCharacterContent,
        updateCharacterAvatar,
        removeCharacterAvatar,
        createCharacterGreeting,
        deleteCharacterGreeting,
        updateCharacterGreeting,
        characterLorebooks,
        createCharacterLorebook,
        updateCharacterLorebook,
        deleteCharacterLorebook,
        characterScripts,
        createCharacterScript,
        updateCharacterScript,
        deleteCharacterScript,
        characterCharJS,
        createCharacterCharJS,
        updateCharacterCharJS,
        deleteCharacterCharJS
    } from '$lib/stores';
    import { navigate } from '$lib/router';
    import {
        exportCharacterFile,
        syncChatGreetings,
        type ExportCharacterFileRequest
    } from '$lib/managers';
    import type { DeepPartial } from '$lib/utils/defaults';
    import type { CharacterContent, Lorebook, Script, CharJS } from '$lib/services';

    // Tab Components
    import ProfileTab from '../character/studio/ProfileTab.svelte';
    import GreetingsTab from '../character/studio/GreetingsTab.svelte';
    import PromptTab from '../character/studio/PromptTab.svelte';
    import LorebooksTab from '../character/studio/LorebooksTab.svelte';
    import ScriptsTab from '../character/studio/ScriptsTab.svelte';
    import AssetsTab from '../character/studio/AssetsTab.svelte';
    import AdvancedTab from '../character/studio/AdvancedTab.svelte';

    interface Props {
        charId: string;
    }

    let { charId }: Props = $props();

    type Tab = 'profile' | 'greetings' | 'prompt' | 'lorebooks' | 'scripts' | 'assets' | 'advanced';
    type ExportButton = 'ccv3-png' | 'ccv3-charx' | 'keichar-light' | 'keichar-baked';
    let activeTab = $state<Tab>('profile');
    let exporting = $state<ExportButton | null>(null);

    const isChatSynced = $derived(() => {
        if (!$activeChat) return false;
        return $activeChat.lastMessageId === $activeChat.greetingMessageId;
    });

    async function updateCharacter(changes: DeepPartial<CharacterContent>) {
        if (!$activeCharacter) return;
        await updateCharacterContent($activeCharacter.id, changes);
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

    // Tabs navigation helper
    const tabs = [
        { id: 'profile', label: 'Profile', icon: User },
        { id: 'greetings', label: 'Greetings', icon: MessageSquare },
        { id: 'prompt', label: 'Prompt', icon: FileText },
        { id: 'lorebooks', label: 'Lorebooks', icon: Book },
        { id: 'scripts', label: 'Scripts', icon: Code },
        { id: 'assets', label: 'Assets', icon: ImageIcon },
        { id: 'advanced', label: 'Advanced', icon: Settings2 }
    ] as const;

    async function handleCreateGreeting(content: string) {
        if (!$activeCharacter) return;
        await createCharacterGreeting($activeCharacter.id, content);
        if (isChatSynced() && $activeChat) {
            await syncChatGreetings($activeChat.id);
        }
    }

    async function handleDeleteGreeting(id: string) {
        if (!$activeCharacter) return;
        await deleteCharacterGreeting($activeCharacter.id, id);
        if (isChatSynced() && $activeChat) {
            await syncChatGreetings($activeChat.id);
        }
    }

    async function handleUpdateGreeting(id: string, content: string) {
        if (!$activeCharacter) return;
        await updateCharacterGreeting($activeCharacter.id, id, content);
        if (isChatSynced() && $activeChat) {
            await syncChatGreetings($activeChat.id);
        }
    }

    async function handleExport(id: ExportButton, request: ExportCharacterFileRequest) {
        if (!$activeCharacter || exporting) return;
        exporting = id;
        try {
            await exportCharacterFile($activeCharacter.id, request);
        } finally {
            exporting = null;
        }
    }
</script>

<div class="flex flex-col h-full bg-background">
    <!-- Studio Header -->
    <header class="flex items-center justify-between px-6 py-4 border-b shrink-0">
        <div class="flex items-center gap-4">
            <Button variant="ghost" size="icon" onclick={backToChat} title="Back to Chat">
                <ArrowLeft class="size-5" />
            </Button>
            <div>
                <h1 class="text-lg font-semibold flex items-center gap-2">
                    Character Studio
                    {#if $activeCharacter}
                        <span class="text-muted-foreground font-normal">/</span>
                        <span class="text-primary">{$activeCharacter.name}</span>
                    {/if}
                </h1>
                <p class="text-xs text-muted-foreground">Crafting the perfect AI companion</p>
            </div>
        </div>

        <div class="flex items-center gap-2">
            <Badge variant="outline" class="font-mono text-[10px]">ID: {charId}</Badge>
            <Button
                variant="outline"
                size="sm"
                class="gap-1.5"
                disabled={!$activeCharacter || exporting !== null}
                onclick={() => handleExport('ccv3-png', { kind: 'ccv3', format: 'png' })}
                title="Export Character Card V3 PNG"
            >
                <Download class="size-3.5" />
                CCv3 PNG
            </Button>
            <Button
                variant="outline"
                size="sm"
                class="gap-1.5"
                disabled={!$activeCharacter || exporting !== null}
                onclick={() => handleExport('ccv3-charx', { kind: 'ccv3', format: 'charx' })}
                title="Export Character Card V3 CharX"
            >
                <Download class="size-3.5" />
                CharX
            </Button>
            <Button
                variant="outline"
                size="sm"
                class="gap-1.5"
                disabled={!$activeCharacter || exporting !== null}
                onclick={() =>
                    handleExport('keichar-light', { kind: 'keichar', assetMode: 'light' })}
                title="Export KeiChar light archive"
            >
                <Download class="size-3.5" />
                Kei Light
            </Button>
            <Button
                variant="outline"
                size="sm"
                class="gap-1.5"
                disabled={!$activeCharacter || exporting !== null}
                onclick={() =>
                    handleExport('keichar-baked', { kind: 'keichar', assetMode: 'baked' })}
                title="Export KeiChar baked archive"
            >
                <Download class="size-3.5" />
                Kei Baked
            </Button>
            <Button variant="outline" size="sm" class="gap-1.5" onclick={backToChat}>
                Close Studio
            </Button>
        </div>
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
        <main class="flex-1 flex flex-col overflow-hidden">
            {#if !$activeCharacter}
                <div class="flex flex-1 items-center justify-center">
                    <p class="text-muted-foreground">Loading character data...</p>
                </div>
            {:else}
                <ScrollArea class="flex-1">
                    <div class="max-w-4xl mx-auto p-8">
                        {#if activeTab === 'profile'}
                            <ProfileTab
                                character={$activeCharacter}
                                onUpdate={async (changes) => {
                                    await updateCharacter(changes);
                                }}
                                onUpdateAvatar={async (file) => {
                                    await updateCharacterAvatar($activeCharacter!.id, file);
                                }}
                                onRemoveAvatar={async () => {
                                    await removeCharacterAvatar($activeCharacter!.id);
                                }}
                            />
                        {:else if activeTab === 'greetings'}
                            <GreetingsTab
                                character={$activeCharacter}
                                isChatSynced={isChatSynced()}
                                onCreate={handleCreateGreeting}
                                onUpdate={handleUpdateGreeting}
                                onDelete={handleDeleteGreeting}
                            />
                        {:else if activeTab === 'prompt'}
                            <PromptTab
                                character={$activeCharacter}
                                onUpdate={async (changes) => {
                                    await updateCharacter(changes);
                                }}
                            />
                        {:else if activeTab === 'lorebooks'}
                            <LorebooksTab
                                lorebooks={$characterLorebooks}
                                onCreate={async (data) => {
                                    await createCharacterLorebook(
                                        $activeCharacter!.id,
                                        data as Lorebook
                                    );
                                }}
                                onUpdate={async (id, changes) => {
                                    await updateCharacterLorebook(
                                        $activeCharacter!.id,
                                        id,
                                        changes
                                    );
                                }}
                                onDelete={async (id) => {
                                    await deleteCharacterLorebook($activeCharacter!.id, id);
                                }}
                            />
                        {:else if activeTab === 'scripts'}
                            <ScriptsTab
                                scripts={$characterScripts}
                                charJS={$characterCharJS}
                                onCreateScript={async (data) => {
                                    await createCharacterScript(
                                        $activeCharacter!.id,
                                        data as Script
                                    );
                                }}
                                onUpdateScript={async (id, changes) => {
                                    await updateCharacterScript($activeCharacter!.id, id, changes);
                                }}
                                onDeleteScript={async (id) => {
                                    await deleteCharacterScript($activeCharacter!.id, id);
                                }}
                                onCreateCharJS={async (data) => {
                                    await createCharacterCharJS(
                                        $activeCharacter!.id,
                                        data as CharJS
                                    );
                                }}
                                onUpdateCharJS={async (id, changes) => {
                                    await updateCharacterCharJS($activeCharacter!.id, id, changes);
                                }}
                                onDeleteCharJS={async (id) => {
                                    await deleteCharacterCharJS($activeCharacter!.id, id);
                                }}
                            />
                        {:else if activeTab === 'assets'}
                            <AssetsTab character={$activeCharacter} />
                        {:else if activeTab === 'advanced'}
                            <AdvancedTab
                                character={$activeCharacter}
                                onUpdate={async (changes) => {
                                    await updateCharacter(changes);
                                }}
                            />
                        {/if}
                    </div>
                </ScrollArea>
            {/if}
        </main>
    </div>
</div>
