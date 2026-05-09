<script lang="ts">
    import {
        Check,
        Edit3,
        MessageSquare,
        PanelLeft,
        PanelLeftClose,
        Plus,
        Search,
        Settings,
        Trash2,
        X
    } from 'lucide-svelte';
    import AssetView from '$lib/components/AssetView.svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import {
        activeCharacter,
        activeChat,
        characters,
        chats,
        createChat,
        deleteChat,
        selectChat,
        updateChat
    } from '$lib/stores';
    import { setGreetings } from '$lib/managers';
    import type { RouteState } from '$lib/router';

    interface Props {
        collapsed?: boolean;
        route: RouteState;
        onToggle: () => void;
        onNavigate: (route: RouteState) => void;
    }

    let { collapsed = false, route, onToggle, onNavigate }: Props = $props();

    let chatSearch = $state('');
    let editingChatId = $state<string | null>(null);
    let editingChatTitle = $state('');

    const filteredChats = $derived(() => {
        const query = chatSearch.trim().toLowerCase();
        if (!query) return $chats;
        return $chats.filter((chat) => chat.title.toLowerCase().includes(query));
    });

    async function handleCreateChat() {
        if (!$activeCharacter) return;

        const chat = await createChat($activeCharacter.id, {
            title: `New Chat ${$chats.length + 1}`
        });
        await setGreetings(chat.id, $activeCharacter.greetings);
        await selectChat(chat.id, $activeCharacter.id);
        onNavigate({ view: 'chat', charId: $activeCharacter.id, chatId: chat.id });
    }

    function handleSelectCharacter(characterId: string) {
        onNavigate({ view: 'chat', charId: characterId });
    }

    function handleSelectChat(chatId: string) {
        if (!$activeCharacter) return;
        onNavigate({ view: 'chat', charId: $activeCharacter.id, chatId });
    }

    async function handleRenameChat(chatId: string) {
        const title = editingChatTitle.trim();
        if (!title) return;

        await updateChat(chatId, { title });
        editingChatId = null;
        editingChatTitle = '';
    }

    async function handleDeleteChat(chatId: string) {
        if (!$activeCharacter) return;
        if ($chats.length <= 1) return;

        await deleteChat(chatId, $activeCharacter.id);
        if ($activeChat?.id === chatId) {
            const next = $chats.find((chat) => chat.id !== chatId);
            if (next) {
                await selectChat(next.id, $activeCharacter.id);
                onNavigate({ view: 'chat', charId: $activeCharacter.id, chatId: next.id });
            } else {
                onNavigate({ view: 'chat', charId: $activeCharacter.id });
            }
        }
    }

    function startRenameChat(chatId: string, title: string) {
        editingChatId = chatId;
        editingChatTitle = title;
    }

    function characterInitial(name: string): string {
        return (name.trim().charAt(0) || '?').toUpperCase();
    }
</script>

