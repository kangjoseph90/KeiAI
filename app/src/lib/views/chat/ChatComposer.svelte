<script lang="ts">
    import {
        ArrowDown,
        Languages,
        MessageSquare,
        Mic,
        Paperclip,
        Plus,
        SendHorizontal,
        Square,
        X
    } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
    import AutoResizeTextarea from '$lib/components/AutoResizeTextarea.svelte';
    import AssetView from '$lib/components/AssetView.svelte';
    import {
        activeChat,
        appSettings,
        chatDrafts,
        chatPersonas,
        chatSelections,
        createChatInlay,
        createMessage,
        dictationTasks,
        hasRecordingDictation,
        inputTranslationTasks,
        isChatRunning,
        roomCharacters,
        addChatDraftInlay,
        clearChatDraft,
        flushChatDrafts,
        loadChatDraft,
        MAX_CHAT_DRAFT_INLAYS,
        setChatDraftInlayIds,
        setChatDraftText,
        type DictationTask
    } from '$lib/stores';
    import {
        cancelDictation,
        dismissDictation,
        finishDictation,
        runChat,
        runDictation,
        runInputTranslation,
        stopChat,
        stopInputTranslationForChat
    } from '$lib/tasks';
    import { characterPickerOpen, personaPickerOpen, toast } from '$lib/ui';
    import { getChatVariables, prepareNextSwipe } from '$lib/managers';
    import { runPipeline } from '$lib/pipeline';
    import { runTemplate } from '$lib/template';
    import { createLogger } from '$lib/adapters/logger';
    import { emitEvent } from '$lib/events';
    import { appDialog } from '$lib/adapters/dialog';
    import { getErrorMessage } from '$lib/types/errors';
    import { MEDIA_ASSET_EXTENSIONS } from '$lib/types/asset';
    import type { RuntimeContext } from '$lib/types/context';
    import { type AgentPart } from '$lib/workflow/agent/llm';
    import { untrack } from 'svelte';
    import DictationControls from './DictationControls.svelte';
    import ChatSuggestions from './ChatSuggestions.svelte';

    let {
        showScrollToBottom = false,
        overlayInert = false,
        onHeightChange,
        onScrollToBottom
    }: {
        showScrollToBottom?: boolean;
        overlayInert?: boolean;
        onHeightChange: (height: number) => void;
        onScrollToBottom: () => void;
    } = $props();

    const logger = createLogger('view:composer');
    const MAX_ATTACHMENTS = MAX_CHAT_DRAFT_INLAYS;
    let composerElement = $state<HTMLElement>();
    let textHeight = $state(0);
    let dragCounter = $state(0);
    let value = $state('');
    let attachmentIds = $state<string[]>([]);
    let previousChatId: string | undefined;

    const isExpanded = $derived(textHeight > 48);
    const hasContent = $derived(value.trim().length > 0 || attachmentIds.length > 0);
    const isDragging = $derived(dragCounter > 0);
    const dictationTask = $derived<DictationTask | null>(
        $activeChat ? ($dictationTasks.get($activeChat.id) ?? null) : null
    );
    const dictationBusy = $derived(
        dictationTask?.phase === 'recording' || dictationTask?.phase === 'transcribing'
    );
    const pendingInlays = $derived.by(() => {
        if (!$activeChat) return [];
        return attachmentIds
            .map((attachmentId) => $activeChat?.inlays.refs[attachmentId])
            .filter((ref) => ref !== undefined);
    });
    const selectedPersona = $derived.by(() => {
        const personaId = $chatSelections?.personaId ?? $activeChat?.defaultPersonaId;
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
    const hasSuggestions = $derived.by(() => {
        const chatId = $activeChat?.id;
        if (!chatId) return false;
        return Object.keys($chatDrafts.get(chatId)?.suggestions ?? {}).length > 0;
    });
    const hasGeneratingInputTranslation = $derived.by(() => {
        const chatId = $activeChat?.id;
        if (!chatId) return false;
        return Array.from($inputTranslationTasks.values()).some(
            (task) => task.chatId === chatId && task.status === 'generating'
        );
    });

    $effect(() => {
        const activeChatId = $activeChat?.id;
        if (activeChatId === previousChatId) return;

        previousChatId = activeChatId;
        dragCounter = 0;
        value = '';
        attachmentIds = [];
        if (activeChatId) void restoreDraft(activeChatId);
    });

    $effect(() => {
        const activeChatId = $activeChat?.id;
        if (!activeChatId) return;
        const draft = $chatDrafts.get(activeChatId);
        if (!draft) return;

        untrack(() => {
            if (value !== draft.text) value = draft.text;
            const validInlayIds = draft.inlayIds.filter((id) =>
                Boolean($activeChat?.inlays.refs[id])
            );
            if (!sameIds(attachmentIds, validInlayIds)) attachmentIds = validInlayIds;
            if (!sameIds(validInlayIds, draft.inlayIds)) {
                setChatDraftInlayIds(activeChatId, validInlayIds);
            }
        });
    });

    $effect(() => {
        if (!composerElement) return;

        const updateHeight = () => {
            onHeightChange(Math.ceil(composerElement?.getBoundingClientRect().height ?? 0));
        };
        const observer = new ResizeObserver(updateHeight);
        observer.observe(composerElement);
        updateHeight();
        return () => observer.disconnect();
    });

    function handlePaste(event: ClipboardEvent) {
        const files = filesFromPaste(event);
        if (files.length === 0) return;
        event.preventDefault();
        void attachFiles(files);
    }

    function handleDragEnter(event: DragEvent) {
        if (dictationBusy) return;
        if (!hasDraggedFiles(event)) return;
        event.preventDefault();
        dragCounter += 1;
    }

    function handleDragOver(event: DragEvent) {
        if (dictationBusy) return;
        if (!hasDraggedFiles(event)) return;
        event.preventDefault();
    }

    function handleDragLeave(event: DragEvent) {
        event.preventDefault();
        dragCounter = Math.max(0, dragCounter - 1);
    }

    function handleDrop(event: DragEvent) {
        if (dictationBusy) return;
        if (!hasDraggedFiles(event)) return;
        event.preventDefault();
        dragCounter = 0;
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length > 0) void attachFiles(files);
    }

    function filesFromPaste(event: ClipboardEvent): File[] {
        const data = event.clipboardData;
        if (!data) return [];
        const files = Array.from(data.files ?? []);
        if (files.length > 0) return files;
        return Array.from(data.items ?? []).flatMap((item) => {
            if (item.kind !== 'file') return [];
            const file = item.getAsFile();
            return file ? [file] : [];
        });
    }

    function hasDraggedFiles(event: DragEvent): boolean {
        const data = event.dataTransfer;
        if (!data) return false;
        return data.files.length > 0 || Array.from(data.types).includes('Files');
    }

    async function restoreDraft(targetChatId: string): Promise<void> {
        const draft = await loadChatDraft(targetChatId);
        if ($activeChat?.id !== targetChatId) return;
        const validInlayIds = draft.inlayIds.filter((id) => Boolean($activeChat?.inlays.refs[id]));
        if (!sameIds(validInlayIds, draft.inlayIds)) {
            setChatDraftInlayIds(targetChatId, validInlayIds);
        }
    }

    function sameIds(a: string[], b: string[]): boolean {
        return a.length === b.length && a.every((id, index) => id === b[index]);
    }

    function removeAttachment(id: string): void {
        attachmentIds = attachmentIds.filter((attachmentId) => attachmentId !== id);
        if ($activeChat) setChatDraftInlayIds($activeChat.id, attachmentIds);
    }

    async function handleSendMessage(): Promise<void> {
        if ((!value.trim() && attachmentIds.length === 0) || !$activeChat || $isChatRunning) return;

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
            roomId: $activeChat.roomId,
            presetId: $appSettings?.presetId,
            characterId: defaultCharacter?.id,
            personaId: targetPersonaId,
            chatId: targetChatId,
            speakerId: targetPersonaId,
            speakerName: selectedPersona.name,
            role: 'user'
        };
        const templated = await runTemplate(value, ctx);
        const piped = await runPipeline('input', ctx, templated);
        const processedText = await runTemplate(piped, ctx);
        const inlayIds = Array.from(attachmentIds);
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

        value = '';
        attachmentIds = [];
        stopInputTranslationForChat(targetChatId);
        clearChatDraft(targetChatId);
        void flushChatDrafts().catch((error) =>
            logger.warn('Failed to clear cached chat draft:', error)
        );

        if ($appSettings?.chat.autoGenerateResponse !== false && $activeChat?.id === targetChatId) {
            void runChat(targetChatId, targetCharacterId, targetPersonaId).catch((error) => {
                if (error instanceof DOMException && error.name === 'AbortError') return;
                toast.error({
                    title: 'Could not start chat generation',
                    description: getErrorMessage(error)
                });
            });
        }
    }

    function handleGenerateResponse(): void {
        if (!$activeChat || $isChatRunning) return;
        if (!selectedCharacter) {
            $characterPickerOpen = true;
            return;
        }
        if (!selectedPersona) {
            $personaPickerOpen = true;
            return;
        }
        void runChat($activeChat.id, selectedCharacter.id, selectedPersona.id).catch((error) => {
            if (error instanceof DOMException && error.name === 'AbortError') return;
            toast.error({
                title: 'Could not start chat generation',
                description: getErrorMessage(error)
            });
        });
    }

    function handleStop(): void {
        const chatId = $activeChat?.id;
        if (chatId) stopChat(chatId);
    }

    async function attachFiles(files: File[]): Promise<void> {
        const chatId = $activeChat?.id;
        if (!chatId) return;

        const remaining = MAX_ATTACHMENTS - attachmentIds.length;
        const candidates = files.slice(0, remaining);
        if (candidates.length === 0) return;

        let firstError: unknown;
        for (const file of candidates) {
            try {
                const ref = await createChatInlay(chatId, file);
                if ($activeChat?.id === chatId) addChatDraftInlay(chatId, ref.id);
            } catch (error) {
                logger.error('Failed to attach media:', error);
                firstError ??= error;
            }
        }
        if (firstError) {
            toast.error({
                title: 'Could not attach some media',
                description: getErrorMessage(firstError)
            });
        }
    }

    async function handleAttachmentUpload(): Promise<void> {
        if (!$activeChat || attachmentIds.length >= MAX_ATTACHMENTS) return;
        const files = await appDialog.openMultipleFiles({
            title: 'Attach Media',
            filters: [{ name: 'Images, audio, and video', extensions: [...MEDIA_ASSET_EXTENSIONS] }]
        });
        if (files?.length) await attachFiles(files);
    }

    function handleStartDictation(): void {
        const chatId = $activeChat?.id;
        if (!chatId) return;
        void runDictation(chatId).catch((error) => {
            if (error instanceof DOMException && error.name === 'AbortError') return;
            toast.error({
                title: 'Could not start dictation',
                description: getErrorMessage(error)
            });
        });
    }

    function handleCancelDictation(): void {
        const chatId = $activeChat?.id;
        if (chatId) cancelDictation(chatId);
    }

    function handleFinishDictation(): void {
        const chatId = $activeChat?.id;
        if (chatId) finishDictation(chatId);
    }

    function handleDismissDictation(): void {
        const chatId = $activeChat?.id;
        if (chatId) dismissDictation(chatId);
    }

    function handleInputTranslation(): void {
        const chatId = $activeChat?.id;
        if (!chatId || !value.trim()) return;
        void runInputTranslation(chatId).catch((error) => {
            if (error instanceof DOMException && error.name === 'AbortError') return;
            toast.error({
                title: 'Could not start input translation',
                description: getErrorMessage(error)
            });
        });
    }
