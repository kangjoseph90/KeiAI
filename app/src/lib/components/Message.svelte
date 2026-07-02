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
    import { onDestroy, onMount } from 'svelte';
    import AssetView from './AssetView.svelte';
    import type { AssetReadLocator } from '$lib/services/asset';
    import type { ToolCall } from '$lib/services/content/tool';
    import { runPipeline } from '$lib/pipeline';
    import { runTemplate, createDryRunMacros } from '$lib/template';
    import { parseMarkdownAsync } from '$lib/markdown';
    import morphdom from 'morphdom';
    import type { Action } from 'svelte/action';
    import { hydrateAssets } from '$lib/components/hydrate';
    import { SvelteMap } from 'svelte/reactivity';
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
    import { createDisplayMacros, type RawAssetUrlCache } from '$lib/template/display';
    import {
        scopeCss,
        stripStyleTags,
        protectHtmlStyles,
        restoreHtmlStyles,
        sanitizeWithStyle
    } from '$lib/utils/style';
    import { AssetService } from '$lib/services/asset';
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
        onResolveTool = () => {},
        onLoadDetail = async (_id: string) => null,
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
        onResolveTool?: (id: string, decision: 'approve' | 'reject') => void;
        onLoadDetail?: (id: string) => Promise<ToolCall | null>;
        onRegenerate?: () => void;
        onSwipe?: (id: string) => void;
        onFork?: () => void;
        onCopy?: () => void;
    } = $props();

    // ── State ─────────────────────────────────────────────────────────────────

    let copied = $state(false);
    let translationSourceHash = $state('');
    let translationActionError = $state('');

    // Render pipeline internals
    let displayContent = $state('');
    let lastContent = '';
    let renderedHtml = $state('');
    let messageStyleHtml = $state('');
    let lastStatus: string | undefined;
    let lastDisplayCharacterId: string | undefined;
    let lastDisplayPersonaId: string | undefined;
    let lastMessageIndex: number | undefined;
    let lastMessageScope: string | undefined;
    let lastMessageCssSource = '';

    const rawAssetUrlCache: RawAssetUrlCache = new SvelteMap();

    // ── Derived ───────────────────────────────────────────────────────────────

    let isUser = $derived(message.role === 'user');

    /** The swipe that is currently active for this message. */
    let activeSwipe = $derived(message.swipes[message.activeSwipeId]);
    let currentContent = $derived(activeSwipe?.content ?? '');
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

    const morphHtml: Action<HTMLElement, string> = (node, html) => {
        const template = document.createElement('template');

        function isSameStableImage(fromEl: Element, toEl: Element): boolean {
            if (!(fromEl instanceof HTMLImageElement) || !(toEl instanceof HTMLImageElement)) {
                return false;
            }

            const assetVal = fromEl.dataset.keiaiAsset;
            if (assetVal && toEl.dataset.keiaiAsset === assetVal && fromEl.hasAttribute('src')) {
                return true;
            }

            const nextSrc = toEl.getAttribute('src');
            return !!nextSrc && fromEl.src === toEl.src;
        }

        const update = (newHtml: string) => {
            if (!newHtml) {
                node.innerHTML = '';
                return;
            }

            template.innerHTML = `<div>${newHtml}</div>`;
            const target = template.content.firstElementChild;
            if (!target) {
                node.innerHTML = '';
                return;
            }

            morphdom(node, target, {
                childrenOnly: true,
                onBeforeElUpdated: (fromEl, toEl) => {
                    if (isSameStableImage(fromEl, toEl)) return false;
                    if (fromEl.isEqualNode(toEl)) return false;
                    return true;
                }
            });
        };

        update(html);

        return { update };
    };

    // ── Copy ──────────────────────────────────────────────────────────────────

    async function handleCopy() {
        await navigator.clipboard.writeText(activeSwipe?.content ?? '');
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

    // ── Markdown ──────────────────────────────────────────────────────────────

    let pendingRefresh = false;
    let missedUpdate = false;
    let lastRenderTime = 0;
    let renderTimeout: ReturnType<typeof setTimeout> | null = null;
    const RENDER_THROTTLE_MS = 150;

    function messageCssSource(): string {
        const ownerId = message.role === 'assistant' ? displayCharacterId : characterId;
        const character = ownerId ? $roomCharacters.find((item) => item.id === ownerId) : undefined;
        const activeModules = getActiveModulesForCharacter(character, $appSettings, $modules);
        return [character?.messageCSS ?? '', ...activeModules.map((module) => module.messageCSS)]
            .filter((part) => part.trim())
            .join('\n');
    }

    async function renderMessageCSS(ctx: RuntimeContext, ownerIds: string[]) {
        const source = messageCssSource();
        if (!source.trim()) {
            messageStyleHtml = '';
            return;
        }

        const displayMacros = createDisplayMacros($chatAssetsMap, ownerIds, rawAssetUrlCache);
        const templated = await runTemplate(source, ctx);
        const processed = await runPipeline(message.chatId, 'display', templated, ctx);
        const withAssets = await runTemplate(processed, ctx, displayMacros);
        const scopeSelector = `[data-keiai-message-scope="${messageScope.replace(/"/g, '\\"')}"]`;
        const css = scopeCss(stripStyleTags(withAssets), scopeSelector);
        messageStyleHtml = `<style>${css}</style>`;
    }

    async function executeRender(contentToRender: string) {
        if (pendingRefresh) {
            missedUpdate = true;
            return;
        }
        pendingRefresh = true;

        try {
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

            // Do not render display macros before display pipeline
            const dryRunMacros = createDryRunMacros();
            const displayMacros = createDisplayMacros($chatAssetsMap, ownerIds, rawAssetUrlCache);
            const templated = await runTemplate(contentToRender, ctx, dryRunMacros);
            const processed = await runPipeline(message.chatId, 'display', templated, ctx);
            const rendered = await runTemplate(processed, ctx, displayMacros);
            await renderMessageCSS(ctx, ownerIds);
            const protectedHtml = protectHtmlStyles(rendered);
            const rawHtml = await parseMarkdownAsync(protectedHtml.text);
            const restoredHtml = restoreHtmlStyles(rawHtml as string, protectedHtml.styles);
            const sanitized = sanitizeWithStyle(restoredHtml);

            // Update states atomically
            displayContent = rendered;
            renderedHtml = sanitized;
        } finally {
            pendingRefresh = false;
            lastRenderTime = Date.now();
            if (missedUpdate) {
                missedUpdate = false;
                refreshDisplay(); // Retry with the latest message.content
            }
        }
    }

    function refreshDisplay() {
        // If completely done or error, render immediately without throttling
        if (message.displayStatus !== 'generating') {
            if (renderTimeout) {
                clearTimeout(renderTimeout);
                renderTimeout = null;
            }
            executeRender(currentContent);
            return;
        }

        // Throttling logic for generating state
        const now = Date.now();
        const timeSinceLastRender = now - lastRenderTime;

        if (timeSinceLastRender >= RENDER_THROTTLE_MS) {
            if (renderTimeout) {
                clearTimeout(renderTimeout);
                renderTimeout = null;
            }
            executeRender(currentContent);
        } else if (!renderTimeout) {
            renderTimeout = setTimeout(() => {
                renderTimeout = null;
                executeRender(currentContent); // Use latest content when timeout fires
            }, RENDER_THROTTLE_MS - timeSinceLastRender);
        }
    }

    $effect(() => {
        const current = currentContent;
        const status = message.displayStatus;
        const cssSource = messageCssSource();

        // Ensure refresh on both content updates and status transitions (e.g. generating -> completed)
        if (
            current !== lastContent ||
            status !== lastStatus ||
            displayCharacterId !== lastDisplayCharacterId ||
            displayPersonaId !== lastDisplayPersonaId ||
            message.messageIndex !== lastMessageIndex ||
            messageScope !== lastMessageScope ||
            cssSource !== lastMessageCssSource
        ) {
            // Synchronously clear state when a fresh generation starts to prevent showing old content
            if (status === 'generating' && current === '') {
                displayContent = '';
                renderedHtml = '';
                messageStyleHtml = '';
            }
            lastContent = current;
            lastStatus = status;
            lastDisplayCharacterId = displayCharacterId;
            lastDisplayPersonaId = displayPersonaId;
            lastMessageIndex = message.messageIndex;
            lastMessageScope = messageScope;
            lastMessageCssSource = cssSource;
            refreshDisplay();
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

    onMount(() => {
        refreshDisplay();
    });

    onDestroy(() => {
        if (renderTimeout) {
            clearTimeout(renderTimeout);
            renderTimeout = null;
        }
        for (const url of rawAssetUrlCache.values()) {
            if (url) void AssetService.revokeUrl(url);
        }
        rawAssetUrlCache.clear();
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
                class="relative rounded-lg px-4 py-2.5 text-sm {isUser
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground'}"
            >
                {#if message.displayStatus === 'generating' && !currentContent}
                    <span class="flex items-center gap-1.5 text-muted-foreground">
                        <Loader2 class="size-3 animate-spin" /> Thinking...
                    </span>
                {:else if renderedHtml}
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -- CSS is scoped by data-keiai-message-scope -->
                    {@html messageStyleHtml}
                    <div
                        data-keiai-message-scope={messageScope}
                        use:morphHtml={renderedHtml}
                        use:hydrateAssets={renderedHtml}
                        class="prose prose-sm max-w-none {isUser
                            ? '**:text-primary-foreground prose-invert'
                            : 'dark:prose-invert'}"
                    ></div>
                {:else if currentContent}
                    <div
                        class="prose prose-sm max-w-none whitespace-pre-wrap {isUser
                            ? '**:text-primary-foreground prose-invert'
                            : 'dark:prose-invert'}"
                    >
                        {currentContent}
                    </div>
                {:else}
                    <div class="min-h-5"></div>
                {/if}
            </div>

            {#if matchingTranslationTask?.status === 'generating' || translatedContent}
                <div
                    class="w-full rounded-xl border border-border/70 bg-background/70 px-4 py-2.5 text-sm text-foreground"
                >
                    {#if matchingTranslationTask?.status === 'generating' && !translatedContent}
                        <span class="flex items-center gap-1.5 text-muted-foreground">
                            <Loader2 class="size-3 animate-spin" /> Translating...
                        </span>
                    {:else}
                        <div class="whitespace-pre-wrap">{translatedContent}</div>
                    {/if}
                </div>
            {/if}

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
                            class="h-8 md:h-6 gap-1 px-2.5 md:px-1.5 text-xs text-muted-foreground"
                            onclick={handleTranslate}
                            title={cachedTranslation ? 'Retranslate' : 'Translate'}
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

                    <!-- Edit (User only) -->
                    {#if isUser}
                        <Button
                            variant="ghost"
                            size="sm"
                            class="h-8 md:h-6 gap-1 px-2.5 md:px-1.5 text-xs text-muted-foreground"
                            onclick={onEdit}
                        >
                            <Pencil class="size-3.5 md:size-3" />
                        </Button>
                    {/if}

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