<aside class="flex h-full shrink-0 border-r bg-sidebar text-sidebar-foreground">
    <div class="flex w-14 flex-col border-r border-sidebar-border bg-sidebar">
        <div class="flex h-14 items-center justify-center border-b border-sidebar-border">
            <button
                class="rounded px-1.5 py-1 text-xs font-bold transition-colors hover:bg-sidebar-accent"
                title="Home"
                onclick={() => onNavigate({ view: 'home' })}
            >
                Kei
            </button>
        </div>

        <div class="flex-1 overflow-y-auto px-2 py-2">
            <div class="flex flex-col items-center gap-2">
                {#each $characters as character (character.id)}
                    {@const selected = route.charId === character.id}
                    <button
                        class="relative flex size-10 items-center justify-center overflow-hidden rounded-md border bg-background text-xs font-semibold transition-colors {selected
                            ? 'border-primary ring-2 ring-primary/20'
                            : 'border-transparent hover:border-sidebar-border'}"
                        title={character.name}
                        onclick={() => handleSelectCharacter(character.id)}
                    >
                        {#if character.avatarAssetId}
                            <AssetView
                                id={character.avatarAssetId}
                                alt={character.name}
                                class="size-full object-cover"
                            />
                        {:else}
                            {characterInitial(character.name)}
                        {/if}
                    </button>
                {/each}
            </div>
        </div>

        <div class="flex flex-col items-center gap-2 border-t border-sidebar-border p-2">
            <Button
                variant="ghost"
                size="icon"
                class="size-9"
                title="Settings"
                onclick={() => onNavigate({ view: 'settings' })}
            >
                <Settings class="size-4" />
            </Button>
            {#if $activeCharacter}
                <Button
                    variant="ghost"
                    size="icon"
                    class="size-9"
                    title={collapsed ? 'Show chat list' : 'Hide chat list'}
                    onclick={onToggle}
                >
                    {#if collapsed}
                        <PanelLeft class="size-4" />
                    {:else}
                        <PanelLeftClose class="size-4" />
                    {/if}
                </Button>
            {/if}
        </div>
    </div>

    {#if !collapsed && $activeCharacter}
        <div class="flex w-72 flex-col bg-sidebar">
            <div class="flex h-14 items-center justify-between border-b border-sidebar-border px-3">
                <div class="min-w-0">
                    <p class="truncate text-sm font-semibold">{$activeCharacter.name}</p>
                    <p class="truncate text-[11px] text-muted-foreground">
                        {$activeChat?.title ?? 'Select a chat'}
                    </p>
                </div>
                <Button variant="ghost" size="icon" class="size-8" onclick={handleCreateChat}>
                    <Plus class="size-4" />
                </Button>
            </div>

            <div class="border-b border-sidebar-border p-3">
                <div class="relative">
                    <Search
                        class="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                        bind:value={chatSearch}
                        placeholder="Search chats..."
                        class="h-8 pl-8 text-xs"
                    />
                </div>
            </div>

            <div class="flex-1 overflow-y-auto p-2">
                <div class="flex flex-col gap-1">
                    {#each filteredChats() as chat (chat.id)}
                        {@const selected = route.chatId === chat.id}
                        <div
                            class="group rounded-md px-2 py-2 text-sm transition-colors {selected
                                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                                : 'hover:bg-sidebar-accent/50'}"
                        >
                            {#if editingChatId === chat.id}
                                <form
                                    class="flex gap-1"
                                    onsubmit={(event) => {
                                        event.preventDefault();
                                        handleRenameChat(chat.id);
                                    }}
                                >
                                    <Input
                                        bind:value={editingChatTitle}
                                        class="h-7 flex-1 text-xs"
                                        autofocus
                                        onkeydown={(event) => {
                                            if (event.key === 'Escape') {
                                                editingChatId = null;
                                                editingChatTitle = '';
                                            }
                                        }}
                                    />
                                    <Button type="submit" size="icon" class="size-7">
                                        <Check class="size-3" />
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        class="size-7"
                                        onclick={() => {
                                            editingChatId = null;
                                            editingChatTitle = '';
                                        }}
                                    >
                                        <X class="size-3" />
                                    </Button>
                                </form>
                            {:else}
                                <div class="flex items-center gap-2">
                                    <button
                                        class="flex min-w-0 flex-1 items-center gap-2 text-left"
                                        onclick={() => handleSelectChat(chat.id)}
                                    >
                                        <MessageSquare class="size-3.5 shrink-0" />
                                        <span class="min-w-0 flex-1 truncate">
                                            {chat.title || 'Untitled Chat'}
                                        </span>
                                    </button>
                                    <button
                                        class="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                                        title="Rename chat"
                                        onclick={() =>
                                            startRenameChat(chat.id, chat.title || 'Untitled Chat')}
                                    >
                                        <Edit3 class="size-3" />
                                    </button>
                                    {#if $chats.length > 1}
                                        <button
                                            class="flex size-6 shrink-0 items-center justify-center rounded text-destructive opacity-0 transition-opacity hover:bg-destructive/10 group-hover:opacity-100"
                                            title="Delete chat"
                                            onclick={() => handleDeleteChat(chat.id)}
                                        >
                                            <Trash2 class="size-3" />
                                        </button>
                                    {/if}
                                </div>
                            {/if}
                        </div>
                    {:else}
                        <div class="px-3 py-8 text-center text-xs text-muted-foreground">
                            No chats found.
                        </div>
                    {/each}
                </div>
            </div>
        </div>
    {/if}
</aside>
