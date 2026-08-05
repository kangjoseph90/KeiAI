<script lang="ts">
    /**
     * ChatView — Full-height chat interface with enhanced UX.
     * Auto-resize input, auto-scroll, regenerate, empty state.
     */
    import { MessageSquare, Loader2, ChevronLeft, ChevronRight } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import Message from './message/Message.svelte';
    import ChatComposer from './ChatComposer.svelte';
    import ChatRuntimePanel from './ChatRuntimePanel.svelte';
    import ChatCharacterPicker from './ChatCharacterPicker.svelte';
    import ChatPersonaPicker from './ChatPersonaPicker.svelte';
    import ChatBackground from './ChatBackground.svelte';
    import {
        activeChat,
        activeRoom,
        chatSelections,
        chatTasks,
        appSettings,
        roomCharacters,
        chatPersonas,
        displayMessages,
        isChatRunning,
        createMessage,
        updateMessage,
        deleteMessage,
        selectChat,
        loadInitialMessages,
        loadOlderMessages,
        loadNewerMessages,
        dropOlderMessages,
        dropNewerMessages,
        createChatInlay
    } from '$lib/stores';
    import { appConfirm, characterPickerOpen, personaPickerOpen, toast } from '$lib/ui';
    import { runChat, stopChat, dismissChat } from '$lib/tasks';
    import { getLastTextContent, findLastTextIndex, type AgentPart } from '$lib/workflow/agent/llm';
    import { runPipeline } from '$lib/pipeline';
    import { runTemplate } from '$lib/template';
    import { navigate } from '$lib/router';
    import { createLogger } from '$lib/adapters/logger';
    import { emitEvent } from '$lib/events';
    import { onDestroy, tick } from 'svelte';
    import { forkChat, getChatVariables, prepareNextSwipe, syncChatGreetings } from '$lib/managers';
    import type { RuntimeContext } from '$lib/types/context';
    import { appDialog } from '$lib/adapters/dialog';
    import { getErrorMessage } from '$lib/types/errors';
    import { MEDIA_ASSET_EXTENSIONS } from '$lib/types/asset';

    let { roomId, chatId }: { roomId: string; chatId?: string } = $props();

    const logger = createLogger('view:chat');
    let newMessageText = $state('');
    let pendingAttachments = $state<string[]>([]);
    let editModeId = $state<string | null>(null);
    let isEditingTranslation = $state(false);
    let editMessageText = $state('');
    let inspectorOpen = $state(false);
    let scrollContainerEl: HTMLElement | undefined = $state();
    type PaginationDirection = 'older' | 'newer';
    let paginationDirection = $state<PaginationDirection | null>(null);
    let showScrollToBottom = $state(false);
    let hasMoreOlder = $state(true);
    let hasMoreNewer = $state(false);
    let previousActiveChatId = $state<string | undefined>();
    let composerHeight = $state(0);
    let messagesContentEl: HTMLElement | undefined = $state();
    let streamReserveHeight = $state(0);
    let reserveContentHeight = 0;
    let previousGeneratingMessageId: string | null = null;
    let previousBottomOffset = 0;
    let isAdjustingStreamReserve = false;
    const MAX_ATTACHMENTS = 4;
    type MessageAction = 'save' | 'delete' | 'swipe' | 'fork';
    let messageAction = $state<{ messageId: string; type: MessageAction } | null>(null);
    let chatViewEpoch = 0;

    const MESSAGE_PAGE_SIZE = 30;
    const MESSAGE_WINDOW_SIZE = 120;
    const STICKY_BOTTOM_THRESHOLD = 30;
    const MIN_STREAM_RESERVE_HEIGHT = 240;
    const MAX_STREAM_RESERVE_HEIGHT = 640;
    const STREAM_RESERVE_RATIO = 0.68;
    const isLoadingOlder = $derived(paginationDirection === 'older');
    const messageBottomInset = $derived(Math.max(composerHeight + 16, 96));
    const generatingMessageId = $derived.by(() => {
        const activeChatId = $activeChat?.id;
        if (!activeChatId) return null;
        const task = $chatTasks.get(activeChatId);
        return task?.status === 'generating' ? task.messageId : null;
    });

    onDestroy(() => {
        chatViewEpoch += 1;
    });

    $effect(() => {
        const element = messagesContentEl;
        if (!element) return;

        const observer = new ResizeObserver(handleMessagesResize);
        observer.observe(element);
        syncReserveContentHeight();
        return () => observer.disconnect();
    });

    $effect(() => {
        const messageId = generatingMessageId;
        const activeChatId = $activeChat?.id;
        if (!messageId) {
            previousGeneratingMessageId = null;
            return;
        }
        if (!activeChatId) return;
        if (messageId === previousGeneratingMessageId) return;

        previousGeneratingMessageId = messageId;
        void tick().then(() => {
            if ($activeChat?.id !== activeChatId || generatingMessageId !== messageId) return;
            void prepareGenerationViewport(activeChatId, messageId);
        });
    });

    async function prepareGenerationViewport(activeChatId: string, messageId: string) {
        chatViewEpoch += 1;
        const epoch = chatViewEpoch;
        const isViewportCurrent = () => $activeChat?.id === activeChatId && chatViewEpoch === epoch;
        const isCurrent = () => isViewportCurrent() && generatingMessageId === messageId;
        paginationDirection = null;

        await tick();
        if (!isCurrent() || !scrollContainerEl) return;

        if (!hasDisplayedMessage(messageId)) {
            paginationDirection = 'newer';
            try {
                await loadInitialMessages(activeChatId, MESSAGE_WINDOW_SIZE, isCurrent);
                if (!isCurrent()) return;
                hasMoreOlder = true;
                hasMoreNewer = false;
                await tick();
            } catch (error) {
                logger.error('Failed to load the generating message:', error);
                return;
            } finally {
                if (isViewportCurrent()) paginationDirection = null;
            }
        }

        if (!isCurrent() || !scrollContainerEl || !hasDisplayedMessage(messageId)) return;
        const reserveHeight = calculateStreamReserveHeight();
        syncReserveContentHeight();
        streamReserveHeight = Math.max(streamReserveHeight, reserveHeight);
        await tick();
        if (!isCurrent() || !scrollContainerEl) return;
        previousBottomOffset = getDistanceFromBottom(scrollContainerEl);
        scrollToBottom();
    }

    // Reset state and scroll to bottom when active chat changes
    $effect(() => {
        const activeChatId = $activeChat?.id;
        if (activeChatId === previousActiveChatId) return;

        previousActiveChatId = activeChatId;
        chatViewEpoch += 1;
        hasMoreOlder = true;
        hasMoreNewer = false;
        paginationDirection = null;
        pendingAttachments = [];
        clearStreamReserve();
        previousGeneratingMessageId = null;
        previousBottomOffset = 0;

        void tick().then(() => {
            if ($activeChat?.id !== activeChatId || !scrollContainerEl) return;
            scrollContainerEl.scrollTop = scrollContainerEl.scrollHeight;
            previousBottomOffset = 0;
        });
    });

    async function handleScroll() {
        if (!scrollContainerEl || !$activeChat || isAdjustingStreamReserve) return;

        const activeChatId = $activeChat.id;
        const epoch = chatViewEpoch;
        const isCurrent = () => $activeChat?.id === activeChatId && chatViewEpoch === epoch;

        let { scrollTop } = scrollContainerEl;
        let { scrollHeight, clientHeight } = scrollContainerEl;
        let distanceFromBottom = Math.max(0, scrollHeight - clientHeight - scrollTop);

        if (streamReserveHeight > 0 && !generatingMessageId) {
            const upwardDelta = Math.max(0, distanceFromBottom - previousBottomOffset);
            const consumed = Math.min(upwardDelta, streamReserveHeight);

            if (consumed > 0) {
                isAdjustingStreamReserve = true;
                try {
                    streamReserveHeight = Math.max(0, streamReserveHeight - consumed);
                    await tick();
                    if (!isCurrent() || !scrollContainerEl) return;
                    const nextBottomOffset = Math.max(0, distanceFromBottom - consumed);
                    const nextMaxScrollTop = Math.max(
                        0,
                        scrollContainerEl.scrollHeight - scrollContainerEl.clientHeight
                    );
                    scrollContainerEl.scrollTop = Math.max(0, nextMaxScrollTop - nextBottomOffset);
                    scrollTop = scrollContainerEl.scrollTop;
                    scrollHeight = scrollContainerEl.scrollHeight;
                    clientHeight = scrollContainerEl.clientHeight;
                    distanceFromBottom = Math.max(0, scrollHeight - clientHeight - scrollTop);
                } finally {
                    isAdjustingStreamReserve = false;
                }
            }
        }

        previousBottomOffset = distanceFromBottom;

        // Show scroll-to-bottom button if we are more than 300px away from the bottom
        showScrollToBottom = distanceFromBottom > 300;

        // Load older messages near the top and preserve the visible content after prepending.
        if (
            !generatingMessageId &&
            scrollTop < STICKY_BOTTOM_THRESHOLD &&
            paginationDirection === null &&
            hasMoreOlder
        ) {
            paginationDirection = 'older';
            const previousHeight = scrollHeight;
            const previousTop = scrollTop;

            try {
                const loaded = await loadOlderMessages(activeChatId, MESSAGE_PAGE_SIZE, isCurrent);
                await tick();
                if (!isCurrent()) return;

                if (loaded > 0 && scrollContainerEl) {
                    scrollContainerEl.scrollTop =
                        previousTop + (scrollContainerEl.scrollHeight - previousHeight);
                    previousBottomOffset = getDistanceFromBottom(scrollContainerEl);
                    syncReserveContentHeight();
                }

                if (loaded === 0) {
                    hasMoreOlder = false;
                }

                const overflow = $displayMessages.length - MESSAGE_WINDOW_SIZE;
                if (overflow > 0) {
                    await dropNewerMessages(activeChatId, overflow);
                    if (!isCurrent()) return;
                    hasMoreNewer = true;
                    await tick();
                    if (!isCurrent()) return;
                    syncReserveContentHeight();
                }
            } catch (err) {
                logger.error('Failed to load older messages:', err);
            } finally {
                if (isCurrent()) paginationDirection = null;
            }
        } else if (
            !generatingMessageId &&
            distanceFromBottom < STICKY_BOTTOM_THRESHOLD &&
            paginationDirection === null &&
            hasMoreNewer
        ) {
            paginationDirection = 'newer';

            try {
                const loaded = await loadNewerMessages(activeChatId, MESSAGE_PAGE_SIZE, isCurrent);
                await tick();
                if (!isCurrent()) return;

                if (loaded === 0) {
                    hasMoreNewer = false;
                }

                const overflow = $displayMessages.length - MESSAGE_WINDOW_SIZE;
                if (overflow > 0) {
                    const previousHeight = scrollContainerEl?.scrollHeight ?? 0;
                    const previousTop = scrollContainerEl?.scrollTop ?? 0;
                    await dropOlderMessages(activeChatId, overflow);
                    if (!isCurrent()) return;
                    hasMoreOlder = true;
                    await tick();
                    if (!isCurrent() || !scrollContainerEl) return;
                    scrollContainerEl.scrollTop =
                        previousTop + (scrollContainerEl.scrollHeight - previousHeight);
                    previousBottomOffset = getDistanceFromBottom(scrollContainerEl);
                    syncReserveContentHeight();
                }
            } catch (err) {
                logger.error('Failed to load newer messages:', err);
            } finally {
                if (isCurrent()) paginationDirection = null;
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

    function calculateStreamReserveHeight(): number {
        if (!scrollContainerEl) return 0;
        const availableHeight = Math.max(0, scrollContainerEl.clientHeight - messageBottomInset);
        if (availableHeight === 0) return 0;
        return Math.min(
            MAX_STREAM_RESERVE_HEIGHT,
            availableHeight,
            Math.max(MIN_STREAM_RESERVE_HEIGHT, Math.round(availableHeight * STREAM_RESERVE_RATIO))
        );
    }

    function getDistanceFromBottom(element: HTMLElement): number {
        return Math.max(0, element.scrollHeight - element.clientHeight - element.scrollTop);
    }

    function hasDisplayedMessage(messageId: string): boolean {
        return $displayMessages.some((message) => message.id === messageId);
    }

    function handleMessagesResize(): void {
        if (!messagesContentEl) return;
        const nextHeight = messagesContentEl.getBoundingClientRect().height;

        if (paginationDirection !== null || streamReserveHeight <= 0) {
            reserveContentHeight = nextHeight;
            return;
        }

        const growth = Math.max(0, nextHeight - reserveContentHeight);
        reserveContentHeight = Math.max(reserveContentHeight, nextHeight);
        if (growth > 0) {
            streamReserveHeight = Math.max(0, streamReserveHeight - growth);
        }
    }

    function syncReserveContentHeight(): void {
        reserveContentHeight = messagesContentEl?.getBoundingClientRect().height ?? 0;
    }

    function clearStreamReserve(): void {
        streamReserveHeight = 0;
        syncReserveContentHeight();
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
        if (
            (!newMessageText.trim() && pendingAttachments.length === 0) ||
            !$activeChat ||
            $isChatRunning
        )
            return;

        if (!selectedCharacter) {
            $characterPickerOpen = true;
            return;
        }
        if (!selectedPersona) {
            $personaPickerOpen = true;
            return;
        }

        const targetChatId = $activeChat.id;
        const targetCharacterId = selectedCharacter.id;
        const targetPersonaId = selectedPersona.id;

        const ctx: RuntimeContext = {
            roomId,
            presetId: $appSettings?.presetId,
            characterId: defaultCharacter?.id,
            personaId: targetPersonaId,
            chatId: targetChatId,
            speakerId: targetPersonaId,
            speakerName: selectedPersona.name,
            role: 'user'
        };
        const templated = await runTemplate(newMessageText, ctx);
        const piped = await runPipeline('input', ctx, templated);
        const processedText = await runTemplate(piped, ctx);
        const inlayIds = Array.from(pendingAttachments);
        const parts: AgentPart[] = [];
        if (inlayIds.length > 0) parts.push({ type: 'inlay', ids: inlayIds });
        if (processedText.trim()) parts.push({ type: 'text', text: processedText });

        const variables = await getChatVariables(targetChatId);
        const message = await createMessage(targetChatId, { role: 'user' });

        await prepareNextSwipe(message, {
            parts,
            variables,
            speakerId: targetPersonaId,
            speakerName: selectedPersona.name,
            replaceActiveSwipe: true
        });

        void emitEvent(
            'message:sent',
            { ...ctx, chatId: targetChatId, characterId: targetCharacterId },
            { content: processedText }
        );

        newMessageText = '';
        pendingAttachments = [];

        if ($appSettings?.chat.autoGenerateResponse !== false && $activeChat?.id === targetChatId) {
            void runChat(targetChatId, targetCharacterId, targetPersonaId);
        }
    }

    /**
     * Shared image→inlay→attachment pipeline for file pick, paste, and drop.
     * Captures the chatId up front so a mid-flight chat switch cannot leak
     * attachments into the wrong chat. Partial failures keep successful ones.
     */
    async function attachFiles(files: File[]): Promise<void> {
        const chatId = $activeChat?.id;
        if (!chatId) return;

        const remaining = MAX_ATTACHMENTS - pendingAttachments.length;
        const candidates = files.slice(0, remaining);
        if (candidates.length === 0) return;

        let firstError: unknown;
        for (const file of candidates) {
            try {
                const ref = await createChatInlay(chatId, file);
                // Only attach if the user hasn't switched chats while we awaited.
                if ($activeChat?.id === chatId) addAttachment(ref.id);
            } catch (err) {
                logger.error('Failed to attach media:', err);
                firstError ??= err;
            }
        }
        if (firstError) {
            toast.error({
                title: 'Could not attach some media',
                description: getErrorMessage(firstError)
            });
        }
    }

    async function handleAttachmentUpload() {
        if (!$activeChat || pendingAttachments.length >= MAX_ATTACHMENTS) return;

        const files = await appDialog.openMultipleFiles({
            title: 'Attach Media',
            filters: [{ name: 'Images, audio, and video', extensions: [...MEDIA_ASSET_EXTENSIONS] }]
        });
        if (!files?.length) return;

        await attachFiles(files);
    }

    function addAttachment(assetId: string) {
        if (pendingAttachments.length >= MAX_ATTACHMENTS || pendingAttachments.includes(assetId))
            return;
        pendingAttachments = [...pendingAttachments, assetId];
    }

    function handleGenerateResponse() {
        if (!$activeChat || $isChatRunning) return;

        if (!selectedCharacter) {
            $characterPickerOpen = true;
            return;
        }
        if (!selectedPersona) {
            $personaPickerOpen = true;
            return;
        }

        runChat($activeChat.id, selectedCharacter.id, selectedPersona.id);
    }

    async function runMessageAction(
        messageId: string,
        type: MessageAction,
        errorTitle: string,
        action: (targetChatId: string) => Promise<void>
    ): Promise<void> {
        const targetChatId = $activeChat?.id;
        if (!targetChatId || messageAction) return;
        messageAction = { messageId, type };
        try {
            await action(targetChatId);
        } catch (error) {
            toast.error({ title: errorTitle, description: getErrorMessage(error) });
        } finally {
            messageAction = null;
        }
    }

    async function handleUpdateMessage(id: string) {
        if (!editMessageText.trim()) return;
        const msg = $displayMessages.find((m) => m.id === id);
        if (!msg) return;

        const activeSwipe = msg.swipes[msg.activeSwipeId];
        if (!activeSwipe) return;

        const newParts = [...activeSwipe.parts];
        const lastTextIdx = findLastTextIndex(newParts);

        if (lastTextIdx >= 0) {
            newParts[lastTextIdx] = {
                ...newParts[lastTextIdx],
                type: 'text',
                text: editMessageText
            };
        } else {
            newParts.push({ type: 'text', text: editMessageText });
        }

        await runMessageAction(id, 'save', 'Could not save message', async (targetChatId) => {
            await updateMessage(id, {
                swipes: {
                    [msg.activeSwipeId]: { ...activeSwipe, parts: newParts }
                }
            });
            if ($activeChat?.id === targetChatId) editModeId = null;
        });
    }

    async function handleUpdateTranslation(id: string) {
        if (!editMessageText.trim()) return;
        const msg = $displayMessages.find((m) => m.id === id);
        if (!msg) return;

        const activeSwipe = msg.swipes[msg.activeSwipeId];
        if (!activeSwipe || !activeSwipe.translation) return;

        const updatedTranslation = {
            ...activeSwipe.translation,
            text: editMessageText
        };

        await runMessageAction(id, 'save', 'Could not save translation', async (targetChatId) => {
            await updateMessage(id, {
                swipes: {
                    [msg.activeSwipeId]: { ...activeSwipe, translation: updatedTranslation }
                }
            });
            if ($activeChat?.id === targetChatId) {
                editModeId = null;
                isEditingTranslation = false;
            }
        });
    }

    async function handleRegenerate() {
        // Instead of deleting and re-creating, target the existing message for reroll.
        // The task layer appends a new swipe (or replaces, based on saveMessagesOnSwipe).
        if ($activeChat && selectedCharacter && selectedPersona) {
            runChat($activeChat.id, selectedCharacter.id, selectedPersona.id, { reroll: true });
        }
    }

    async function handleSwipe(messageId: string, newSwipeId: string) {
        await runMessageAction(messageId, 'swipe', 'Could not change swipe', () =>
            updateMessage(messageId, { activeSwipeId: newSwipeId })
        );
    }

    /** Fork the chat at a given message — copies all history up to that point into a new chat. */
    async function handleFork(messageId: string) {
        await runMessageAction(messageId, 'fork', 'Could not fork chat', async (targetChatId) => {
            const newChatId = await forkChat(messageId);
            if ($activeChat?.id === targetChatId) await handleSwitchChat(newChatId);
        });
    }

    async function handleDeleteMessage(messageId: string) {
        await runMessageAction(
            messageId,
            'delete',
            'Could not delete message',
            async (targetChatId) => {
                const confirmed = await appConfirm({
                    title: 'Delete message?',
                    description:
                        'Delete this message and all of its swipes? This cannot be undone.',
                    confirmText: 'Delete',
                    variant: 'destructive'
                });
                if (!confirmed || $activeChat?.id !== targetChatId) return;
                await deleteMessage(targetChatId, messageId);
            }
        );
    }

    async function handleSwitchChat(targetChatId: string) {
        if ($activeRoom) {
            await syncChatGreetings(targetChatId);
            await selectChat(targetChatId);
            navigate({ view: 'room', roomId: $activeRoom.id, chatId: targetChatId });
        }
    }
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
                    <Button
                        variant="outline"
                        size="icon-lg"
                        class="absolute right-0 top-1.5 z-20 size-11 rounded-none rounded-l-md border-sidebar-border bg-sidebar/70 text-muted-foreground opacity-50 shadow-none backdrop-blur-sm transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:opacity-100 focus-visible:opacity-100 dark:bg-sidebar/70 dark:hover:bg-sidebar-accent"
                        title="Show chat context"
                        aria-label="Show chat context"
                        onclick={() => (inspectorOpen = true)}
                    >
                        <ChevronLeft class="size-4" />
                    </Button>
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
                    class="relative z-10 flex flex-1 flex-col overflow-y-auto px-4 py-4"
                    style="scrollbar-gutter: stable; padding-bottom: {messageBottomInset}px; overflow-anchor: {streamReserveHeight >
                    0
                        ? 'none'
                        : 'auto'};"
                >
                    <div
                        bind:this={messagesContentEl}
                        class="flex flex-none flex-col gap-6 md:gap-4 {$displayMessages.length === 0
                            ? 'min-h-full'
                            : ''}"
                    >
                        {#if $displayMessages.length === 0}
                            <!-- Empty State -->
                            <div
                                class="flex flex-1 flex-col items-center justify-center gap-3 text-center"
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
                                        isEditingTranslation = false;
                                        const activeSwipe = msg.swipes[msg.activeSwipeId];
                                        editMessageText = activeSwipe
                                            ? getLastTextContent(activeSwipe.parts)
                                            : '';
                                    }}
                                    onEditTranslation={() => {
                                        editModeId = msg.id;
                                        isEditingTranslation = true;
                                        const activeSwipe = msg.swipes[msg.activeSwipeId];
                                        editMessageText = activeSwipe?.translation?.text ?? '';
                                    }}
                                    onSave={() => {
                                        if (isEditingTranslation) {
                                            void handleUpdateTranslation(msg.id);
                                        } else {
                                            void handleUpdateMessage(msg.id);
                                        }
                                    }}
                                    onDelete={() => handleDeleteMessage(msg.id)}
                                    onCancelEdit={() => {
                                        editModeId = null;
                                        isEditingTranslation = false;
                                    }}
                                    onDismissError={() => dismissChat($activeChat!.id)}
                                    onRegenerate={() => handleRegenerate()}
                                    onSwipe={(newSwipeId) => handleSwipe(msg.id, newSwipeId)}
                                    onFork={() => handleFork(msg.id)}
                                    actionsDisabled={messageAction !== null}
                                    busyAction={messageAction?.messageId === msg.id
                                        ? messageAction.type
                                        : null}
                                    isLastMessage={msg.id ===
                                        $displayMessages[$displayMessages.length - 1]?.id}
                                />
                            {/each}
                        {/if}
                    </div>
                    <div
                        class="w-full flex-none"
                        style:height={`${streamReserveHeight}px`}
                        aria-hidden="true"
                    ></div>
                </div>

                <!-- Message Input -->
                <ChatComposer
                    bind:value={newMessageText}
                    bind:attachmentIds={pendingAttachments}
                    maxAttachments={MAX_ATTACHMENTS}
                    {showScrollToBottom}
                    onHeightChange={(height) => (composerHeight = height)}
                    onSend={() => void handleSendMessage()}
                    onGenerate={handleGenerateResponse}
                    onStop={() => stopChat($activeChat!.id)}
                    onUpload={() => void handleAttachmentUpload()}
                    onFiles={(files) => void attachFiles(files)}
                    onScrollToBottom={scrollToBottom}
                />
            </div>

            {#if inspectorOpen}
                <button
                    type="button"
                    class="absolute inset-0 z-30 bg-black/35 lg:hidden"
                    aria-label="Close chat context"
                    onclick={() => (inspectorOpen = false)}
                ></button>
                <div
                    class="app-chat-runtime-panel relative w-[360px] shrink-0 max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-40"
                >
                    <Button
                        variant="outline"
                        size="icon-lg"
                        class="absolute right-full top-1.5 z-30 size-11 rounded-none rounded-l-md border-r-0 border-sidebar-border bg-sidebar text-muted-foreground shadow-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:bg-sidebar dark:hover:bg-sidebar-accent max-lg:hidden"
                        title="Hide chat context"
                        aria-label="Hide chat context"
                        onclick={() => (inspectorOpen = false)}
                    >
                        <ChevronRight class="size-4" />
                    </Button>
                    <ChatRuntimePanel chatId={$activeChat.id} onSelectInlay={addAttachment} />
                </div>
            {/if}
        {/if}
    </div>
</div>

<ChatCharacterPicker {roomId} />
{#if $activeChat}
    <ChatPersonaPicker chatId={$activeChat.id} />
{/if}
