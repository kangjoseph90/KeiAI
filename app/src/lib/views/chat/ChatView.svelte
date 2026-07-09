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
    import { appDialog } from '$lib/adapters/dialog';
    import {
        MAX_ATTACHMENTS,
        extractImageFilesFromDrop,
        extractImageFilesFromPaste,
        hasDroppableFiles,
        selectImageFiles
    } from './composer-assets';

    let { roomId, chatId }: { roomId: string; chatId?: string } = $props();

    const logger = createLogger('view:chat');
    let newMessageText = $state('');
    let pendingAttachments = $state<string[]>([]);
    let editModeId = $state<string | null>(null);
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
        hasMoreOlder = true;
        hasMoreNewer = false;
        pendingAttachments = [];
        dragCounter = 0;
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
        if (
            (!newMessageText.trim() && pendingAttachments.length === 0) ||
            !$activeChat ||
            $isChatRunning
        )
            return;

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
        const attachments = Array.from(pendingAttachments);

        const variables = await getChatVariables($activeChat.id);
        const message = await createMessage($activeChat.id, {
            role: 'user'
        });

        await prepareNextSwipe(message, {
            parts: processedText.trim() ? [{ type: 'content', text: processedText }] : [],
            variables,
            speakerId: selectedPersona.id,
            speakerName: selectedPersona.name,
            attachments,
            replaceActiveSwipe: true
        });

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
        const candidates = selectImageFiles(files, remaining);
        if (candidates.length === 0) return;

        for (const file of candidates) {
            try {
                const ref = await createChatInlay(chatId, file);
                // Only attach if the user hasn't switched chats while we awaited.
                if ($activeChat?.id === chatId) addAttachment(ref.id);
            } catch (err) {
                logger.error('Failed to attach image:', err);
            }
        }
    }

    async function handleAttachmentUpload() {
        if (!$activeChat || pendingAttachments.length >= MAX_ATTACHMENTS) return;

        const file = await appDialog.openFile({
            title: 'Attach Image',
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
        });
        if (!file) return;

        await attachFiles([file]);
    }

    function handlePaste(e: ClipboardEvent) {
        const images = extractImageFilesFromPaste(e);
        if (images.length === 0) return; // text-only paste: keep browser default
        e.preventDefault();
        void attachFiles(images);
    }

    function handleDragEnter(e: DragEvent) {
        if (!hasDroppableFiles(e)) return;
        e.preventDefault();
        dragCounter += 1;
    }

    function handleDragOver(e: DragEvent) {
        if (!hasDroppableFiles(e)) return;
        e.preventDefault();
    }

    function handleDragLeave(e: DragEvent) {
        if (!hasDroppableFiles(e)) return;
        e.preventDefault();
        dragCounter = Math.max(0, dragCounter - 1);
    }

    function handleDrop(e: DragEvent) {
        if (!hasDroppableFiles(e)) return;
        e.preventDefault();
        dragCounter = 0;
        const images = extractImageFilesFromDrop(e);
        if (images.length > 0) void attachFiles(images);
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
                            Drop images to attach
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
                                                    encKey: ref.encKey
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
                        <div class="flex gap-2">
                            <Button
                                variant="secondary"
                                size="icon"
                                class="shrink-0"
                                onclick={handleAttachmentUpload}
                                disabled={$isChatRunning ||
                                    pendingAttachments.length >= MAX_ATTACHMENTS}
                                title="Attach image"
                                aria-label="Attach image"
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
                    <ChatRuntimePanel chatId={$activeChat.id} onSelectInlay={addAttachment} />
                </div>
            {/if}
        {/if}
    </div>
</div>
