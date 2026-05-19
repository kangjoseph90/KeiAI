<script lang="ts">
    /**
     * ChatView — Full-height chat interface with enhanced UX.
     * Auto-resize input, auto-scroll, regenerate, empty state.
     */
    import {
        SendHorizontal,
        Square,
        ChevronRight,
        ChevronLeft,
        MessageSquare,
        ArrowDown
    } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import AutoResizeTextarea from '$lib/components/AutoResizeTextarea.svelte';
    import Message from '$lib/components/Message.svelte';
    import ChatRuntimePanel from './ChatRuntimePanel.svelte';
    import {
        activeChat,
        activeRoom,
        chatSelections,
        roomCharacters,
        chatPersonas,
        displayMessages,
        isChatRunning,
        createMessage,
        updateMessage,
        deleteMessage,
        selectChat,
        loadOlderMessages,
        loadNewerMessages,
        dropOlderMessages,
        dropNewerMessages
    } from '$lib/stores';
    import { runChat, stopChat, dismissChat, resolveToolCall } from '$lib/tasks';
    import { ToolCallService } from '$lib/services/content/tool';
    import { runPipeline } from '$lib/pipeline';
    import { runTemplate } from '$lib/template';
    import type { TemplateContext } from '$lib/template';
    import { navigate } from '$lib/router';
    import { createLogger } from '$lib/adapters/logger';
    import { tick } from 'svelte';
    import { forkChat, getChatVariables, prepareNextSwipe, syncChatGreetings } from '$lib/managers';

    let { roomId, chatId }: { roomId: string; chatId?: string } = $props();

    const logger = createLogger('view:chat');
    let newMessageText = $state('');
    let editModeId = $state<string | null>(null);
    let editMessageText = $state('');
    let inspectorOpen = $state(true);
    let scrollContainerEl: HTMLElement | undefined = $state();
    let isLoadingOlder = $state(false);
    let isLoadingNewer = $state(false);
    let showScrollToBottom = $state(false);
    let hasMoreOlder = $state(true);
    let hasMoreNewer = $state(false);

    const MESSAGE_PAGE_SIZE = 30;
    const MESSAGE_WINDOW_SIZE = 120;

    // Reset exhaustion flag when active chat changes
    $effect(() => {
        const _ = $activeChat?.id;
        hasMoreOlder = true;
        hasMoreNewer = false;
    });

    async function handleScroll() {
        if (!scrollContainerEl || !$activeChat) return;

        const { scrollTop, scrollHeight, clientHeight } = scrollContainerEl;

        // Show scroll-to-bottom button if we are more than 300px away from bottom
        showScrollToBottom = scrollHeight - scrollTop - clientHeight > 300;

        // Load older messages if we scroll to the top (within 30px) and have more
        if (scrollTop < 30 && !isLoadingOlder && hasMoreOlder) {
            isLoadingOlder = true;
            const prevHeight = scrollHeight;

            try {
                const loaded = await loadOlderMessages($activeChat.id, MESSAGE_PAGE_SIZE);
                await tick();

                if (loaded === 0) {
                    hasMoreOlder = false;
                }

                if (scrollContainerEl) {
                    scrollContainerEl.scrollTop = scrollContainerEl.scrollHeight - prevHeight;
                }

                const overflow = $displayMessages.length - MESSAGE_WINDOW_SIZE;
                if (overflow > 0) {
                    await dropNewerMessages($activeChat.id, overflow);
                    hasMoreNewer = true;
                }
            } catch (err) {
                logger.error('Failed to load older messages:', err);
            } finally {
                isLoadingOlder = false;
            }
        } else if (
            scrollHeight - scrollTop - clientHeight < 30 &&
            !isLoadingNewer &&
            hasMoreNewer
        ) {
            isLoadingNewer = true;

            try {
                const loaded = await loadNewerMessages($activeChat.id, MESSAGE_PAGE_SIZE);
                await tick();

                if (loaded === 0) {
                    hasMoreNewer = false;
                }

                const overflow = $displayMessages.length - MESSAGE_WINDOW_SIZE;
                if (overflow > 0) {
                    await dropOlderMessages($activeChat.id, overflow);
                    hasMoreOlder = true;
                }

                await tick();
                scrollToBottom();
            } catch (err) {
                logger.error('Failed to load newer messages:', err);
            } finally {
                isLoadingNewer = false;
            }
        }
    }

    function scrollToBottom() {
        if (scrollContainerEl) {
            scrollContainerEl.scrollTo({
                top: scrollContainerEl.scrollHeight,
                behavior: 'smooth'
            });
        }
    }

    const selectedPersona = $derived.by(() => {
        const personaId = $chatSelections?.personaId ?? $activeChat?.defaultPersonaId;
        if (!personaId) return null;
        return $chatPersonas.find((persona) => persona.id === personaId) ?? null;
    });

    const defaultPersona = $derived.by(() => {
        const personaId = $activeChat?.defaultPersonaId;
        if (!personaId) return null;
        return $chatPersonas.find((persona) => persona.id === personaId) ?? null;
    });

    const selectedCharacter = $derived.by(() => {
        const characterId = $chatSelections?.characterId ?? $activeChat?.defaultCharacterId;
        if (!characterId) return null;
        return $roomCharacters.find((character) => character.id === characterId) ?? null;
    });

    const defaultCharacter = $derived.by(() => {
        const characterId = $activeChat?.defaultCharacterId;
        if (!characterId) return null;
        return $roomCharacters.find((character) => character.id === characterId) ?? null;
    });

    async function handleSendMessage() {
        if (!newMessageText.trim() || !$activeChat || $isChatRunning) return;
        if (!selectedPersona) return;
        const templateCtx: TemplateContext = {
            characterId: defaultCharacter?.id,
            personaId: selectedPersona.id,
            chatId: $activeChat.id,
            speakerId: selectedPersona.id,
            speakerName: selectedPersona.name,
            role: 'user'
        };
        const templated = await runTemplate(newMessageText, templateCtx);
        const piped = await runPipeline($activeChat.id, 'input', templated, templateCtx);
        const processedText = await runTemplate(piped, templateCtx);
        newMessageText = '';

        const variables = await getChatVariables($activeChat.id);
        const message = await createMessage($activeChat.id, {
            role: 'user'
        });

        await prepareNextSwipe(message, {
            content: processedText,
            variables,
            speakerId: selectedPersona.id,
            speakerName: selectedPersona.name,
            replaceActiveSwipe: true
        });
    }

    function handleGenerateResponse() {
        if (!$activeChat || !selectedCharacter || !selectedPersona || $isChatRunning) return;
        runChat($activeChat.id, selectedCharacter.id, selectedPersona.id);
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
        if ($activeChat && selectedCharacter && selectedPersona) {
            runChat($activeChat.id, selectedCharacter.id, selectedPersona.id, { reroll: true });
        }
    }

    async function handleSwipe(messageId: string, newSwipeId: string) {
        await updateMessage(messageId, { activeSwipeId: newSwipeId });
    }

    /** Fork the chat at a given message — copies all history up to that point into a new chat. */
    async function handleFork(messageId: string) {
        const newChatId = await forkChat(messageId);
        handleSwitchChat(newChatId);
    }

    async function handleSwitchChat(targetChatId: string) {
        if ($activeRoom) {
            await syncChatGreetings(targetChatId);
            await selectChat(targetChatId);
            navigate({ view: 'room', roomId: $activeRoom.id, chatId: targetChatId });
        }
    }

    let lastMessageCount = 0;

    // Auto-scroll to bottom when new messages arrive
    $effect(() => {
        const msgs = $displayMessages;
        if (msgs.length > lastMessageCount && !isLoadingOlder) {
            tick().then(() => {
                if (scrollContainerEl) {
                    scrollContainerEl.scrollTop = scrollContainerEl.scrollHeight;
                }
            });
        }
        lastMessageCount = msgs.length;
    });