</script>

<div
    role="region"
    aria-label="Message composer"
    inert={overlayInert}
    class="absolute inset-x-0 bottom-0 z-20 isolate px-3 pb-4 pt-1 md:px-4"
    ondragenter={handleDragEnter}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
>
    <div
        class="pointer-events-none absolute left-0 right-3.5 md:right-4 -top-8 bottom-0 -z-10 bg-linear-to-b from-transparent via-background/45 to-background backdrop-blur-[1px] mask-[linear-gradient(to_bottom,transparent,black_62%)]"
        aria-hidden="true"
    ></div>

    {#if showScrollToBottom}
        <div class="absolute -top-12 left-1/2 z-20 -translate-x-1/2">
            <Button
                variant="secondary"
                size="icon"
                class="flex items-center justify-center rounded-full border bg-background/80 shadow-md backdrop-blur transition-opacity hover:bg-accent"
                onclick={onScrollToBottom}
                aria-label="Scroll to bottom"
            >
                <ArrowDown class="size-5" />
            </Button>
        </div>
    {/if}

    <div bind:this={composerElement} class="mx-auto w-full max-w-3xl">
        {#if hasSuggestions && $activeChat}
            <ChatSuggestions chatId={$activeChat.id} class="mb-2" />
        {/if}
        <div
            class="relative rounded-3xl border border-border/80 bg-background/90 p-2 shadow-lg shadow-black/10 backdrop-blur-xl transition-[border-color,box-shadow] has-[textarea:focus]:border-ring/60 has-[textarea:focus]:ring-2 has-[textarea:focus]:ring-ring/20"
        >
            {#if isDragging && !dictationBusy}
                <div
                    class="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-3xl border-2 border-dashed border-primary/50 bg-background/95 text-sm font-medium text-primary backdrop-blur"
                >
                    Drop images, audio, or video to attach
                </div>
            {/if}

            {#if !dictationBusy && pendingInlays.length > 0 && $activeChat}
                <div class="flex gap-2 overflow-x-auto px-2 pb-2 pt-1">
                    {#each pendingInlays as ref (ref.id)}
                        <div class="relative size-18 shrink-0 overflow-visible rounded-lg">
                            <div class="absolute inset-0 overflow-hidden rounded-lg border">
                                <AssetView
                                    asset={{
                                        scopeType: $activeChat.scopeType,
                                        scopeId: $activeChat.scopeId,
                                        ownerTable: 'chats',
                                        ownerId: $activeChat.id,
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
                                onmousedown={(event) => event.preventDefault()}
                                onclick={() => removeAttachment(ref.id)}
                            >
                                <X class="size-3" />
                            </button>
                        </div>
                    {/each}
                </div>
            {/if}

            {#if dictationBusy && dictationTask}
                <DictationControls
                    task={dictationTask}
                    onCancel={handleCancelDictation}
                    onFinish={handleFinishDictation}
                    onDismiss={handleDismissDictation}
                />
            {:else}
                {#if dictationTask?.phase === 'error'}
                    <DictationControls
                        task={dictationTask}
                        onCancel={handleCancelDictation}
                        onFinish={handleFinishDictation}
                        onDismiss={handleDismissDictation}
                        class="mb-2"
                    />
                {/if}
                <div
                    class="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] gap-1 {isExpanded
                        ? 'items-end grid-rows-[auto_auto]'
                        : 'items-center grid-rows-1'}"
                >
                    <div
                        class="col-start-1 shrink-0 self-end {isExpanded
                            ? 'row-start-2'
                            : 'row-start-1'}"
                    >
                        <DropdownMenu.Root>
                            <DropdownMenu.Trigger>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    class="rounded-full text-muted-foreground"
                                    disabled={attachmentIds.length >= MAX_ATTACHMENTS}
                                    title="Add"
                                    aria-label="Add"
                                >
                                    <Plus class="size-4" />
                                </Button>
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Content
                                side="top"
                                align="start"
                                sideOffset={4}
                                class="w-52"
                            >
                                <DropdownMenu.Item
                                    class="cursor-pointer whitespace-nowrap"
                                    disabled={attachmentIds.length >= MAX_ATTACHMENTS}
                                    onclick={() => void handleAttachmentUpload()}
                                >
                                    <Paperclip class="size-4" />
                                    Attach media
                                </DropdownMenu.Item>
                                <DropdownMenu.Item
                                    class="cursor-pointer whitespace-nowrap"
                                    disabled={!value.trim() || hasGeneratingInputTranslation}
                                    onclick={handleInputTranslation}
                                >
                                    <Languages class="size-4" />
                                    Translate input
                                </DropdownMenu.Item>
                            </DropdownMenu.Content>
                        </DropdownMenu.Root>
                    </div>

                    <AutoResizeTextarea
                        bind:value
                        classname="min-h-9 min-w-0 border-0 bg-transparent px-2 py-2 shadow-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 {isExpanded
                            ? 'col-span-3 row-start-1 mx-2 w-auto'
                            : 'col-start-2 row-start-1'}"
                        onheightchange={(height) => (textHeight = height)}
                        oninput={() => {
                            if ($activeChat) setChatDraftText($activeChat.id, value);
                        }}
                        onkeydown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault();
                                void handleSendMessage();
                            }
                        }}
                        onpaste={handlePaste}
                        placeholder="Type a message..."
                    />

                    <div
                        class="col-start-3 flex shrink-0 items-center gap-1 {isExpanded
                            ? 'row-start-2'
                            : 'row-start-1'}"
                    >
                        {#if $isChatRunning}
                            <Button
                                variant="destructive"
                                size="icon"
                                class="shrink-0 rounded-full"
                                onclick={handleStop}
                                title="Stop generation"
                                aria-label="Stop generation"
                            >
                                <Square class="size-4" />
                            </Button>
                        {:else}
                            <Button
                                variant="ghost"
                                size="icon"
                                class="shrink-0 rounded-full text-muted-foreground"
                                onclick={handleStartDictation}
                                disabled={$hasRecordingDictation || dictationTask !== null}
                                title="Start dictation"
                                aria-label="Start dictation"
                            >
                                <Mic class="size-4" />
                            </Button>
                            {#if hasContent}
                                <Button
                                    size="icon"
                                    class="shrink-0 rounded-full"
                                    onclick={() => void handleSendMessage()}
                                    title="Send message"
                                    aria-label="Send message"
                                >
                                    <SendHorizontal class="size-4" />
                                </Button>
                            {:else}
                                <Button
                                    variant="secondary"
                                    size="icon"
                                    class="shrink-0 rounded-full"
                                    onclick={handleGenerateResponse}
                                    title="Generate response"
                                    aria-label="Generate response"
                                >
                                    <MessageSquare class="size-4" />
                                </Button>
                            {/if}
                        {/if}
                    </div>
                </div>
            {/if}
        </div>
    </div>
</div>
