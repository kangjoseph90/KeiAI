<script lang="ts">
    /**
     * ChatView — Full-height chat interface with enhanced UX.
     * Auto-resize input, auto-scroll, regenerate, empty state.
     */
    import {
        SendHorizontal,
        Square,
        MessageSquare,
        ArrowDown,
        Loader2,
        ChevronLeft,
        ChevronRight
    } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import AutoResizeTextarea from '$lib/components/AutoResizeTextarea.svelte';
    import Message from './message/Message.svelte';
    import ChatRuntimePanel from './ChatRuntimePanel.svelte';
    import ChatBackground from './ChatBackground.svelte';
    import {
        activeChat,
        activeRoom,
        chatSelections,
        appSettings,
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
    import { characterPickerOpen, personaPickerOpen } from '$lib/ui';
    import { runChat, stopChat, dismissChat } from '$lib/tasks';
    import {
        getLastContentText,
        findLastContentIndex,
        type AgentPart
    } from '$lib/workflow/agent/llm';
    import { runPipeline } from '$lib/pipeline';
    import { runTemplate } from '$lib/template';
    import { navigate } from '$lib/router';
    import { createLogger } from '$lib/adapters/logger';
    import { tick } from 'svelte';
    import { forkChat, getChatVariables, prepareNextSwipe, syncChatGreetings } from '$lib/managers';
    import type { RuntimeContext } from '$lib/types/context';

    let { roomId, chatId }: { roomId: string; chatId?: string } = $props();

    const logger = createLogger('view:chat');
    let newMessageText = $state('');
    let editModeId = $state<string | null>(null);
    let editMessageText = $state('');
    let inspectorOpen = $state(false);
    let scrollContainerEl: HTMLElement | undefined = $state();
    let isLoadingOlder = $state(false);
    let isLoadingNewer = $state(false);
    let showScrollToBottom = $state(false);
    let hasMoreOlder = $state(true);
    let hasMoreNewer = $state(false);

    const MESSAGE_PAGE_SIZE = 30;
    const MESSAGE_WINDOW_SIZE = 120;

    // Reset state and scroll to bottom when active chat changes
    $effect(() => {
        const _ = $activeChat?.id;
        hasMoreOlder = true;
        hasMoreNewer = false;
        lastMessageCount = 0;
        tick().then(() => {
            if (scrollContainerEl) {
                scrollContainerEl.scrollTop = 0;
            }
        });
    });

    $effect(() => {
        if ($activeChat) {
            const personaIds = Object.keys($activeChat.personas.refs);
            if (personaIds.length === 0) {
                inspectorOpen = true;
            }
        }
    });

    async function handleScroll() {
        if (!scrollContainerEl || !$activeChat) return;

        const { scrollTop, scrollHeight, clientHeight } = scrollContainerEl;

        // In flex-col-reverse:
        // - scrollTop is 0 at the visual bottom (latest messages) and negative when scrolled up.
        // - Math.abs(scrollTop) is the distance scrolled up from the bottom.
        // - Distance from the top of the container (oldest messages) is scrollHeight - clientHeight - Math.abs(scrollTop).
        const absScrollTop = Math.abs(scrollTop);
        const distanceFromTop = scrollHeight - clientHeight - absScrollTop;

        // Show scroll-to-bottom button if we are more than 300px away from the bottom
        showScrollToBottom = absScrollTop > 300;

        // Load older messages if we scroll to the visual top (within 30px of the top) and have more
        if (distanceFromTop < 30 && !isLoadingOlder && hasMoreOlder) {
            isLoadingOlder = true;

            try {
                const loaded = await loadOlderMessages($activeChat.id, MESSAGE_PAGE_SIZE);
                await tick();

                if (loaded === 0) {
                    hasMoreOlder = false;
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
        } else if (absScrollTop < 30 && !isLoadingNewer && hasMoreNewer) {
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
                top: 0,
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

        if (!selectedCharacter) $characterPickerOpen = true;
        if (!selectedPersona) $personaPickerOpen = true;
        if (!selectedCharacter || !selectedPersona) return;

        const ctx: RuntimeContext = {
            roomId,
            presetId: $appSettings?.presetId,
            characterId: defaultCharacter?.id,
            personaId: selectedPersona.id,
            chatId: $activeChat.id,
            speakerId: selectedPersona.id,
            speakerName: selectedPersona.name,
            role: 'user'
        };
        const templated = await runTemplate(newMessageText, ctx);
        const piped = await runPipeline($activeChat.id, 'input', templated, ctx);
        const processedText = await runTemplate(piped, ctx);
        newMessageText = '';

        const variables = await getChatVariables($activeChat.id);
        const message = await createMessage($activeChat.id, {
            role: 'user'
        });

        await prepareNextSwipe(message, {
            parts: [{ type: 'content', text: processedText }],
            variables,
            speakerId: selectedPersona.id,
            speakerName: selectedPersona.name,
            replaceActiveSwipe: true
        });
    }

    function handleGenerateResponse() {
        if (!$activeChat || $isChatRunning) return;

        if (!selectedCharacter) $characterPickerOpen = true;
        if (!selectedPersona) $personaPickerOpen = true;
        if (!selectedCharacter || !selectedPersona) return;

        runChat($activeChat.id, selectedCharacter.id, selectedPersona.id);
    }

    async function handleUpdateMessage(id: string) {
        if (!editMessageText.trim()) return;
        const msg = $displayMessages.find((m) => m.id === id);
        if (!msg) return;

        const activeSwipe = msg.swipes[msg.activeSwipeId];
        if (!activeSwipe) return;

        const newParts = [...activeSwipe.parts];
        const lastContentIdx = findLastContentIndex(newParts);

        if (lastContentIdx >= 0) {
            newParts[lastContentIdx] = {
                ...newParts[lastContentIdx],
                type: 'content',
                text: editMessageText
            };
        } else {
            newParts.push({ type: 'content', text: editMessageText });
        }

        await updateMessage(id, {
            swipes: {
                [msg.activeSwipeId]: { ...activeSwipe, parts: newParts }
            }
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
        if (msgs.length > lastMessageCount && !isLoadingOlder && !isLoadingNewer) {
            tick().then(() => {
                if (scrollContainerEl) {
                    scrollContainerEl.scrollTop = 0;
                }
            });
        }
        lastMessageCount = msgs.length;
    });
</script>

<div class="flex h-full flex-col">
    <!-- Main Area -->
    <div class="relative flex flex-1 overflow-hidden">
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
                <ChatBackground chatId={$activeChat.id} {defaultCharacter} />

                {#if !inspectorOpen}
                    <button
                        type="button"
                        class="absolute right-0 top-1.5 z-20 flex h-11 w-8 items-center justify-center rounded-l-md border border-r-0 bg-background/70 text-muted-foreground opacity-50 shadow-sm backdrop-blur-sm transition-opacity hover:opacity-100 focus-visible:opacity-100"
                        title="Show chat context"
                        aria-label="Show chat context"
                        onclick={() => (inspectorOpen = true)}
                    >
                        <ChevronLeft class="size-4" />
                    </button>
                {/if}

                {#if isLoadingOlder}
                    <div
                        class="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-background/85 backdrop-blur-md border px-3 py-1.5 rounded-full shadow-md flex items-center gap-2 text-xs text-muted-foreground transition-all duration-200"
                    >
                        <Loader2 class="size-3.5 animate-spin text-primary" />
                        <span>Loading older messages...</span>
                    </div>
                {/if}

                <!-- Messages -->
                <div
                    bind:this={scrollContainerEl}
                    onscroll={handleScroll}
                    class="relative z-10 flex flex-1 flex-col-reverse gap-6 overflow-y-auto px-4 py-4 md:gap-4"
                    style="scrollbar-gutter: stable;"
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
                        {#each [...$displayMessages].reverse() as msg (msg.id)}
                            <Message
                                message={msg}
                                isEditing={editModeId === msg.id}
                                bind:editText={editMessageText}
                                characterName={defaultCharacter?.name ?? ''}
                                characterId={defaultCharacter?.id}
                                personaId={defaultPersona?.id}
                                onEdit={() => {
                                    editModeId = msg.id;
                                    const activeSwipe = msg.swipes[msg.activeSwipeId];
                                    editMessageText = activeSwipe
                                        ? getLastContentText(activeSwipe.parts)
                                        : '';
                                }}
                                onSave={() => handleUpdateMessage(msg.id)}
                                onDelete={() => deleteMessage($activeChat!.id, msg.id)}
                                onCancelEdit={() => (editModeId = null)}
                                onDismissError={() => dismissChat($activeChat!.id)}
                                onRegenerate={() => handleRegenerate()}
                                onSwipe={(newSwipeId) => handleSwipe(msg.id, newSwipeId)}
                                onFork={() => handleFork(msg.id)}
                                isLastMessage={msg.id ===
                                    $displayMessages[$displayMessages.length - 1]?.id}
                            />
                        {/each}
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
                <div
                    class="relative z-10 flex gap-2 border-t bg-background/80 px-4 py-3 backdrop-blur"
                >
                    <AutoResizeTextarea
                        bind:value={newMessageText}
                        classname="min-h-10 py-2.5"
                        onkeydown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSendMessage();
                            }
                        }}
                        placeholder="Type a message..."
                        disabled={$isChatRunning}
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
                            size="icon"
                            class="shrink-0"
                            onclick={handleSendMessage}
                            disabled={!newMessageText.trim() || $isChatRunning}
                            title="Send message"
                            aria-label="Send message"
                        >
                            <SendHorizontal class="size-4" />
                        </Button>
                        <Button
                            variant="secondary"
                            size="icon"
                            class="shrink-0"
                            onclick={handleGenerateResponse}
                            disabled={$isChatRunning}
                            title="Generate response"
                            aria-label="Generate response"
                        >
                            <MessageSquare class="size-4" />
                        </Button>
                    {/if}
                </div>
            </div>

            {#if inspectorOpen}
                <button
                    type="button"
                    class="absolute inset-0 z-30 bg-black/35 md:hidden"
                    aria-label="Close chat context"
                    onclick={() => (inspectorOpen = false)}
                ></button>
                <div
                    class="relative w-[360px] shrink-0 max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-40 max-md:w-[calc(100%-2rem)] max-md:max-w-[420px]"
                >
                    <button
                        type="button"
                        class="absolute right-full top-1.5 z-30 flex h-11 w-8 items-center justify-center rounded-l-md border border-r-0 bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground max-md:hidden"
                        title="Hide chat context"
                        aria-label="Hide chat context"
                        onclick={() => (inspectorOpen = false)}
                    >
                        <ChevronRight class="size-4" />
                    </button>
                    <ChatRuntimePanel chatId={$activeChat.id} />
                </div>
            {/if}
        {/if}
    </div>
</div>