</script>

<div class="flex h-full flex-col">
    <!-- Inline Header -->
    <div class="flex shrink-0 items-center justify-between border-b px-4 py-2">
        <div class="flex items-center gap-3">
            {#if $activeRoom}
                <span class="text-sm font-semibold">{$activeRoom.name}</span>
            {:else}
                <span class="text-sm font-semibold">{roomId}</span>
            {/if}
            {#if $activeChat}
                <span class="text-sm text-muted-foreground">{$activeChat.title}</span>
            {:else if chatId}
                <span class="text-sm text-muted-foreground">{chatId}</span>
            {:else}
                <span class="text-sm text-muted-foreground">No chat selected</span>
            {/if}
        </div>
        <div class="flex items-center gap-1">
            {#if $activeChat}
                <Button
                    variant="ghost"
                    size="sm"
                    class="h-7 gap-1 text-xs"
                    onclick={() => (inspectorOpen = !inspectorOpen)}
                >
                    {#if inspectorOpen}
                        <ChevronRight class="size-3" />
                    {:else}
                        <ChevronLeft class="size-3" />
                    {/if}
                    Settings
                </Button>
            {/if}
        </div>
    </div>

    <!-- Main Area -->
    <div class="flex flex-1 overflow-hidden">
        {#if !$activeChat}
            <div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                <div class="flex size-16 items-center justify-center rounded-full bg-muted">
                    <MessageSquare class="size-7 text-muted-foreground" />
                </div>
                <div>
                    <p class="text-sm font-medium">Select or create a chat</p>
                    <p class="mt-1 text-xs text-muted-foreground">
                        This room is open, but no chat is selected.
                    </p>
                </div>
            </div>
        {:else}
            <!-- Messages Column -->
            <div class="flex flex-1 flex-col overflow-hidden relative">
                <!-- Messages -->
                <div
                    bind:this={scrollContainerEl}
                    onscroll={handleScroll}
                    class="flex-1 overflow-y-auto px-4 py-4"
                >
                    {#if $displayMessages.length === 0}
                        <!-- Empty State -->
                        <div
                            class="flex h-full flex-col items-center justify-center gap-3 text-center"
                        >
                            <div
                                class="flex size-16 items-center justify-center rounded-full bg-muted"
                            >
                                <MessageSquare class="size-7 text-muted-foreground" />
                            </div>
                            <div>
                                <p class="text-sm font-medium">Start a conversation</p>
                                <p class="mt-1 text-xs text-muted-foreground">
                                    Type a message below to begin chatting.
                                </p>
                            </div>
                        </div>
                    {:else}
                        <div class="flex flex-col gap-4">
                            {#if isLoadingOlder}
                                <div class="flex justify-center py-2 shrink-0">
                                    <span class="text-xs text-muted-foreground animate-pulse"
                                        >Loading older messages...</span
                                    >
                                </div>
                            {/if}
                            {#each $displayMessages as msg (msg.id)}
                                <Message
                                    message={msg}
                                    isEditing={editModeId === msg.id}
                                    bind:editText={editMessageText}
                                    characterName={defaultCharacter?.name ?? ''}
                                    characterId={defaultCharacter?.id}
                                    personaId={defaultPersona?.id}
                                    onEdit={() => {
                                        editModeId = msg.id;
                                        // Initialize edit text from the active swipe
                                        const activeSwipe = msg.swipes[msg.activeSwipeId];
                                        editMessageText = activeSwipe?.content ?? '';
                                    }}
                                    onSave={() => handleUpdateMessage(msg.id)}
                                    onDelete={() => deleteMessage($activeChat!.id, msg.id)}
                                    onCancelEdit={() => (editModeId = null)}
                                    onDismissError={() => dismissChat($activeChat!.id)}
                                    onResolveTool={(toolCallId, decision) =>
                                        resolveToolCall(
                                            $activeChat!.id,
                                            selectedCharacter!.id,
                                            selectedPersona!.id,
                                            msg.id,
                                            toolCallId,
                                            decision
                                        )}
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

                <!-- Scroll to Bottom Button -->
                {#if showScrollToBottom}
                    <div class="absolute bottom-20 right-6 z-10">
                        <Button
                            variant="secondary"
                            size="icon"
                            class="rounded-full shadow-md bg-background/80 backdrop-blur border size-10 hover:bg-accent flex items-center justify-center transition-opacity"
                            onclick={scrollToBottom}
                            aria-label="Scroll to bottom"
                        >
                            <ArrowDown class="size-5" />
                        </Button>
                    </div>
                {/if}

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
                        disabled={$isChatRunning || !selectedPersona}
                    />
                    {#if $isChatRunning}
                        <Button
                            variant="destructive"
                            class="gap-1.5 shrink-0"
                            onclick={() => stopChat($activeChat!.id)}
                        >
                            <Square class="size-4" /> Stop
                        </Button>
                    {:else}
                        <Button
                            class="gap-1.5 shrink-0"
                            onclick={handleSendMessage}
                            disabled={!selectedPersona || !newMessageText.trim()}
                        >
                            <SendHorizontal class="size-4" /> Send User
                        </Button>
                        <Button
                            variant="secondary"
                            class="gap-1.5 shrink-0"
                            onclick={handleGenerateResponse}
                            disabled={!selectedCharacter}
                        >
                            <MessageSquare class="size-4" /> Generate
                        </Button>
                    {/if}
                </div>
            </div>

            {#if inspectorOpen}
                <div class="w-[420px] shrink-0">
                    <ChatRuntimePanel chatId={$activeChat.id} />
                </div>
            {/if}
        {/if}
    </div>
</div>
