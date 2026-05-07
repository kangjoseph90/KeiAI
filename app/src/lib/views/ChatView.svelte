<script lang="ts">
    /**
     * ChatView — Full-height chat interface with enhanced UX.
     * Auto-resize input, auto-scroll, regenerate, empty state.
     */
    import {
        SendHorizontal,
        Square,
        Plus,
        Trash2,
        ChevronRight,
        ChevronLeft,
        MessageSquare
    } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { ScrollArea } from '$lib/components/ui/scroll-area';
    import AutoResizeTextarea from '$lib/components/AutoResizeTextarea.svelte';
    import Message from '$lib/components/Message.svelte';
    import {
        activeCharacter,
        activeChat,
        chats,
        chatLorebooks,
        displayMessages,
        isChatRunning,
        createMessage,
        updateMessage,
        deleteMessage,
        createChatLorebook,
        deleteChatLorebook,
        selectChat,
        forkChat,
        appSettings,
        prepareNextSwipe
    } from '$lib/stores';
    import { runChat, stopChat, dismissChat, resolveToolCall } from '$lib/tasks';
    import { ToolCallService } from '$lib/services/content/tool';
    import { runPipeline } from '$lib/pipeline';
    import { runTemplate } from '$lib/template';
    import type { TemplateContext } from '$lib/template';
    import { navigate } from '$lib/router';
    import { tick } from 'svelte';
    import { getChatVariables } from '$lib/managers';

    let { chatId }: { chatId: string } = $props();

    let newMessageText = $state('');
    let editModeId = $state<string | null>(null);
    let editMessageText = $state('');
    let newLorebookName = $state('');
    let lorebooksOpen = $state(false);
    let scrollContainerEl: HTMLElement | undefined = $state();

    async function handleSendMessage() {
        if (!newMessageText.trim() || !$activeChat || $isChatRunning) return;
        const templateCtx: TemplateContext = {
            characterId: $activeCharacter?.id ?? $activeChat.characterId,
            personaId: $appSettings?.personaId,
            chatId,
            display: false,
            dryRun: false
        };
        const templated = await runTemplate(newMessageText, templateCtx);
        const piped = await runPipeline(chatId, 'input', templated, {
            role: 'user'
        });
        const processedText = await runTemplate(piped, templateCtx);
        newMessageText = '';

        const variables = await getChatVariables(chatId);
        const message = await createMessage(chatId, {
            role: 'user'
        });

        await prepareNextSwipe(message, { variables, content: processedText });
        runChat(chatId);
    }

    async function handleUpdateMessage(id: string) {
        if (!editMessageText.trim()) return;
        // Find the message to update the content in the active swipe
        const msg = $displayMessages.find((m) => m.id === id);
        if (!msg) return;

        await updateMessage(id, {
            swipes: { [msg.activeSwipeId]: { content: editMessageText } }
        });
        editModeId = null;
    }

    async function handleRegenerate() {
        // Instead of deleting and re-creating, target the existing message for reroll.
        // The task layer appends a new swipe (or replaces, based on saveMessagesOnSwipe).
        runChat(chatId, { reroll: true });
    }

    async function handleSwipe(messageId: string, newSwipeId: string) {
        await updateMessage(messageId, { activeSwipeId: newSwipeId });
    }

    /** Fork the chat at a given message — copies all history up to that point into a new chat. */
    async function handleFork(messageId: string) {
        const newChatId = await forkChat(messageId);
        handleSwitchChat(newChatId);
    }

    async function handleAddLorebook() {
        if (!newLorebookName.trim()) return;
        await createChatLorebook(chatId, {
            name: newLorebookName,
            keys: [],
            content: '',
            insertionDepth: 0,
            enabled: true
        });
        newLorebookName = '';
    }

    function handleSwitchChat(targetChatId: string) {
        if ($activeCharacter) {
            selectChat(targetChatId, $activeCharacter.id);
            navigate({ view: 'chat', charId: $activeCharacter.id, chatId: targetChatId });
        }
    }

    // Auto-scroll to bottom when new messages arrive
    $effect(() => {
        const msgs = $displayMessages;
        if (msgs.length > 0) {
            // Scroll after DOM update
            tick().then(() => {
                if (scrollContainerEl) {
                    scrollContainerEl.scrollTop = scrollContainerEl.scrollHeight;
                }
            });
        }
    });
</script>

