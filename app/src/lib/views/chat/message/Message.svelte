<script lang="ts">
    /**
     * Message Component — Enhanced with RisuAI-style actions.
     * Copy, Regenerate, Edit, Delete actions on hover.
     * Character avatar + name display.
     */
    import type { DisplayMessage } from '$lib/stores';
    import { Button } from '$lib/components/ui/button';
    import { Textarea } from '$lib/components/ui/textarea';
    import {
        Check,
        GitBranch,
        Loader2,
        Pencil,
        RefreshCw,
        Trash2,
        X,
        ChevronLeft,
        ChevronRight,
        Copy,
        Languages
    } from 'lucide-svelte';
    import { onDestroy, tick } from 'svelte';
    import AssetView from '$lib/components/AssetView.svelte';
    import type { AssetReadLocator } from '$lib/services/asset';
    import { runPipeline } from '$lib/pipeline';
    import { runTemplate } from '$lib/template';
    import { createDisplayMacros } from '$lib/template/display';
    import { hydrateAssets } from '$lib/components/hydrate';
    import { scopeCss, stripStyleTags } from '$lib/utils/style';
    import {
        getLastTextContent,
        findVisibleStartIndex,
        findLastTextIndex,
        type AgentPart
    } from '$lib/workflow/agent/llm';
    import TextPart from './TextPart.svelte';
    import InlayPart from './InlayPart.svelte';
    import ThoughtPart from './ThoughtPart.svelte';
    import ToolCallPart from './ToolCallPart.svelte';
    import MessageMoreMenu from './MessageMoreMenu.svelte';
    import TaskErrorNotice from '../TaskErrorNotice.svelte';
    import {
        activeChat,
        activeRoom,
        appSettings,
        chatAssetsMap,
        chatPersonas,
        chatSelections,
        chatTasks,
        deleteMessage,
        selectActiveModules,
        characters,
        personas,
        roomCharacters,
        multiRoomCharacters,
        multiRoomPersonas,
        modules,
        imageGenerationTasks,
        ttsTasks,
        translationTasks,
        selectChat,
        updateMessage,
        updateMessageSwipe
    } from '$lib/stores';
    import {
        createTranslationSourceHash,
        dismissChat,
        dismissImageGeneration,
        dismissTTS,
        dismissTranslation,
        runChat,
        runTranslation,
        stopTranslation
    } from '$lib/tasks';
    import { forkChat, syncChatGreetings } from '$lib/managers';
    import { navigate } from '$lib/router';
    import {
        appConfirm,
        characterPickerOpen,
        personaPickerOpen,
        toast,
        copyTextToClipboard
    } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';
    import type { RuntimeContext } from '$lib/types/context';

    // ── Props ─────────────────────────────────────────────────────────────────

    let {
        message,
        isLastMessage = false
    }: {
        message: DisplayMessage;
        isLastMessage?: boolean;
    } = $props();

    // ── State ─────────────────────────────────────────────────────────────────

    let textareaEl = $state<HTMLTextAreaElement | null>(null);
    let copied = $state(false);
    let isEditing = $state(false);
    let isEditingTranslation = $state(false);
    let editText = $state('');
    type MessageAction = 'save' | 'delete' | 'swipe' | 'fork';
    let busyAction = $state<MessageAction | null>(null);

    $effect(() => {
        if (isEditing && textareaEl) {
            const frame = requestAnimationFrame(() => {
                textareaEl?.focus();
                if (textareaEl) {
                    const len = textareaEl.value.length;
                    textareaEl.setSelectionRange(len, len);
                }
            });
            return () => cancelAnimationFrame(frame);
        }
    });
    let translationSourceHash = $state('');
    let showTranslation = $state(false);
    let messageStyleHtml = $state('');
    let messageStyleSignature = '';
    let messageStyleVersion = 0;
    let messageElement = $state<HTMLDivElement | null>(null);
    let translationMinHeight = $state(0);
    let translationLockKey = '';

    // ── Derived ───────────────────────────────────────────────────────────────

    let isUser = $derived(message.role === 'user');
    let defaultCharacterId = $derived($activeChat?.defaultCharacterId);
    let defaultPersonaId = $derived($activeChat?.defaultPersonaId);
    let selectedPersona = $derived.by(() => {
        const personaId = $chatSelections?.personaId ?? defaultPersonaId;
        return personaId ? $chatPersonas.find((persona) => persona.id === personaId) : undefined;
    });
    let selectedCharacter = $derived.by(() => {
        const characterId = $chatSelections?.characterId ?? defaultCharacterId;
        return characterId
            ? $roomCharacters.find((character) => character.id === characterId)
            : undefined;
    });
    let chatTask = $derived($chatTasks.get(message.chatId));
    let actionsDisabled = $derived(busyAction !== null);

    /** The swipe that is currently active for this message. */
    let activeSwipe = $derived(message.swipes[message.activeSwipeId]);
    let currentContent = $derived(activeSwipe ? getLastTextContent(activeSwipe.parts) : '');
    let translationTask = $derived($translationTasks.get(message.id));
    let imageGenerationTask = $derived($imageGenerationTasks.get(message.id));
    let ttsTask = $derived($ttsTasks.get(message.id));
    let matchingTranslationTask = $derived(
        translationTask?.sourceHash === translationSourceHash ? translationTask : undefined
    );
    let cachedTranslation = $derived(
        activeSwipe?.translation?.sourceHash === translationSourceHash
            ? activeSwipe.translation
            : null
    );
    let translatedContent = $derived(cachedTranslation?.text ?? '');
    let visibleContent = $derived(
        showTranslation && translatedContent ? translatedContent : currentContent
    );

    /** Swipes sorted by creation time for consistent navigation. */
    let sortedSwipes = $derived(
        Object.values(message.swipes).sort((a, b) => a.createdAt - b.createdAt)
    );

    /** The position of the active swipe in the sorted list. */
    let swipePos = $derived(sortedSwipes.findIndex((s) => s.id === message.activeSwipeId));
    let displayCharacterId = $derived(
        message.role === 'assistant' && activeSwipe?.speakerId
            ? activeSwipe.speakerId
            : defaultCharacterId
    );
    let displayPersonaId = $derived(
        message.role === 'user' && activeSwipe?.speakerId ? activeSwipe.speakerId : defaultPersonaId
    );
    let currentCharacter = $derived(
        [...$characters, ...$multiRoomCharacters].find(
            (character) => character.id === displayCharacterId
        )
    );
    let currentPersona = $derived(
        [...$personas, ...$multiRoomPersonas].find((persona) => persona.id === displayPersonaId)
    );
    let speakerName = $derived(
        (isUser ? currentPersona?.name : currentCharacter?.name) ??
            activeSwipe?.speakerName ??
            (isUser ? 'User' : 'Assistant')
    );
    let speakerInitial = $derived((speakerName.trim().charAt(0) || '?').toUpperCase());
    let messageScope = $derived(`kei-${message.id}-${message.activeSwipeId}`);

    // ── Parts timeline ────────────────────────────────────────────────────────

    let parts = $derived<AgentPart[]>(activeSwipe?.parts ?? []);
    let imageAttachments = $derived(activeSwipe?.imageAttachments ?? []);
    let audioAttachments = $derived(activeSwipe?.audioAttachments ?? []);
    let indexedParts = $derived(parts.map((part, index) => ({ part, index })));
    let visibleStartIdx = $derived(findVisibleStartIndex(parts));
    let traceCount = $derived(visibleStartIdx);
    let lastTextIdx = $derived(findLastTextIndex(parts));

    $effect(() => {
        const task = translationTask;
        const lastTextIndex = lastTextIdx;
        const element = messageElement;
        const isStreamingTranslation = showTranslation && task?.status === 'generating';

        if (!isStreamingTranslation || !task) {
            translationMinHeight = 0;
            translationLockKey = '';
            return;
        }

        const lockKey = `${message.id}:${task.sourceHash}`;
        if (translationLockKey === lockKey || lastTextIndex < 0 || !element) return;

        let cancelled = false;
        void tick().then(() => {
            if (cancelled || translationLockKey === lockKey) return;
            const lastTextPart = element.querySelector<HTMLElement>(
                '[data-translation-last-text="true"]'
            );
            if (!lastTextPart) return;

            translationMinHeight = lastTextPart.getBoundingClientRect().height;
            translationLockKey = lockKey;
        });

        return () => {
            cancelled = true;
        };
    });

    let speakerAvatarLocator = $derived.by<AssetReadLocator | null>(() => {
        if (isUser) {
            const persona = $chatPersonas.find((p) => p.id === displayPersonaId);
            return persona?.avatar
                ? {
                      scopeType: persona.scopeType,
                      scopeId: persona.scopeId,
                      ownerTable: 'personas',
                      ownerId: persona.id,
                      hash: persona.avatar.hash,
                      encKey: persona.avatar.encKey,
                      mimeType: persona.avatar.mimeType
                  }
                : null;
        } else {
            const character = $roomCharacters.find((c) => c.id === displayCharacterId);
            return character?.avatar
                ? {
                      scopeType: character.scopeType,
                      scopeId: character.scopeId,
                      ownerTable: 'characters',
                      ownerId: character.id,
                      hash: character.avatar.hash,
                      encKey: character.avatar.encKey,
                      mimeType: character.avatar.mimeType
                  }
                : null;
        }
    });

    // ── Actions ───────────────────────────────────────────────────────────────

    async function handleCopy() {
        if (!(await copyTextToClipboard(visibleContent, 'Copied message'))) return;
        copied = true;
        setTimeout(() => (copied = false), 2000);
    }

    async function runMessageAction(
        type: MessageAction,
        errorTitle: string,
        action: () => Promise<void>
    ): Promise<void> {
        if (busyAction) return;
        busyAction = type;
        try {
            await action();
        } catch (error) {
            toast.error({ title: errorTitle, description: getErrorMessage(error) });
        } finally {
            busyAction = null;
        }
    }

    function startEdit(): void {
        isEditingTranslation = false;
        editText = currentContent;
        isEditing = true;
    }

    function startTranslationEdit(): void {
        isEditingTranslation = true;
        editText = activeSwipe?.translation?.text ?? '';
        isEditing = true;
    }

    function cancelEdit(): void {
        isEditing = false;
        isEditingTranslation = false;
        editText = '';
    }

    async function saveEdit(): Promise<void> {
        const text = editText.trim();
        const swipe = activeSwipe;
        if (!text || !swipe) return;

        if (isEditingTranslation) {
            if (!swipe.translation) return;
            const translation = { ...swipe.translation, text: editText };
            await runMessageAction('save', 'Could not save translation', async () => {
                await updateMessageSwipe(message.id, message.activeSwipeId, { translation });
                cancelEdit();
            });
            return;
        }

        const parts = [...swipe.parts];
        const lastTextIdx = findLastTextIndex(parts);
        if (lastTextIdx >= 0) {
            parts[lastTextIdx] = { ...parts[lastTextIdx], type: 'text', text: editText };
        } else {
            parts.push({ type: 'text', text: editText });
        }

        await runMessageAction('save', 'Could not save message', async () => {
            await updateMessageSwipe(message.id, message.activeSwipeId, { parts });
            cancelEdit();
        });
    }

    async function handleDelete(): Promise<void> {
        const messageId = message.id;
        const chatId = message.chatId;
        await runMessageAction('delete', 'Could not delete message', async () => {
            const confirmed = await appConfirm({
                title: 'Delete message?',
                description: 'Delete this message and all of its swipes? This cannot be undone.',
                confirmText: 'Delete',
                variant: 'destructive'
            });
            if (confirmed && $activeChat?.id === chatId) {
                await deleteMessage(chatId, messageId);
            }
        });
    }

    async function handleSwipe(newSwipeId: string): Promise<void> {
        const messageId = message.id;
        await runMessageAction('swipe', 'Could not change swipe', async () => {
            await updateMessage(messageId, { activeSwipeId: newSwipeId });
        });
    }

    async function handleFork(): Promise<void> {
        const sourceChatId = message.chatId;
        const messageId = message.id;
        const roomId = $activeRoom?.id;
        if (!roomId) return;
        await runMessageAction('fork', 'Could not fork chat', async () => {
            const newChatId = await forkChat(messageId);
            if ($activeChat?.id !== sourceChatId) return;
            await syncChatGreetings(newChatId);
            await selectChat(newChatId, () => $activeChat?.id === sourceChatId);
            if ($activeChat?.id !== newChatId) return;
            navigate({ view: 'room', roomId, chatId: newChatId });
        });
    }

    async function handleRegenerate(): Promise<void> {
        if (actionsDisabled || chatTask?.status === 'generating') return;
        if (!selectedCharacter) {
            $characterPickerOpen = true;
            return;
        }
        if (!selectedPersona) {
            $personaPickerOpen = true;
            return;
        }
        try {
            await runChat(message.chatId, selectedCharacter.id, selectedPersona.id, {
                reroll: true
            });
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return;
            toast.error({
                title: 'Could not start chat generation',
                description: getErrorMessage(error)
            });
        }
    }

    async function handleTranslate(): Promise<void> {
        showTranslation = true;
        try {
            await runTranslation(message.id, {
                force: cachedTranslation !== null
            });
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return;
            toast.error({
                title: 'Could not start translation',
                description: getErrorMessage(error)
            });
        }
    }

    // ── Render context (shared across text parts) ─────────────────────────────

    let renderContext = $derived.by(() => {
        const ownerId = message.role === 'assistant' ? displayCharacterId : defaultCharacterId;
        const character = ownerId ? $roomCharacters.find((item) => item.id === ownerId) : undefined;
        const activeModules = selectActiveModules($appSettings, $modules);
        const cssSource = [character?.messageCSS ?? '', ...activeModules.map((m) => m.messageCSS)]
            .filter((part) => part.trim())
            .join('\n');

        const selfId = message.role === 'user' ? displayPersonaId : displayCharacterId;
        const opponentId = message.role === 'user' ? displayCharacterId : displayPersonaId;
        const ownerIds = Array.from(
            new Set([
                selfId,
                opponentId,
                ...$roomCharacters.map((c) => c.id),
                ...$chatPersonas.map((p) => p.id),
                ...activeModules.map((m) => m.id)
            ])
        ).filter((id): id is string => !!id);

        const ctx: RuntimeContext = {
            roomId: $activeRoom?.id,
            presetId: $appSettings?.presetId,
            characterId: displayCharacterId,
            personaId: displayPersonaId,
            chatId: message.chatId,
            messageId: message.id,
            messageIndex: message.messageIndex,
            speakerId: activeSwipe?.speakerId,
            speakerName: activeSwipe?.speakerName,
            role: message.role
        };

        return {
            ctx,
            chatId: message.chatId,
            messageScope,
            ownerIds,
            chatAssetsMap: $chatAssetsMap,
            cssSource,
            displayStatus: message.displayStatus
        };
    });

    async function renderMessageCSS() {
        const { ctx, chatId, messageScope, ownerIds, chatAssetsMap, cssSource } = renderContext;
        const signature = [
            cssSource,
            messageScope,
            ctx.roomId ?? '',
            ctx.presetId ?? '',
            ctx.characterId ?? '',
            ctx.personaId ?? '',
            ctx.chatId ?? '',
            ctx.messageId ?? '',
            ctx.messageIndex ?? '',
            ctx.speakerId ?? '',
            ctx.speakerName ?? '',
            ctx.role ?? ''
        ].join('\u0000');
        if (signature === messageStyleSignature) return;
        messageStyleSignature = signature;

        const version = ++messageStyleVersion;

        if (!cssSource.trim()) {
            messageStyleHtml = '';
            return;
        }

        const displayMacros = createDisplayMacros(chatAssetsMap, ownerIds);
        const templated = await runTemplate(cssSource, ctx);
        const processed = await runPipeline('display', ctx, templated);
        const withAssets = await runTemplate(processed, ctx, displayMacros);
        const scopeSelector = `[data-keiai-message-scope="${messageScope.replace(/"/g, '\\"')}"]`;
        const css = scopeCss(stripStyleTags(withAssets), scopeSelector);

        if (version !== messageStyleVersion) return;
        messageStyleHtml = `<style>${css}</style>`;
    }

    /** Completed trace details state. Streaming renders raw parts without a trace wrapper. */
    let detailsOpen = $state(true);
    let lastDisplayStatus = $state<string | undefined>(undefined);

    $effect(() => {
        const status = message.displayStatus;
        if (status === 'generating' && lastDisplayStatus !== 'generating') {
            if ($appSettings?.chat?.expandStepsOnGeneration !== false) {
                detailsOpen = true;
            }
        } else if (status === 'completed' && lastDisplayStatus !== 'completed') {
            detailsOpen = false;
        }
        lastDisplayStatus = status;
    });

    $effect(() => {
        void renderMessageCSS();
    });

    let hasLoadedTranslation = false;
    $effect(() => {
        if (cachedTranslation && !hasLoadedTranslation) {
            if ($appSettings?.translation?.autoShowTranslation) {
                showTranslation = true;
                hasLoadedTranslation = true;
            }
        } else if (!cachedTranslation) {
            hasLoadedTranslation = false;
        }
    });

    $effect(() => {
        const source = currentContent;
        const targetLanguage = $appSettings?.translation.targetLanguage.trim() ?? '';
        translationSourceHash = '';

        if (source && targetLanguage) {
            void createTranslationSourceHash(source, targetLanguage).then((sourceHash) => {
                translationSourceHash = sourceHash;
            });
        }
    });

    onDestroy(() => {
        messageStyleVersion++;
    });
