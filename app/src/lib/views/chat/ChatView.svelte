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
        chatTasks,
        collectedTasks,
        roomCharacters,
        displayMessages,
        loadInitialMessages,
        loadOlderMessages,
        loadNewerMessages,
        dropOlderMessages,
        dropNewerMessages,
        consumeCompletedTasks
    } from '$lib/stores';
    import { createLogger } from '$lib/adapters/logger';
    import { onDestroy, tick } from 'svelte';

    let {
        roomId,
        inspectorOpen = $bindable(false),
        onRequestInspectorOpen,
        onRequestInspectorClose,
        roomOverlayOpen = false
    }: {
        roomId: string;
        inspectorOpen?: boolean;
        onRequestInspectorOpen?: () => void;
        onRequestInspectorClose?: () => void;
        roomOverlayOpen?: boolean;
    } = $props();

    const logger = createLogger('view:chat');
    let scrollContainerEl: HTMLElement | undefined = $state();
    type PaginationDirection = 'older' | 'newer';
    let paginationDirection = $state<PaginationDirection | null>(null);
    let showScrollToBottom = $state(false);
    let hasMoreOlder = $state(true);
    let hasMoreNewer = $state(false);
    let previousActiveChatId = $state<string | undefined>();
    let composerHeight = $state(0);
    let messagesContentEl: HTMLElement | undefined = $state();
    let chatViewElement: HTMLElement | undefined = $state();
    let chatLayoutTransitionSuppressed = $state(false);
    let chatPanelOverlayMode = $state(false);
    let streamReserveHeight = $state(0);
    let reserveContentHeight = 0;
    let previousGeneratingMessageId: string | null = null;
    let previousBottomOffset = 0;
    let isAdjustingStreamReserve = false;
    let chatViewEpoch = 0;
    let previousChatPanelOverlayMode: boolean | undefined;
    let chatLayoutTransitionFrame: number | undefined;
    let chatLayoutTransitionRestoreFrame: number | undefined;

    const MESSAGE_PAGE_SIZE = 30;
    const MESSAGE_WINDOW_SIZE = 120;
    const STICKY_BOTTOM_THRESHOLD = 30;
    const MIN_STREAM_RESERVE_HEIGHT = 240;
    const MAX_STREAM_RESERVE_HEIGHT = 640;
    const STREAM_RESERVE_RATIO = 0.68;
    const CHAT_PANEL_OVERLAY_MAX_WIDTH = 1023.98;
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
        if (chatLayoutTransitionFrame !== undefined) {
            cancelAnimationFrame(chatLayoutTransitionFrame);
        }
        if (chatLayoutTransitionRestoreFrame !== undefined) {
            cancelAnimationFrame(chatLayoutTransitionRestoreFrame);
        }
    });

    $effect(() => {
        const element = chatViewElement;
        if (!element) return;

        const updateMode = (width: number): void => {
            const overlayMode = width <= CHAT_PANEL_OVERLAY_MAX_WIDTH;
            if (
                previousChatPanelOverlayMode !== undefined &&
                previousChatPanelOverlayMode !== overlayMode
            ) {
                suppressChatLayoutTransitions();
            }
            previousChatPanelOverlayMode = overlayMode;
            chatPanelOverlayMode = overlayMode;
        };

        const observer = new ResizeObserver((entries) => {
            updateMode(entries[0]?.contentRect.width ?? element.getBoundingClientRect().width);
        });
        observer.observe(element);
        updateMode(element.getBoundingClientRect().width);

        return () => {
            observer.disconnect();
            previousChatPanelOverlayMode = undefined;
        };
    });

    function suppressChatLayoutTransitions(): void {
        if (chatLayoutTransitionFrame !== undefined) {
            cancelAnimationFrame(chatLayoutTransitionFrame);
        }
        if (chatLayoutTransitionRestoreFrame !== undefined) {
            cancelAnimationFrame(chatLayoutTransitionRestoreFrame);
        }

        chatLayoutTransitionSuppressed = true;
        chatLayoutTransitionFrame = requestAnimationFrame(() => {
            chatLayoutTransitionFrame = undefined;
            chatLayoutTransitionRestoreFrame = requestAnimationFrame(() => {
                chatLayoutTransitionRestoreFrame = undefined;
                chatLayoutTransitionSuppressed = false;
            });
        });
    }

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
        if (
            activeChatId &&
            $collectedTasks.some(
                (task) => task.chatId === activeChatId && task.status === 'completed'
            )
        ) {
            consumeCompletedTasks(activeChatId);
        }
        if (activeChatId === previousActiveChatId) return;

        previousActiveChatId = activeChatId;
        chatViewEpoch += 1;
        hasMoreOlder = true;
        hasMoreNewer = false;
        paginationDirection = null;
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

    const defaultCharacter = $derived.by(() => {
        const characterId = $activeChat?.defaultCharacterId;
        if (!characterId) return null;
        return $roomCharacters.find((character) => character.id === characterId) ?? null;
    });

    function openInspector(): void {
        if (onRequestInspectorOpen) onRequestInspectorOpen();
        else inspectorOpen = true;
    }

    function closeInspector(): void {
        if (onRequestInspectorClose) onRequestInspectorClose();
        else inspectorOpen = false;
    }

    function handleCloseInspectorBackdropClick(): void {
        const hasOpenOverlay = Boolean(
            document.querySelector(
                '[data-slot="dropdown-menu-content"], [data-slot="popover-content"], [data-slot="dialog-content"], [role="menu"]'
            )
        );
        if (hasOpenOverlay) return;
        closeInspector();
    }
