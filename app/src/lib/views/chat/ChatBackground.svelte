<script lang="ts">
    import { onDestroy } from 'svelte';
    import { SvelteMap } from 'svelte/reactivity';
    import {
        activeRoom,
        appSettings,
        chatAssetsMap,
        getActiveModulesForCharacter,
        modules,
        roomCharacters
    } from '$lib/stores';
    import type { Character, Module } from '$lib/services';
    import { runPipeline } from '$lib/pipeline';
    import { createDryRunMacros, runTemplate } from '$lib/template';
    import { createBackgroundMacros, type RawAssetUrlCache } from '$lib/template/display';
    import {
        scopeStyleBlocks,
        protectHtmlStyles,
        restoreHtmlStyles,
        sanitizeWithStyle
    } from '$lib/utils/style';
    import { parseMarkdownAsync } from '$lib/markdown';
    import { hydrateAssets } from '$lib/components/hydrate';
    import { AssetService } from '$lib/services/asset';
    import type { RuntimeContext } from '$lib/types/context';

    let {
        chatId,
        defaultCharacter
    }: {
        chatId: string;
        defaultCharacter: Character | null;
    } = $props();

    let renderedHtml = $state('');
    let version = 0;
    const rawAssetUrlCache: RawAssetUrlCache = new SvelteMap();
    let backgroundScope = $derived(`kei-bg-${chatId}`);

    async function renderBackground(html: string, character: Character | null, mods: Module[]) {
        const run = ++version;
        if (!html.trim()) {
            renderedHtml = '';
            return;
        }

        const ownerIds = Array.from(
            new Set([
                character?.id,
                ...mods.map((module) => module.id),
                ...$roomCharacters.map((item) => item.id),
                ...$modules.map((module) => module.id)
            ])
        ).filter((id): id is string => !!id);

        const ctx: RuntimeContext = {
            roomId: $activeRoom?.id,
            presetId: $appSettings?.presetId,
            characterId: character?.id,
            chatId,
            role: 'assistant',
            speakerId: character?.id,
            speakerName: character?.name
        };
        const dryRunMacros = createDryRunMacros();
        const backgroundMacros = createBackgroundMacros($chatAssetsMap, ownerIds, rawAssetUrlCache);
        const templated = await runTemplate(html, ctx, dryRunMacros);
        const processed = await runPipeline(chatId, 'display', templated, ctx);
        const rendered = await runTemplate(processed, ctx, backgroundMacros);
        const scopedHtml = scopeStyleBlocks(
            rendered,
            `[data-keiai-background-scope="${backgroundScope.replace(/"/g, '\\"')}"]`
        );
        const protectedHtml = protectHtmlStyles(scopedHtml, 'kei-bg-style');
        const rawHtml = await parseMarkdownAsync(protectedHtml.text);
        const restoredHtml = restoreHtmlStyles(rawHtml, protectedHtml.styles, 'kei-bg-style');
        const sanitized = sanitizeWithStyle(restoredHtml);

        if (run === version) renderedHtml = sanitized;
    }

    $effect(() => {
        const character = defaultCharacter;
        const mods = getActiveModulesForCharacter(character, $appSettings, $modules);
        const html = [
            character?.backgroundHTML ?? '',
            ...mods.map((module) => module.backgroundHTML)
        ]
            .filter((part) => part.trim())
            .join('\n');

        void renderBackground(html, character, mods);
    });

    onDestroy(() => {
        version += 1;
        for (const url of rawAssetUrlCache.values()) {
            if (url) void AssetService.revokeUrl(url);
        }
        rawAssetUrlCache.clear();
    });
</script>

{#if renderedHtml}
    <div class="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div
            class="h-full w-full"
            data-keiai-background-scope={backgroundScope}
            use:hydrateAssets={renderedHtml}
        >
            <!-- eslint-disable-next-line svelte/no-at-html-tags -- DOMPurify sanitizes above -->
            {@html renderedHtml}
        </div>
    </div>
{/if}
