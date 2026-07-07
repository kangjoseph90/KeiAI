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
        AlertCircle,
        Check,
        Loader2,
        Pencil,
        Trash2,
        X,
        ChevronLeft,
        ChevronRight,
        GitBranch,
        Copy,
        RefreshCw,
        Languages
    } from 'lucide-svelte';
    import { onDestroy } from 'svelte';
    import AssetView from '$lib/components/AssetView.svelte';
    import { AssetService, type AssetReadLocator } from '$lib/services/asset';
    import { runPipeline } from '$lib/pipeline';
    import { runTemplate } from '$lib/template';
    import { createDisplayMacros, type RawAssetUrlCache } from '$lib/template/display';
    import { SvelteMap } from 'svelte/reactivity';
    import { scopeCss, stripStyleTags } from '$lib/utils/style';
    import {
        getLastContentText,
        findLastContentIndex,
        type AgentPart
    } from '$lib/workflow/agent/llm';
    import ContentPart from './ContentPart.svelte';
    import ThoughtPart from './ThoughtPart.svelte';
    import ToolCallPart from './ToolCallPart.svelte';
    import TraceTimeline from './TraceTimeline.svelte';
    import {
        activeRoom,
        appSettings,
        chatAssetsMap,
        getActiveModulesForCharacter,
        roomCharacters,
        chatPersonas,
        modules,
        translationTasks,
        translationsByMessage
    } from '$lib/stores';
    import {
        createTranslationSourceHash,
        dismissTranslation,
        runTranslation,
        stopTranslation
    } from '$lib/tasks';
    import { getErrorMessage } from '$lib/types/errors';
    import type { RuntimeContext } from '$lib/types/context';

    // ── Props ─────────────────────────────────────────────────────────────────

    let {
        message,
        isEditing = false,
        editText = $bindable(''),
        characterName = '',
        characterId,
        personaId,
        isLastMessage = false,
        onEdit = () => {},
        onSave = () => {},
        onCancelEdit = () => {},
        onDelete = () => {},
        onDismissError = () => {},
        onRegenerate = () => {},
        onSwipe = (_id: string) => {},
        onFork = () => {},
        onCopy = () => {}
    }: {
        message: DisplayMessage;
        isEditing?: boolean;
        editText?: string;
        characterName?: string;
        characterId?: string;
        personaId?: string;
        isLastMessage?: boolean;
        onEdit?: () => void;
        onSave?: (text: string) => void;
        onCancelEdit?: () => void;
        onDelete?: () => void;
        onDismissError?: () => void;
        onRegenerate?: () => void;
        onSwipe?: (id: string) => void;
        onFork?: () => void;
        onCopy?: () => void;
    } = $props();

    // ── State ─────────────────────────────────────────────────────────────────

    let copied = $state(false);
    let translationSourceHash = $state('');
    let translationActionError = $state('');
    let showTranslation = $state(false);
    let messageStyleHtml = $state('');
    let messageStyleSignature = '';
    let messageStyleVersion = 0;

    const cssRawAssetUrlCache: RawAssetUrlCache = new SvelteMap();

    // ── Derived ───────────────────────────────────────────────────────────────

    let isUser = $derived(message.role === 'user');

    /** The swipe that is currently active for this message. */
    let activeSwipe = $derived(message.swipes[message.activeSwipeId]);
    let currentContent = $derived(activeSwipe ? getLastContentText(activeSwipe.parts) : '');
    let translationTask = $derived($translationTasks.get(message.id));
    let matchingTranslationTask = $derived(
        translationTask?.sourceHash === translationSourceHash ? translationTask : undefined
    );
    let cachedTranslation = $derived(
        $translationsByMessage
            .get(message.id)
            ?.find((translation) => translation.sourceHash === translationSourceHash) ?? null
    );
    let translatedContent = $derived(cachedTranslation?.text ?? '');
    let visibleContent = $derived(translatedContent || currentContent);
    let translationError = $derived(
        matchingTranslationTask?.status === 'error'
            ? matchingTranslationTask.errorMessage
            : translationActionError
    );

    /** Swipes sorted by creation time for consistent navigation. */
    let sortedSwipes = $derived(
        Object.values(message.swipes).sort((a, b) => a.createdAt - b.createdAt)
    );

    /** The position of the active swipe in the sorted list. */
    let swipePos = $derived(sortedSwipes.findIndex((s) => s.id === message.activeSwipeId));
    let speakerName = $derived(
        activeSwipe?.speakerName ?? (isUser ? 'User' : characterName || 'Assistant')
    );
    let speakerInitial = $derived((speakerName.trim().charAt(0) || '?').toUpperCase());
    let displayCharacterId = $derived(
        message.role === 'assistant' && activeSwipe?.speakerId ? activeSwipe.speakerId : characterId
    );
    let displayPersonaId = $derived(
        message.role === 'user' && activeSwipe?.speakerId ? activeSwipe.speakerId : personaId
    );
    let messageScope = $derived(`kei-${message.id}-${message.activeSwipeId}`);

    // ── Parts timeline ────────────────────────────────────────────────────────

    let parts = $derived<AgentPart[]>(activeSwipe?.parts ?? []);
    let indexedParts = $derived(parts.map((part, index) => ({ part, index })));

    let lastContentIdx = $derived(findLastContentIndex(parts));

    let traceParts = $derived(
        lastContentIdx >= 0 ? indexedParts.slice(0, lastContentIdx) : indexedParts
    );

    let answerParts = $derived(lastContentIdx >= 0 ? indexedParts.slice(lastContentIdx) : []);
    let visibleAnswerParts = $derived(
        message.displayStatus !== 'generating' && translatedContent && showTranslation
            ? [
                  {
                      part: { type: 'content', text: translatedContent } as AgentPart,
                      index: lastContentIdx
                  }
              ]
            : answerParts
    );

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
                      encKey: persona.avatar.encKey
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
                      encKey: character.avatar.encKey
                  }
                : null;
        }
    });

    // ── Actions ───────────────────────────────────────────────────────────────

    async function handleCopy() {
        await navigator.clipboard.writeText(visibleContent);
        copied = true;
        onCopy();
        setTimeout(() => (copied = false), 2000);
    }

    async function handleTranslate() {
        translationActionError = '';
        try {
            await runTranslation(message.id, {
                force: cachedTranslation !== null
            });
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return;
            translationActionError = getErrorMessage(error, 'Translation failed');
        }
    }

    // ── Render context (shared across content parts) ──────────────────────────

    let renderContext = $derived.by(() => {
        const ownerId = message.role === 'assistant' ? displayCharacterId : characterId;
        const character = ownerId ? $roomCharacters.find((item) => item.id === ownerId) : undefined;
        const activeModules = getActiveModulesForCharacter(character, $appSettings, $modules);
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
                ...$modules.map((m) => m.id)
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

        const displayMacros = createDisplayMacros(chatAssetsMap, ownerIds, cssRawAssetUrlCache);
        const templated = await runTemplate(cssSource, ctx);
        const processed = await runPipeline(chatId, 'display', templated, ctx);
        const withAssets = await runTemplate(processed, ctx, displayMacros);
        const scopeSelector = `[data-keiai-message-scope="${messageScope.replace(/"/g, '\\"')}"]`;
        const css = scopeCss(stripStyleTags(withAssets), scopeSelector);

        if (version !== messageStyleVersion) return;
        messageStyleHtml = `<style>${css}</style>`;
    }

    /** Completed trace details state. Streaming renders raw parts without a trace wrapper. */
    let detailsOpen = $state(false);
    let lastDisplayStatus = $state<string | undefined>(undefined);

    $effect(() => {
        const status = message.displayStatus;
        if (status === 'completed' && lastDisplayStatus !== 'completed') {
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
            showTranslation = true;
            hasLoadedTranslation = true;
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
        for (const url of cssRawAssetUrlCache.values()) {
            if (url) void AssetService.revokeUrl(url);
        }
        cssRawAssetUrlCache.clear();
    });
</script>

<!-- Message Container -->
<div
    class="group grid gap-x-2 md:flex md:gap-3 {isUser
        ? 'grid-cols-[minmax(0,1fr)_2rem] md:flex-row-reverse'
        : 'grid-cols-[2rem_minmax(0,1fr)]'}"
    role="group"
    tabindex="-1"
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
            />
        {:else}
            {speakerInitial}
        {/if}
    </div>

    <span
        class="row-start-1 self-center truncate text-xs font-medium text-muted-foreground md:hidden {isUser
            ? 'col-start-1 justify-self-end'
            : 'col-start-2'}">{speakerName}</span
    >

    <!-- Content Column -->
    <div
        class="col-span-2 row-start-2 mx-2 mt-2 flex min-w-0 max-w-none flex-1 flex-col gap-1 md:mx-0 md:mt-0 md:max-w-[75%] md:flex-none {isUser
            ? 'items-end'
            : 'items-start'}"
    >
        <span class="hidden text-xs font-medium text-muted-foreground md:block">{speakerName}</span>

        <!-- Edit Mode -->
        {#if isEditing && message.displayStatus === 'completed'}
            <div class="flex w-full flex-col gap-2">
                <Textarea bind:value={editText} class="min-h-16 w-full" />
                <div class="flex justify-end gap-2">
                    <Button size="sm" class="gap-1.5" onclick={() => onSave(editText)}>
                        <Check class="size-4" /> Save
                    </Button>
                    <Button size="sm" variant="outline" class="gap-1.5" onclick={onCancelEdit}>
                        <X class="size-4" /> Cancel
                    </Button>
                </div>
            </div>

            <!-- Error Bubble -->
        {:else if message.displayStatus === 'error'}
            <div
                class="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
            >
                <AlertCircle class="mt-0.5 size-4 shrink-0" />
                <div class="flex flex-col gap-1">
                    <span class="font-medium">Generation failed</span>
                    <span class="text-xs opacity-80">{message.errorMessage ?? 'Unknown error'}</span
                    >
                    <Button
                        size="sm"
                        variant="outline"
                        class="mt-1 h-6 gap-1 self-start text-xs"
                        onclick={onDismissError}
                    >
                        <X class="size-3" /> Dismiss
                    </Button>
                </div>
            </div>

            <!-- Message Content -->
        {:else}
            <!-- Bubble -->
            <div
                class="relative flex flex-col gap-2 rounded-lg px-4 py-2.5 text-sm {isUser
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground'}"
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

                    {#if message.displayStatus === 'generating'}
                        <!-- TODO: Unify with the completed trace/answer projection so
                             ContentPart instances survive the generating→completed
                             transition. The current separate each blocks force a
                             remount, re-running the display pipeline once per part. -->
                        {#each indexedParts as entry (entry.index)}
                            {#if entry.part.type === 'thought'}
                                <ThoughtPart text={entry.part.text} />
                            {:else if entry.part.type === 'tool_call'}
                                <ToolCallPart name={entry.part.name} status={entry.part.status} />
                            {:else if entry.part.type === 'content'}
                                <ContentPart text={entry.part.text} {renderContext} {isUser} />
                            {/if}
                        {/each}
                    {:else if traceParts.length > 0}
                        <TraceTimeline
                            entries={traceParts}
                            {renderContext}
                            {isUser}
                            bind:open={detailsOpen}
                        />
                    {/if}

                    {#if message.displayStatus !== 'generating'}
                        {#each visibleAnswerParts as entry (entry.index)}
                            {#if entry.part.type === 'thought'}
                                <ThoughtPart text={entry.part.text} />
                            {:else if entry.part.type === 'tool_call'}
                                <ToolCallPart name={entry.part.name} status={entry.part.status} />
                            {:else if entry.part.type === 'content'}
                                <ContentPart text={entry.part.text} {renderContext} {isUser} />
                            {/if}
                        {/each}
                    {/if}
                {/if}
            </div>

            {#if translationError}
                <div class="flex items-center gap-2 text-xs text-destructive">
                    <AlertCircle class="size-3" />
                    <span>{translationError}</span>
                    <button
                        class="rounded p-0.5 hover:bg-destructive/10"
                        aria-label="Dismiss translation error"
                        onclick={() => {
                            translationActionError = '';
                            dismissTranslation(message.id);
                        }}><X class="size-3" /></button
                    >
                </div>
            {/if}

            <!-- Single Action Row (hover) -->
            {#if message.displayStatus === 'completed'}
                <div
                    class="-my-1 hidden items-center gap-2 transition-opacity group-focus-within:flex md:my-0 md:flex md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 {isUser
                        ? 'flex-row-reverse'
                        : 'flex-row'}"
                >
                    <!-- Swipe Navigator (Character only, multiple swipes) -->
                    {#if !isUser && sortedSwipes.length > 1}
                        <div class="flex items-center gap-0.5 text-xs text-muted-foreground mr-1">
                            <button
                                class="rounded flex items-center justify-center h-8 w-8 md:h-6 md:w-6 hover:bg-muted disabled:opacity-30"
                                disabled={swipePos <= 0}
                                onclick={() => onSwipe(sortedSwipes[swipePos - 1].id)}
                            >
                                <ChevronLeft class="size-4 md:size-3.5" />
                            </button>
                            <span class="tabular-nums font-medium"
                                >{swipePos + 1} / {sortedSwipes.length}</span
                            >
                            <button
                                class="rounded flex items-center justify-center h-8 w-8 md:h-6 md:w-6 hover:bg-muted disabled:opacity-30"
                                disabled={swipePos >= sortedSwipes.length - 1}
                                onclick={() => onSwipe(sortedSwipes[swipePos + 1].id)}
                            >
                                <ChevronRight class="size-4 md:size-3.5" />
                            </button>
                        </div>
                    {/if}

                    <!-- Copy -->
                    <Button
                        variant="ghost"
                        size="sm"
                        class="h-8 md:h-6 gap-1 px-2.5 md:px-1.5 text-xs text-muted-foreground"
                        onclick={handleCopy}
                    >
                        {#if copied}
                            <Check class="size-3.5 md:size-3" />
                        {:else}
                            <Copy class="size-3.5 md:size-3" />
                        {/if}
                    </Button>

                    {#if matchingTranslationTask?.status === 'generating'}
                        <Button
                            variant="ghost"
                            size="sm"
                            class="h-8 md:h-6 gap-1 px-2.5 md:px-1.5 text-xs text-muted-foreground"
                            onclick={() => stopTranslation(message.id)}
                            title="Stop translation"
                        >
                            <Loader2 class="size-3.5 md:size-3 animate-spin" />
                        </Button>
                    {:else}
                        <Button
                            variant="ghost"
                            size="sm"
                            class="h-8 md:h-6 gap-1 px-2.5 md:px-1.5 text-xs {showTranslation &&
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
                            ondblclick={(e) => {
                                e.stopPropagation();
                                handleTranslate();
                            }}
                            title={cachedTranslation
                                ? showTranslation
                                    ? 'Show original (double click to retranslate)'
                                    : 'Show translation'
                                : 'Translate'}
                        >
                            <Languages class="size-3.5 md:size-3" />
                        </Button>
                    {/if}

                    {#if !isUser}
                        <!-- Regenerate: last char message only -->
                        {#if isLastMessage}
                            <Button
                                variant="ghost"
                                size="sm"
                                class="h-8 md:h-6 gap-1 px-2.5 md:px-1.5 text-xs text-muted-foreground"
                                onclick={onRegenerate}
                            >
                                <RefreshCw class="size-3.5 md:size-3" />
                            </Button>
                        {/if}

                        <!-- Fork: always available for char messages -->
                        <Button
                            variant="ghost"
                            size="sm"
                            class="h-8 md:h-6 gap-1 px-2.5 md:px-1.5 text-xs text-muted-foreground"
                            onclick={onFork}
                        >
                            <GitBranch class="size-3.5 md:size-3" />
                        </Button>
                    {/if}

                    <!-- Edit -->
                    <Button
                        variant="ghost"
                        size="sm"
                        class="h-8 md:h-6 gap-1 px-2.5 md:px-1.5 text-xs text-muted-foreground"
                        onclick={onEdit}
                    >
                        <Pencil class="size-3.5 md:size-3" />
                    </Button>

                    <!-- Delete -->
                    <Button
                        variant="ghost"
                        size="sm"
                        class="h-8 md:h-6 gap-1 px-2.5 md:px-1.5 text-xs text-muted-foreground hover:text-destructive"
                        onclick={onDelete}
                    >
                        <Trash2 class="size-3.5 md:size-3" />
                    </Button>
                </div>
            {/if}
        {/if}
    </div>
</div>