<div class="flex h-full flex-col">
    <!-- Inline Header -->
    <div class="flex shrink-0 items-center justify-between border-b px-4 py-2">
        <div class="flex items-center gap-3">
            {#if $activeCharacter}
                <span class="text-sm font-semibold">{$activeCharacter.name}</span>
            {/if}
            {#if $activeChat}
                <span class="text-sm text-muted-foreground">{$activeChat.title}</span>
            {/if}
        </div>
        <div class="flex items-center gap-1">
            <!-- Chat Switcher -->
            {#if $chats && $chats.length > 1}
                <select
                    class="h-7 rounded-md border bg-background px-2 text-xs"
                    value={chatId}
                    onchange={(e) => handleSwitchChat(e.currentTarget.value)}
                >
                    {#each $chats as c (c.id)}
                        <option value={c.id}>{c.title || 'Untitled'}</option>
                    {/each}
                </select>
            {/if}
            <Button
                variant="ghost"
                size="sm"
                class="h-7 gap-1 text-xs"
                onclick={() => (lorebooksOpen = !lorebooksOpen)}
            >
                {#if lorebooksOpen}
                    <ChevronRight class="size-3" />
                {:else}
                    <ChevronLeft class="size-3" />
                {/if}
                Lorebooks
            </Button>
        </div>
    </div>

    <!-- Main Area -->
    <div class="flex flex-1 overflow-hidden">
        <!-- Messages Column -->
        <div class="flex flex-1 flex-col overflow-hidden">
            <!-- Messages -->
            <div bind:this={scrollContainerEl} class="flex-1 overflow-y-auto px-4 py-4">
                {#if $displayMessages.length === 0}
                    <!-- Empty State -->
                    <div class="flex h-full flex-col items-center justify-center gap-3 text-center">
                        <div class="flex size-16 items-center justify-center rounded-full bg-muted">
                            <MessageSquare class="size-7 text-muted-foreground" />
                        </div>
                        <div>
                            <p class="text-sm font-medium">
                                Start a conversation{#if $activeCharacter}
                                    with {$activeCharacter.name}{/if}
                            </p>
                            <p class="mt-1 text-xs text-muted-foreground">
                                Type a message below to begin chatting.
                            </p>
                        </div>
                    </div>
                {:else}
                    <div class="flex flex-col gap-4">
                        {#each $displayMessages as msg (msg.id)}
                            <Message
                                message={msg}
                                isEditing={editModeId === msg.id}
                                bind:editText={editMessageText}
                                characterName={$activeCharacter?.name ?? ''}
                                characterId={$activeCharacter?.id}
                                personaId={$appSettings?.personaId}
                                onEdit={() => {
                                    editModeId = msg.id;
                                    // Initialize edit text from the active swipe
                                    const activeSwipe = msg.swipes[msg.activeSwipeId];
                                    editMessageText = activeSwipe?.content ?? '';
                                }}
                                onSave={() => handleUpdateMessage(msg.id)}
                                onDelete={() => deleteMessage(chatId, msg.id)}
                                onCancelEdit={() => (editModeId = null)}
                                onDismissError={() => dismissChat(chatId)}
                                onResolveTool={(toolCallId, decision) =>
                                    resolveToolCall(chatId, msg.id, toolCallId, decision)}
                                onLoadDetail={(toolCallId) => ToolCallService.get(toolCallId)}
                                onRegenerate={() => handleRegenerate()}
                                onSwipe={(newSwipeId) => handleSwipe(msg.id, newSwipeId)}
                                onFork={() => handleFork(msg.id)}
                                isLastMessage={msg.id ===
                                    $displayMessages[$displayMessages.length - 1]?.id}
                            />
                        {/each}
                    </div>
                {/if}
            </div>

            <!-- Message Input -->
            <div class="flex gap-2 border-t px-4 py-3">
                <AutoResizeTextarea
                    bind:value={newMessageText}
                    onkeydown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendMessage();
                        }
                    }}
                    placeholder="Type a message... (Shift+Enter for new line)"
                    disabled={$isChatRunning}
                />
                {#if $isChatRunning}
                    <Button
                        variant="destructive"
                        class="gap-1.5 shrink-0"
                        onclick={() => stopChat(chatId)}
                    >
                        <Square class="size-4" /> Stop
                    </Button>
                {:else}
                    <Button class="gap-1.5 shrink-0" onclick={handleSendMessage}>
                        <SendHorizontal class="size-4" /> Send
                    </Button>
                {/if}
            </div>
        </div>

        <!-- Lorebooks Side Panel -->
        {#if lorebooksOpen}
            <div class="flex w-64 shrink-0 flex-col gap-3 border-l p-4 overflow-y-auto">
                <h3 class="text-sm font-semibold">Chat Lorebooks</h3>
                <div class="flex gap-2">
                    <Input
                        bind:value={newLorebookName}
                        placeholder="Name"
                        class="h-7 flex-1 text-xs"
                    />
                    <Button size="sm" class="h-7 gap-1" onclick={handleAddLorebook}>
                        <Plus class="size-3" />
                    </Button>
                </div>
                <div class="flex flex-col gap-1">
                    {#each $chatLorebooks as lb (lb.id)}
                        <div
                            class="flex items-center justify-between rounded-md border px-2 py-1.5 text-xs"
                        >
                            <span class="truncate">{lb.name}</span>
                            <Button
                                size="sm"
                                variant="ghost"
                                class="h-5 w-5 p-0"
                                onclick={() => deleteChatLorebook(chatId, lb.id)}
                            >
                                <Trash2 class="size-3" />
                            </Button>
                        </div>
                    {:else}
                        <p class="text-xs text-muted-foreground">None yet.</p>
                    {/each}
                </div>
            </div>
        {/if}
    </div>
</div>
