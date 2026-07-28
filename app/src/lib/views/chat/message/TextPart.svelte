<script lang="ts">
    import { onDestroy } from 'svelte';
    import type { Action } from 'svelte/action';
    import morphdom from 'morphdom';
    import { runPipeline } from '$lib/pipeline';
    import { runTemplate, createDryRunMacros } from '$lib/template';
    import {
        createDisplayMacros,
        type AssetNameIndex,
        type RawAssetUrlCache
    } from '$lib/template/display';
    import { parseMarkdownAsync } from '$lib/markdown';
    import {
        protectHtmlStyles,
        restoreHtmlStyles,
        sanitizeWithStyle,
        scopeStyleBlocks
    } from '$lib/utils/style';
    import { hydrateAssets } from '$lib/components/hydrate';
    import { SvelteMap } from 'svelte/reactivity';
    import type { RuntimeContext } from '$lib/types/context';
    import { eventButtons, externalLinks } from '$lib/ui';

    export interface TextPartRenderContext {
        ctx: RuntimeContext;
        chatId: string;
        messageScope: string;
        ownerIds: string[];
        chatAssetsMap: AssetNameIndex;
        cssSource: string;
        displayStatus: string;
    }

    let {
        text,
        renderContext,
        isUser
    }: {
        text: string;
        renderContext: TextPartRenderContext;
        isUser: boolean;
    } = $props();

    let renderedHtml = $state('');
    let lastRequestedSignature = '';
    let lastRenderTime = 0;
    let renderTimeout: ReturnType<typeof setTimeout> | null = null;
    let pendingRequest: RenderRequest | null = null;
    let renderInFlight = false;
    let destroyed = false;

    const RENDER_THROTTLE_MS = 150;

    const rawAssetUrlCache: RawAssetUrlCache = new SvelteMap();

    interface RenderRequest {
        text: string;
        context: TextPartRenderContext;
    }

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

    function signature(
        content: string,
        ctx: RuntimeContext,
        cssSource: string,
        displayStatus: string
    ): string {
        return [
            content,
            displayStatus,
            ctx.roomId ?? '',
            ctx.presetId ?? '',
            ctx.characterId ?? '',
            ctx.personaId ?? '',
            ctx.chatId ?? '',
            ctx.messageId ?? '',
            ctx.messageIndex ?? '',
            ctx.speakerId ?? '',
            ctx.speakerName ?? '',
            ctx.role ?? '',
            cssSource
        ].join('\u0000');
    }

    async function render(request: RenderRequest): Promise<string> {
        const { ctx, messageScope, ownerIds, chatAssetsMap } = request.context;
        const dryRunMacros = createDryRunMacros();
        const displayMacros = createDisplayMacros(chatAssetsMap, ownerIds, rawAssetUrlCache);
        const templated = await runTemplate(request.text, ctx, dryRunMacros);
        const processed = await runPipeline('display', ctx, templated);
        const rendered = await runTemplate(processed, ctx, displayMacros);
        const scopeSelector = `[data-keiai-message-scope="${messageScope.replace(/"/g, '\\"')}"]`;
        const scopedHtml = scopeStyleBlocks(rendered, scopeSelector);
        const protectedHtml = protectHtmlStyles(scopedHtml);
        const rawHtml = await parseMarkdownAsync(protectedHtml.text);
        const restoredHtml = restoreHtmlStyles(rawHtml as string, protectedHtml.styles);
        return sanitizeWithStyle(restoredHtml);
    }

    function requestRender() {
        const context = renderContext;
        const nextSignature = signature(
            text,
            context.ctx,
            context.cssSource,
            context.displayStatus
        );
        if (nextSignature === lastRequestedSignature) return;

        lastRequestedSignature = nextSignature;
        pendingRequest = {
            text,
            context
        };
        schedulePendingRender();
    }

    function schedulePendingRender() {
        if (destroyed || renderInFlight || !pendingRequest) return;

        if (pendingRequest.context.displayStatus !== 'generating') {
            clearRenderTimeout();
            void runPendingRender();
            return;
        }

        const elapsed = Date.now() - lastRenderTime;
        if (elapsed >= RENDER_THROTTLE_MS) {
            clearRenderTimeout();
            void runPendingRender();
            return;
        }

        if (!renderTimeout) {
            renderTimeout = setTimeout(() => {
                renderTimeout = null;
                void runPendingRender();
            }, RENDER_THROTTLE_MS - elapsed);
        }
    }

    async function runPendingRender() {
        if (destroyed || renderInFlight || !pendingRequest) return;

        clearRenderTimeout();
        const request = pendingRequest;
        pendingRequest = null;
        renderInFlight = true;
        lastRenderTime = Date.now();

        try {
            const html = await render(request);
            if (!destroyed) renderedHtml = html;
        } finally {
            renderInFlight = false;
            schedulePendingRender();
        }
    }

    function clearRenderTimeout() {
        if (!renderTimeout) return;
        clearTimeout(renderTimeout);
        renderTimeout = null;
    }

    $effect(() => {
        requestRender();
    });

    onDestroy(() => {
        destroyed = true;
        pendingRequest = null;
        clearRenderTimeout();
        for (const lease of rawAssetUrlCache.values()) {
            if (lease) void lease.release();
        }
        rawAssetUrlCache.clear();
    });
</script>

{#if renderedHtml}
    <div
        data-keiai-message-scope={renderContext.messageScope}
        use:morphHtml={renderedHtml}
        use:hydrateAssets={renderedHtml}
        use:externalLinks={renderedHtml}
        use:eventButtons={renderContext.ctx}
        class="prose prose-sm max-w-none {isUser
            ? '**:text-primary-foreground prose-invert'
            : 'dark:prose-invert'} leading-relaxed"
    ></div>
{:else}
    <div
        class="prose prose-sm max-w-none whitespace-pre-wrap {isUser
            ? '**:text-primary-foreground prose-invert'
            : 'dark:prose-invert'} leading-relaxed"
    >
        <p>{text}</p>
    </div>
{/if}
