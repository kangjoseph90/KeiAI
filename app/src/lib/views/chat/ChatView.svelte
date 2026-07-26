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
        ChevronRight,
        Paperclip,
        X
    } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import AutoResizeTextarea from '$lib/components/AutoResizeTextarea.svelte';
    import Message from './message/Message.svelte';
    import ChatRuntimePanel from './ChatRuntimePanel.svelte';
    import ChatCharacterPicker from './ChatCharacterPicker.svelte';
    import ChatPersonaPicker from './ChatPersonaPicker.svelte';
    import ChatBackground from './ChatBackground.svelte';
    import AssetView from '$lib/components/AssetView.svelte';
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
    import { tick } from 'svelte';
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
    let isLoadingOlder = $state(false);
    let isLoadingNewer = $state(false);
    let showScrollToBottom = $state(false);
    let hasMoreOlder = $state(true);
    let hasMoreNewer = $state(false);
    let previousActiveChatId = $state<string | undefined>();
    let dragCounter = $state(0);
    const MAX_ATTACHMENTS = 4;
    type MessageAction = 'save' | 'delete' | 'swipe' | 'fork';
    let messageAction = $state<{ messageId: string; type: MessageAction } | null>(null);
    let chatViewEpoch = 0;

    const MESSAGE_PAGE_SIZE = 30;
    const MESSAGE_WINDOW_SIZE = 120;
    const isDragging = $derived(dragCounter > 0);

    const pendingInlays = $derived.by(() => {
        if (!$activeChat) return [];
        return pendingAttachments
            .map((attachmentId) => $activeChat?.inlays.refs[attachmentId])
            .filter((ref) => ref !== undefined);
    });

    // Reset state and scroll to bottom when active chat changes
    $effect(() => {
        const activeChatId = $activeChat?.id;
        if (activeChatId === previousActiveChatId) return;

        previousActiveChatId = activeChatId;
        chatViewEpoch += 1;
        hasMoreOlder = true;
        hasMoreNewer = false;
        isLoadingOlder = false;
        isLoadingNewer = false;
        pendingAttachments = [];
        dragCounter = 0;
        lastMessageCount = 0;
        tick().then(() => {
            if (scrollContainerEl) {
                scrollContainerEl.scrollTop = 0;
            }
        });
    });

    async function handleScroll() {
        if (!scrollContainerEl || !$activeChat) return;

        const activeChatId = $activeChat.id;
        const epoch = chatViewEpoch;
        const isCurrent = () => $activeChat?.id === activeChatId && chatViewEpoch === epoch;

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
                const loaded = await loadOlderMessages(activeChatId, MESSAGE_PAGE_SIZE, isCurrent);
                await tick();
                if (!isCurrent()) return;

                if (loaded === 0) {
                    hasMoreOlder = false;
                }

                const overflow = $displayMessages.length - MESSAGE_WINDOW_SIZE;
                if (overflow > 0) {
                    await dropNewerMessages(activeChatId, overflow);
                    if (!isCurrent()) return;
                    hasMoreNewer = true;
                }
            } catch (err) {
                logger.error('Failed to load older messages:', err);
            } finally {
                if (isCurrent()) isLoadingOlder = false;
            }
        } else if (absScrollTop < 30 && !isLoadingNewer && hasMoreNewer) {
            isLoadingNewer = true;

            try {
                const loaded = await loadNewerMessages(activeChatId, MESSAGE_PAGE_SIZE, isCurrent);
                await tick();
                if (!isCurrent()) return;

                if (loaded === 0) {
                    hasMoreNewer = false;
                }

                const overflow = $displayMessages.length - MESSAGE_WINDOW_SIZE;
                if (overflow > 0) {
                    await dropOlderMessages(activeChatId, overflow);
                    if (!isCurrent()) return;
                    hasMoreOlder = true;
                }

                await tick();
            } catch (err) {
                logger.error('Failed to load newer messages:', err);
            } finally {
                if (isCurrent()) isLoadingNewer = false;
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
        const piped = await runPipeline('input', ctx, templated);
        const processedText = await runTemplate(piped, ctx);
        const inlayIds = Array.from(pendingAttachments);
        const parts: AgentPart[] = [];
        if (inlayIds.length > 0) parts.push({ type: 'inlay', ids: inlayIds });
        if (processedText.trim()) parts.push({ type: 'text', text: processedText });

        const variables = await getChatVariables($activeChat.id);
        const message = await createMessage($activeChat.id, {
            role: 'user'
        });

        await prepareNextSwipe(message, {
            parts,
            variables,
            speakerId: selectedPersona.id,
            speakerName: selectedPersona.name,
            replaceActiveSwipe: true
        });

        void emitEvent(
            'message:sent',
            { ...ctx, chatId: $activeChat.id, characterId: selectedCharacter.id },
            { content: processedText }
        );

        newMessageText = '';
        pendingAttachments = [];
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

    function handlePaste(e: ClipboardEvent) {
        const files = filesFromPaste(e);
        if (files.length === 0) return;
        e.preventDefault();
        void attachFiles(files);
    }

    function handleDragEnter(e: DragEvent) {
        if (!hasDraggedFiles(e)) return;
        e.preventDefault();
        dragCounter += 1;
    }

    function handleDragOver(e: DragEvent) {
        if (!hasDraggedFiles(e)) return;
        e.preventDefault();
    }

    function handleDragLeave(e: DragEvent) {
        if (!hasDraggedFiles(e)) return;
        e.preventDefault();
        dragCounter = Math.max(0, dragCounter - 1);
    }

    function handleDrop(e: DragEvent) {
        if (!hasDraggedFiles(e)) return;
        e.preventDefault();
        dragCounter = 0;
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length > 0) void attachFiles(files);
    }

    function filesFromPaste(e: ClipboardEvent): File[] {
        const data = e.clipboardData;
        if (!data) return [];
        const files = Array.from(data.files ?? []);
        if (files.length > 0) return files;
        return Array.from(data.items ?? []).flatMap((item) => {
            if (item.kind !== 'file') return [];
            const file = item.getAsFile();
            return file ? [file] : [];
        });
    }

    function hasDraggedFiles(e: DragEvent): boolean {
        const data = e.dataTransfer;
        if (!data) return false;
        return data.files.length > 0 || Array.from(data.types).includes('Files');
    }

    function addAttachment(assetId: string) {
        if (pendingAttachments.length >= MAX_ATTACHMENTS || pendingAttachments.includes(assetId))
            return;
        pendingAttachments = [...pendingAttachments, assetId];
    }

    function removeAttachment(assetId: string) {
        pendingAttachments = pendingAttachments.filter((id) => id !== assetId);
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
                    role="region"
                    aria-label="Message composer"
                    class="relative z-10 flex items-end gap-2 border-t bg-background/80 px-4 py-3 backdrop-blur"
                    ondragenter={handleDragEnter}
                    ondragover={handleDragOver}
                    ondragleave={handleDragLeave}
                    ondrop={handleDrop}
                >
                    {#if isDragging}
                        <div
                            class="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-md border-2 border-dashed border-primary/50 bg-primary/5 text-sm font-medium text-primary"
                        >
                            Drop images, audio, or video to attach
                        </div>
                    {/if}
                    <div class="min-w-0 flex-1 space-y-2">
                        {#if pendingInlays.length > 0}
                            <div class="flex gap-2 overflow-x-auto pb-1 pr-1 pt-1">
                                {#each pendingInlays as ref (ref.id)}
                                    <div
                                        class="relative size-14 shrink-0 overflow-visible rounded-md"
                                    >
                                        <div
                                            class="absolute inset-0 overflow-hidden rounded-md border"
                                        >
                                            <AssetView
                                                asset={{
                                                    scopeType: $activeChat!.scopeType,
                                                    scopeId: $activeChat!.scopeId,
                                                    ownerTable: 'chats',
                                                    ownerId: $activeChat!.id,
                                                    hash: ref.hash,
                                                    encKey: ref.encKey,
                                                    mimeType: ref.mimeType
                                                }}
                                                alt={ref.name}
                                                class="size-full object-cover"
                                                fallback="none"
                                            />
                                        </div>
                                        <button
                                            type="button"
                                            class="absolute -right-1 -top-1 z-10 flex size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm"
                                            aria-label={`Remove ${ref.name} attachment`}
                                            onclick={() => removeAttachment(ref.id)}
                                        >
                                            <X class="size-3" />
                                        </button>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                        <div class="flex items-end gap-2">
                            <Button
                                variant="secondary"
                                size="icon"
                                class="shrink-0"
                                onclick={handleAttachmentUpload}
                                disabled={$isChatRunning ||
                                    pendingAttachments.length >= MAX_ATTACHMENTS}
                                title="Attach media"
                                aria-label="Attach media"
                            >
                                <Paperclip class="size-4" />
                            </Button>
                            <AutoResizeTextarea
                                bind:value={newMessageText}
                                classname="min-h-10 py-2.5"
                                onkeydown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSendMessage();
                                    }
                                }}
                                onpaste={handlePaste}
                                placeholder="Type a message..."
                                disabled={$isChatRunning}
                            />
                        </div>
                    </div>
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
                            disabled={(!newMessageText.trim() && pendingAttachments.length === 0) ||
                                $isChatRunning}
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
