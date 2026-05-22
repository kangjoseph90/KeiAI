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
        Brain,
        ChevronDown,
        ChevronUp,
        ChevronLeft,
        ChevronRight,
        GitBranch,
        Copy,
        RefreshCw
    } from 'lucide-svelte';
    import { onDestroy, onMount } from 'svelte';
    import ToolCallGroup from './ToolCallGroup.svelte';
    import AssetView from './AssetView.svelte';
    import type { ToolCall } from '$lib/services/content/tool';
    import { runPipeline } from '$lib/pipeline';
    import { runTemplate, createDryRunMacros } from '$lib/template';
    import type { TemplateContext } from '$lib/template';
    import { parseMarkdownAsync } from '$lib/markdown';
    import morphdom from 'morphdom';
    import type { Action } from 'svelte/action';
    import { hydrateAssets } from '$lib/components/hydrate';
    import { SvelteMap } from 'svelte/reactivity';
    import {
        appSettings,
        chatAssetsMap,
        getActiveModulesForCharacter,
        roomCharacters,
        chatPersonas,
        modules
    } from '$lib/stores';
    import { createDisplayMacros, type RawAssetUrlCache } from '$lib/template/display';
    import {
        scopeCss,
        stripStyleTags,
        protectHtmlStyles,
        restoreHtmlStyles,
        sanitizeWithStyle
    } from '$lib/utils/style';
    import { AssetService } from '$lib/services/asset';

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

    let thoughtExpanded = $state(false);
    let copied = $state(false);
    let messageEl: HTMLDivElement | undefined = $state();
    let isRenderVisible = $state(false);

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
    let renderDirty = true;
    let visibilityObserver: IntersectionObserver | null = null;

    const rawAssetUrlCache: RawAssetUrlCache = new SvelteMap();

    // ── Derived ───────────────────────────────────────────────────────────────

    let isUser = $derived(message.role === 'user');

    /** The swipe that is currently active for this message. */
    let activeSwipe = $derived(message.swipes[message.activeSwipeId]);

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
    let speakerAvatarId = $derived.by(() => {
        if (isUser) {
            const persona = $chatPersonas.find((p) => p.id === displayPersonaId);
            return persona?.avatarAssetId;
        } else {
            const character = $roomCharacters.find((c) => c.id === displayCharacterId);
            return character?.avatarAssetId;
        }
    });

    // ── Actions ───────────────────────────────────────────────────────────────

    const morphHtml: Action<HTMLElement, string> = (node, html) => {
        const template = document.createElement('template');

        function isSameStableImage(fromEl: Element, toEl: Element): boolean {
            if (!(fromEl instanceof HTMLImageElement) || !(toEl instanceof HTMLImageElement)) {
                return false;
            }

            const assetId = fromEl.dataset.keiaiAssetId;
            if (assetId && toEl.dataset.keiaiAssetId === assetId && fromEl.hasAttribute('src')) {
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

    async function renderMessageCSS(templateCtx: TemplateContext, ownerIds: string[]) {
        const source = messageCssSource();
        if (!source.trim()) {
            messageStyleHtml = '';
            return;
        }

        const displayMacros = createDisplayMacros($chatAssetsMap, ownerIds, rawAssetUrlCache);
        const templated = await runTemplate(source, templateCtx);
        const processed = await runPipeline(message.chatId, 'display', templated, templateCtx);
        const withAssets = await runTemplate(processed, templateCtx, displayMacros);
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

            const templateCtx: TemplateContext = {
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
            const templated = await runTemplate(contentToRender, templateCtx, dryRunMacros);
            const processed = await runPipeline(message.chatId, 'display', templated, templateCtx);
            const rendered = await runTemplate(processed, templateCtx, displayMacros);
            await renderMessageCSS(templateCtx, ownerIds);
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
        const currentContent = activeSwipe?.content ?? '';

        if (!isRenderVisible) {
            renderDirty = true;
            return;
        }
        renderDirty = false;

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
                executeRender(activeSwipe?.content ?? ''); // Use latest content when timeout fires
            }, RENDER_THROTTLE_MS - timeSinceLastRender);
        }
    }

    $effect(() => {
        const current = activeSwipe?.content ?? '';
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
            renderDirty = true;
            refreshDisplay();
        }
    });

    onMount(() => {
        if (!messageEl || typeof IntersectionObserver === 'undefined') {
            isRenderVisible = true;
            refreshDisplay();
            return;
        }

        visibilityObserver = new IntersectionObserver(
            ([entry]) => {
                isRenderVisible = entry?.isIntersecting ?? false;
                if (isRenderVisible && renderDirty) {
                    refreshDisplay();
                }
            },
            { rootMargin: '800px 0px' }
        );
        visibilityObserver.observe(messageEl);
    });

    onDestroy(() => {
        visibilityObserver?.disconnect();
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
<div bind:this={messageEl} class="group flex justify-start gap-3">
    <div
        class="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground overflow-hidden"
    >
        {#if speakerAvatarId}
            <AssetView id={speakerAvatarId} alt={speakerName} class="size-full object-cover" />
        {:else}
            {speakerInitial}
        {/if}
    </div>

    <!-- Content Column -->
    <div class="flex max-w-[75%] flex-col items-start gap-1">
        <span class="text-xs font-medium text-muted-foreground">{speakerName}</span>

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
                class="flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
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
            <!-- Thought Process (Character only) -->
            {#if !isUser && activeSwipe?.thought}
                <div class="mb-1 w-full overflow-hidden rounded-xl border bg-muted/20">
                    <button
                        class="flex w-full items-center justify-between px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:bg-muted/40"
                        onclick={() => (thoughtExpanded = !thoughtExpanded)}
                    >
                        <div class="flex items-center gap-1.5">
                            <Brain class="size-3 text-primary/70" />
                            Thinking Process
                        </div>
                        {#if thoughtExpanded}
                            <ChevronUp class="size-3" />
                        {:else}
                            <ChevronDown class="size-3" />
                        {/if}
                    </button>
                    {#if thoughtExpanded}
                        <div
                            class="px-3 pb-3 pt-1 text-xs italic leading-relaxed text-muted-foreground/80"
                        >
                            {activeSwipe.thought || 'Processing thinking...'}
                        </div>
                    {/if}
                </div>
            {/if}

            <!-- Bubble -->
            <div
                class="relative rounded-2xl px-4 py-2.5 text-sm {isUser
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground'}"
            >
                {#if message.displayStatus === 'generating' && !displayContent}
                    <span class="flex items-center gap-1.5 text-muted-foreground">
                        <Loader2 class="size-3 animate-spin" /> Thinking...
                    </span>
                {:else if renderedHtml || isRenderVisible}
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
                {:else}
                    <div class="min-h-5"></div>
                {/if}
            </div>

            <!-- Tool Calls (Character only) -->
            {#if !isUser && activeSwipe?.toolCalls && Object.keys(activeSwipe.toolCalls).length > 0 && message.displayStatus !== 'generating'}
                <ToolCallGroup
                    toolCalls={activeSwipe.toolCalls}
                    {onLoadDetail}
                    onApprove={(id) => onResolveTool(id, 'approve')}
                    onReject={(id) => onResolveTool(id, 'reject')}
                />
            {/if}

            <!-- Single Action Row (hover) -->
            {#if message.displayStatus === 'completed'}
                <div
                    class="mt-0.5 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100 {isUser
                        ? 'flex-row-reverse'
                        : 'flex-row'}"
                >
                    <!-- Swipe Navigator (Character only, multiple swipes) -->
                    {#if !isUser && sortedSwipes.length > 1}
                        <div class="flex items-center gap-0.5 text-xs text-muted-foreground mr-1">
                            <button
                                class="rounded p-0.5 hover:bg-muted disabled:opacity-30"
                                disabled={swipePos <= 0}
                                onclick={() => onSwipe(sortedSwipes[swipePos - 1].id)}
                            >
                                <ChevronLeft class="size-3.5" />
                            </button>
                            <span class="tabular-nums font-medium"
                                >{swipePos + 1} / {sortedSwipes.length}</span
                            >
                            <button
                                class="rounded p-0.5 hover:bg-muted disabled:opacity-30"
                                disabled={swipePos >= sortedSwipes.length - 1}
                                onclick={() => onSwipe(sortedSwipes[swipePos + 1].id)}
                            >
                                <ChevronRight class="size-3.5" />
                            </button>
                        </div>
                    {/if}

                    <!-- Copy -->
                    <Button
                        variant="ghost"
                        size="sm"
                        class="h-6 gap-1 px-1.5 text-xs text-muted-foreground"
                        onclick={handleCopy}
                    >
                        {#if copied}
                            <Check class="size-3" />
                        {:else}
                            <Copy class="size-3" />
                        {/if}
                    </Button>

                    {#if !isUser}
                        <!-- Regenerate: last char message only -->
                        {#if isLastMessage}
                            <Button
                                variant="ghost"
                                size="sm"
                                class="h-6 gap-1 px-1.5 text-xs text-muted-foreground"
                                onclick={onRegenerate}
                            >
                                <RefreshCw class="size-3" />
                            </Button>
                        {/if}

                        <!-- Fork: always available for char messages -->
                        <Button
                            variant="ghost"
                            size="sm"
                            class="h-6 gap-1 px-1.5 text-xs text-muted-foreground"
                            onclick={onFork}
                        >
                            <GitBranch class="size-3" />
                        </Button>
                    {/if}

                    <!-- Edit (User only) -->
                    {#if isUser}
                        <Button
                            variant="ghost"
                            size="sm"
                            class="h-6 gap-1 px-1.5 text-xs text-muted-foreground"
                            onclick={onEdit}
                        >
                            <Pencil class="size-3" />
                        </Button>
                    {/if}

                    <!-- Delete -->
                    <Button
                        variant="ghost"
                        size="sm"
                        class="h-6 gap-1 px-1.5 text-xs text-muted-foreground hover:text-destructive"
                        onclick={onDelete}
                    >
                        <Trash2 class="size-3" />
                    </Button>
                </div>
            {/if}
        {/if}
    </div>
</div>
