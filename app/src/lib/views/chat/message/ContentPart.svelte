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
    import { protectHtmlStyles, restoreHtmlStyles, sanitizeWithStyle } from '$lib/utils/style';
    import { hydrateAssets } from '$lib/components/hydrate';
    import { SvelteMap } from 'svelte/reactivity';
    import { AssetService } from '$lib/services/asset';
    import type { RuntimeContext } from '$lib/types/context';

    export interface ContentPartRenderContext {
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
        renderContext: ContentPartRenderContext;
        isUser: boolean;
    } = $props();

    let renderedHtml = $state('');
    let lastSignature = '';
    let renderVersion = 0;
    let lastRenderTime = 0;
    let renderTimeout: ReturnType<typeof setTimeout> | null = null;

    const RENDER_THROTTLE_MS = 150;

    const rawAssetUrlCache: RawAssetUrlCache = new SvelteMap();

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

    function signature(ctx: RuntimeContext, cssSource: string, displayStatus: string): string {
        return [
            text,
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

    async function render() {
        const sig = signature(
            renderContext.ctx,
            renderContext.cssSource,
            renderContext.displayStatus
        );
        if (sig === lastSignature) return;
        lastSignature = sig;
        const version = ++renderVersion;
        lastRenderTime = Date.now();

        const { ctx, chatId, ownerIds, chatAssetsMap } = renderContext;
        const dryRunMacros = createDryRunMacros();
        const displayMacros = createDisplayMacros(chatAssetsMap, ownerIds, rawAssetUrlCache);
        const templated = await runTemplate(text, ctx, dryRunMacros);
        const processed = await runPipeline(chatId, 'display', templated, ctx);
        const rendered = await runTemplate(processed, ctx, displayMacros);
        const protectedHtml = protectHtmlStyles(rendered);
        const rawHtml = await parseMarkdownAsync(protectedHtml.text);
        const restoredHtml = restoreHtmlStyles(rawHtml as string, protectedHtml.styles);
        if (version !== renderVersion) return;
        renderedHtml = sanitizeWithStyle(restoredHtml);
    }

    function scheduleRender() {
        if (renderContext.displayStatus !== 'generating') {
            if (renderTimeout) {
                clearTimeout(renderTimeout);
                renderTimeout = null;
            }
            void render();
            return;
        }

        const elapsed = Date.now() - lastRenderTime;
        if (elapsed >= RENDER_THROTTLE_MS) {
            if (renderTimeout) {
                clearTimeout(renderTimeout);
                renderTimeout = null;
            }
            void render();
            return;
        }

        if (!renderTimeout) {
            renderTimeout = setTimeout(() => {
                renderTimeout = null;
                void render();
            }, RENDER_THROTTLE_MS - elapsed);
        }
    }

    $effect(() => {
        scheduleRender();
    });

    onDestroy(() => {
        renderVersion++;
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

{#if renderedHtml}
    <div
        data-keiai-message-scope={renderContext.messageScope}
        use:morphHtml={renderedHtml}
        use:hydrateAssets={renderedHtml}
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