</script>

<!-- Message Container -->
<div
    bind:this={messageElement}
    class="chat-message group grid w-full max-w-4xl flex-none content-start self-center gap-x-2 {isUser
        ? 'is-user grid-cols-[minmax(0,1fr)_2rem]'
        : 'grid-cols-[2rem_minmax(0,1fr)]'}"
    role="group"
>
    <div
        class="row-start-1 flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-bold text-muted-foreground {isUser
            ? 'col-start-2'
            : 'col-start-1'}"
    >
        {#if speakerAvatarLocator}
            <AssetView
                asset={speakerAvatarLocator}
                alt={speakerName}
                class="size-full object-cover"
                focus="top"
            />
        {:else}
            {speakerInitial}
        {/if}
    </div>

    <span
        class="chat-message-mobile-name row-start-1 self-center truncate text-xs font-medium text-muted-foreground {isUser
            ? 'col-start-1 justify-self-end'
            : 'col-start-2'}">{speakerName}</span
    >

    <!-- Content Column -->
    <div
        class="chat-message-content col-span-2 row-start-2 mx-2 mt-2 flex min-w-0 max-w-[calc(100%-1rem)] flex-none flex-col gap-1 {imageAttachments.length >
            0 || audioAttachments.length > 0
            ? 'w-full'
            : ''} {isUser ? 'justify-self-end items-end' : 'justify-self-start items-start'}"
    >
        <span class="chat-message-desktop-name hidden text-xs font-medium text-muted-foreground"
            >{speakerName}</span
        >

        <!-- Edit Mode -->
        {#if isEditing && message.displayStatus === 'completed'}
            <div class="flex w-full flex-col gap-2">
                <Textarea
                    bind:ref={textareaEl}
                    bind:value={editText}
                    class="min-h-16 w-full"
                    disabled={actionsDisabled}
                />
                <div class="flex justify-end gap-2">
                    <Button
                        size="sm"
                        class="gap-1.5"
                        disabled={actionsDisabled}
                        aria-busy={busyAction === 'save'}
                        onclick={() => void saveEdit()}
                    >
                        <Check class="size-4" /> Save
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        class="gap-1.5"
                        disabled={actionsDisabled}
                        onclick={cancelEdit}
                    >
                        <X class="size-4" /> Cancel
                    </Button>
                </div>
            </div>

            <!-- Error Bubble -->
        {:else if message.displayStatus === 'error'}
            <TaskErrorNotice
                title="Generation failed"
                message={message.errorMessage ?? 'Unknown error'}
                onDismiss={() => dismissChat(message.chatId)}
            />

            <!-- Message Content -->
        {:else}
            <!-- Bubble -->
            <div
                class="relative flex flex-col gap-2 rounded-lg px-4 py-2.5 text-sm {isUser
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground'}"
                use:hydrateAssets={messageStyleHtml}
            >
                {#if message.displayStatus === 'generating' && parts.length === 0}
                    <span
                        class="flex items-center gap-1.5 {isUser
                            ? 'text-primary-foreground/70'
                            : 'text-muted-foreground'}"
                    >
                        <Loader2 class="size-3 animate-spin" />
                        {isUser ? 'Sending...' : 'Thinking...'}
                    </span>
                {:else if parts.length === 0}
                    <div class="min-h-5"></div>
                {:else}
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -- CSS is scoped by data-keiai-message-scope -->
                    {@html messageStyleHtml}

                    {#if traceCount > 0}
                        <button
                            type="button"
                            class="trace-summary-btn"
                            onclick={() => (detailsOpen = !detailsOpen)}
                            aria-label="Toggle trace timeline"
                        >
                            <span class="trace-root-dot"></span>
                            <span class="font-medium"
                                >{traceCount} step{traceCount > 1 ? 's' : ''}</span
                            >
                        </button>
                    {/if}

                    <div class="trace-flat-list">
                        {#each indexedParts as entry (entry.index)}
                            {@const isTrace = entry.index < traceCount}
                            {@const isFirstTrace = entry.index === 0}
                            {@const isLastTrace = entry.index === traceCount - 1}
                            {@const shouldHide = isTrace && traceCount > 0 && !detailsOpen}

                            <div
                                class="trace-flat-item {isTrace
                                    ? 'is-trace'
                                    : 'is-answer'} {isFirstTrace
                                    ? 'is-first-trace'
                                    : ''} {isLastTrace ? 'is-last-trace' : ''} {shouldHide
                                    ? 'hidden'
                                    : ''}"
                            >
                                {#if isTrace}
                                    <span class="trace-dot"></span>
                                {/if}
                                <div
                                    class="trace-flat-body"
                                    data-translation-last-text={entry.index === lastTextIdx
                                        ? 'true'
                                        : undefined}
                                    style:min-height={entry.index === lastTextIdx &&
                                    translationMinHeight > 0
                                        ? `${translationMinHeight}px`
                                        : undefined}
                                >
                                    {#if entry.part.type === 'thought'}
                                        <ThoughtPart
                                            text={entry.part.text}
                                            collapsible={traceCount > 1}
                                        />
                                    {:else if entry.part.type === 'tool_calls'}
                                        <div class="flex flex-col gap-1">
                                            {#each entry.part.calls as call (call.id)}
                                                <ToolCallPart
                                                    id={call.id}
                                                    name={call.name}
                                                    status={call.status}
                                                />
                                            {/each}
                                        </div>
                                    {:else if entry.part.type === 'text'}
                                        <TextPart
                                            text={entry.index === lastTextIdx &&
                                            translatedContent &&
                                            showTranslation
                                                ? translatedContent
                                                : entry.part.text}
                                            {renderContext}
                                            {isUser}
                                        />
                                    {:else if entry.part.type === 'inlay'}
                                        <InlayPart ids={entry.part.ids} chatId={message.chatId} />
                                    {/if}
                                </div>
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>

            {#if imageAttachments.length > 0}
                <InlayPart
                    ids={imageAttachments}
                    chatId={message.chatId}
                    variant="attachment"
                    align={isUser ? 'end' : 'start'}
                />
            {/if}
            {#if audioAttachments.length > 0}
                <InlayPart
                    ids={audioAttachments}
                    chatId={message.chatId}
                    variant="attachment"
                    align={isUser ? 'end' : 'start'}
                />
            {/if}

            {#if matchingTranslationTask?.status === 'error'}
                <TaskErrorNotice
                    title="Translation failed"
                    message={matchingTranslationTask.errorMessage ?? 'Unknown error'}
                    onDismiss={() => dismissTranslation(message.id)}
                />
            {/if}

            {#if imageGenerationTask?.status === 'error'}
                <TaskErrorNotice
                    title="Image generation failed"
                    message={imageGenerationTask.errorMessage ?? 'Unknown error'}
                    onDismiss={() => dismissImageGeneration(message.id)}
                />
            {/if}

            {#if ttsTask?.status === 'error'}
                <TaskErrorNotice
                    title="Text to speech failed"
                    message={ttsTask.errorMessage ?? 'Unknown error'}
                    onDismiss={() => dismissTTS(message.id)}
                />
            {/if}

            <!-- Wide containers: hover/focus. Narrow containers and touch: always visible. -->
            <div
                class="chat-message-actions touch-action-row flex max-w-full flex-row flex-nowrap items-center gap-0.5 transition-opacity {message.displayStatus !==
                'completed'
                    ? 'pointer-events-none invisible select-none'
                    : ''}"
            >
                <!-- Swipe Navigator (Character only, multiple swipes) -->
                {#if !isUser && sortedSwipes.length > 1}
                    <div class="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
                        <button
                            class="relative flex size-6 items-center justify-center rounded hover:bg-muted after:absolute after:-inset-1 after:content-[''] disabled:opacity-30"
                            disabled={actionsDisabled || swipePos <= 0}
                            aria-busy={busyAction === 'swipe'}
                            aria-label="Previous swipe"
                            onclick={() => void handleSwipe(sortedSwipes[swipePos - 1].id)}
                        >
                            <ChevronLeft class="size-3.5" />
                        </button>
                        <span class="tabular-nums font-medium"
                            >{swipePos + 1} / {sortedSwipes.length}</span
                        >
                        <button
                            class="relative flex size-6 items-center justify-center rounded hover:bg-muted after:absolute after:-inset-1 after:content-[''] disabled:opacity-30"
                            disabled={actionsDisabled || swipePos >= sortedSwipes.length - 1}
                            aria-busy={busyAction === 'swipe'}
                            aria-label="Next swipe"
                            onclick={() => void handleSwipe(sortedSwipes[swipePos + 1].id)}
                        >
                            <ChevronRight class="size-3.5" />
                        </button>
                    </div>
                {/if}

                <!-- Copy -->
                <Button
                    variant="ghost"
                    size="sm"
                    class="relative size-8 px-0 text-xs text-muted-foreground after:absolute after:-inset-1 after:content-['']"
                    onclick={handleCopy}
                    aria-label={copied ? 'Copied message' : 'Copy message'}
                >
                    {#if copied}
                        <Check class="size-3.5" />
                    {:else}
                        <Copy class="size-3.5" />
                    {/if}
                </Button>

                {#if matchingTranslationTask?.status === 'generating'}
                    <Button
                        variant="ghost"
                        size="sm"
                        class="relative size-8 px-0 text-xs text-muted-foreground after:absolute after:-inset-1 after:content-['']"
                        onclick={() => stopTranslation(message.id)}
                        title="Stop translation"
                        aria-label="Stop translation"
                    >
                        <Loader2 class="size-3.5 animate-spin" />
                    </Button>
                {:else}
                    <Button
                        variant="ghost"
                        size="sm"
                        class="relative size-8 px-0 text-xs after:absolute after:-inset-1 after:content-[''] {showTranslation &&
                        cachedTranslation
                            ? 'bg-primary/15 text-primary hover:bg-primary/25'
                            : 'text-muted-foreground'}"
                        onclick={() => {
                            if (cachedTranslation) {
                                showTranslation = !showTranslation;
                            } else {
                                handleTranslate();
                            }
                        }}
                        title={cachedTranslation
                            ? showTranslation
                                ? 'Show original'
                                : 'Show translation'
                            : 'Translate'}
                        aria-label={cachedTranslation
                            ? showTranslation
                                ? 'Show original message'
                                : 'Show translated message'
                            : 'Translate message'}
                    >
                        <Languages class="size-3.5" />
                    </Button>
                {/if}

                {#if !isUser && isLastMessage}
                    <Button
                        variant="ghost"
                        size="sm"
                        class="relative size-8 px-0 text-muted-foreground after:absolute after:-inset-1 after:content-['']"
                        disabled={actionsDisabled}
                        onclick={() => void handleRegenerate()}
                        aria-label="Regenerate response"
                    >
                        <RefreshCw class="size-3.5" />
                    </Button>
                {/if}

                <Button
                    variant="ghost"
                    size="sm"
                    class="relative size-8 px-0 text-muted-foreground after:absolute after:-inset-1 after:content-['']"
                    disabled={actionsDisabled}
                    onclick={startEdit}
                    aria-label="Edit message"
                >
                    <Pencil class="size-3.5" />
                </Button>

                <MessageMoreMenu
                    {message}
                    {busyAction}
                    onEditTranslation={startTranslationEdit}
                    onFork={() => void handleFork()}
                    onDelete={() => void handleDelete()}
                />
            </div>
        {/if}
    </div>
</div>

<style>
    @container chat-messages (min-width: 32rem) {
        .chat-message {
            display: flex;
            align-items: flex-start;
            gap: 0.75rem;
        }

        .chat-message.is-user {
            flex-direction: row-reverse;
        }

        .chat-message-mobile-name {
            display: none;
        }

        .chat-message-content {
            margin: 0;
            max-width: 75%;
        }

        .chat-message-desktop-name {
            display: block;
        }

        .chat-message-actions {
            gap: 0.25rem;
            opacity: 0;
        }

        .chat-message:hover .chat-message-actions,
        .chat-message:focus-within .chat-message-actions {
            opacity: 1;
        }
    }

    .trace-flat-list {
        display: flex;
        flex-direction: column;
        gap: 0.9rem;
    }

    .trace-summary-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.7rem;
        min-height: 1.75rem;
        cursor: pointer;
        user-select: none;
        font-size: 0.75rem;
        color: var(--muted-foreground);
        opacity: 0.78;
        background: transparent;
        border: none;
        padding: 0;
        text-align: left;
        position: relative;
        z-index: 10;
    }
    .trace-summary-btn:hover {
        opacity: 1;
    }

    .trace-root-dot {
        display: block;
        width: 1.25rem;
        height: 1.25rem;
        border-radius: 9999px;
        border: 2px solid var(--border);
        background: var(--background);
        box-shadow: inset 0 0 0 4px var(--muted);
        flex: none;
        margin-left: 0.25rem;
        position: relative;
        z-index: 2;
    }

    .trace-flat-item.is-trace {
        position: relative;
        padding-left: 2.35rem;
        min-height: 1.25rem;
    }

    .trace-flat-item.is-trace::before {
        content: '';
        position: absolute;
        left: calc(0.875rem - 1px);
        top: 0;
        bottom: -0.9rem;
        width: 2px;
        background: var(--border);
    }

    .trace-flat-item.is-trace.is-first-trace::before {
        top: -1.2rem;
    }

    .trace-flat-item.is-trace.is-last-trace::before {
        bottom: calc(100% - 0.95rem);
    }

    .trace-dot {
        display: block;
        position: absolute;
        left: 0.535rem;
        top: 0.45rem;
        width: 0.68rem;
        height: 0.68rem;
        border-radius: 9999px;
        border: 2px solid var(--border);
        background: var(--background);
        z-index: 1;
    }
</style>