</script>

<div
    bind:this={chatViewElement}
    class="chat-view-container flex h-full flex-col"
    data-layout-transition-suppressed={chatLayoutTransitionSuppressed}
>
    <!-- Main Area -->
    <div class="relative flex flex-1 overflow-hidden">
        {#if !$activeChat}
            <div
                class="flex flex-1 flex-col items-center justify-center gap-3 text-center"
                inert={roomOverlayOpen}
            >
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
            <div
                class="chat-messages-container relative flex min-w-0 flex-1 flex-col overflow-hidden"
            >
                <ChatBackground chatId={$activeChat.id} {defaultCharacter} />

                {#if !inspectorOpen}
                    <Button
                        variant="outline"
                        size="icon-lg"
                        class="absolute right-0 top-1.5 z-50 rounded-none rounded-l-md border-sidebar-border bg-sidebar/70 text-muted-foreground opacity-50 shadow-none backdrop-blur-sm transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:opacity-100 focus-visible:opacity-100 dark:bg-sidebar/70 dark:hover:bg-sidebar-accent"
                        title="Show chat context"
                        aria-label="Show chat context"
                        onclick={openInspector}
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
                    inert={roomOverlayOpen || (inspectorOpen && chatPanelOverlayMode)}
                    class="relative z-10 flex flex-1 flex-col overflow-y-auto px-4 pt-8 pb-4"
                    style="scrollbar-gutter: stable; padding-bottom: {messageBottomInset}px; overflow-anchor: {streamReserveHeight >
                    0
                        ? 'none'
                        : 'auto'};"
                >
                    <div
                        bind:this={messagesContentEl}
                        class="chat-messages-content flex flex-none flex-col gap-4 {$displayMessages.length ===
                        0
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
                    {showScrollToBottom}
                    overlayInert={roomOverlayOpen || (inspectorOpen && chatPanelOverlayMode)}
                    onHeightChange={(height) => (composerHeight = height)}
                    onScrollToBottom={scrollToBottom}
                />
            </div>

            <button
                type="button"
                class="app-chat-panel-backdrop absolute inset-0 z-30 hidden bg-black/35"
                data-open={inspectorOpen}
                aria-hidden={!inspectorOpen}
                aria-label="Close chat context"
                tabindex={inspectorOpen ? 0 : -1}
                onclick={handleCloseInspectorBackdropClick}
            ></button>
            <div
                class="app-chat-panel-stage relative shrink-0"
                data-open={inspectorOpen}
                aria-hidden={!inspectorOpen}
                inert={!inspectorOpen}
            >
                <div class="app-chat-runtime-panel relative h-full w-90 shrink-0">
                    <ChatRuntimePanel chatId={$activeChat.id} />
                </div>
            </div>
            <div
                class="app-chat-panel-close absolute top-1.5 z-50"
                data-open={inspectorOpen}
                aria-hidden={!inspectorOpen}
                inert={!inspectorOpen}
            >
                <Button
                    variant="outline"
                    size="icon-lg"
                    class="rounded-none rounded-l-md border-r-0 border-sidebar-border bg-sidebar/70 text-muted-foreground opacity-50 shadow-none backdrop-blur-sm transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:opacity-100 focus-visible:opacity-100 dark:bg-sidebar/70 dark:hover:bg-sidebar-accent"
                    tabindex={inspectorOpen ? 0 : -1}
                    title="Hide chat context"
                    aria-label="Hide chat context"
                    onclick={closeInspector}
                >
                    <ChevronRight class="size-4" />
                </Button>
            </div>
        {/if}
    </div>
</div>

<ChatCharacterPicker {roomId} />
{#if $activeChat}
    <ChatPersonaPicker chatId={$activeChat.id} />
{/if}

<style>
    .chat-view-container {
        container: chat-view / inline-size;
    }

    .chat-view-container[data-layout-transition-suppressed='true']
        :is(
            .app-chat-panel-stage,
            .app-chat-runtime-panel,
            .app-chat-panel-close,
            .app-chat-panel-backdrop
        ) {
        transition: none !important;
    }

    .chat-messages-container {
        container: chat-messages / inline-size;
    }

    .app-chat-panel-stage {
        width: 0;
        overflow: hidden;
        pointer-events: none;
        transition: width 240ms cubic-bezier(0.22, 1, 0.36, 1);
    }

    .app-chat-panel-stage[data-open='true'] {
        width: 360px;
        pointer-events: auto;
    }

    .app-chat-panel-close {
        right: 0;
        opacity: 0;
        pointer-events: none;
        transition:
            right 240ms cubic-bezier(0.22, 1, 0.36, 1),
            opacity 120ms ease-out;
    }

    .app-chat-panel-close[data-open='true'] {
        right: 360px;
        opacity: 1;
        pointer-events: auto;
    }

    .app-chat-panel-backdrop {
        opacity: 0;
        pointer-events: none;
        transition: opacity 180ms ease-out;
    }

    .app-chat-panel-backdrop[data-open='true'] {
        opacity: 1;
        pointer-events: auto;
    }

    @container chat-view (max-width: 1023.98px) {
        .app-chat-panel-backdrop {
            display: block;
        }

        .app-chat-panel-stage {
            position: absolute;
            inset-block: 0;
            right: 0;
            z-index: 40;
            width: clamp(
                0px,
                calc(100cqw - 6.25rem - var(--safe-area-left) - var(--safe-area-right)),
                22.75rem
            );
            transform: translateX(100%);
            transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
        }

        .app-chat-panel-stage[data-open='true'] {
            width: clamp(
                0px,
                calc(100cqw - 6.25rem - var(--safe-area-left) - var(--safe-area-right)),
                22.75rem
            );
            transform: translateX(0);
        }

        .app-chat-runtime-panel {
            width: clamp(
                0px,
                calc(100cqw - 6.25rem - var(--safe-area-left) - var(--safe-area-right)),
                22.75rem
            );
        }

        .app-chat-panel-close {
            display: none;
        }
    }
</style>
