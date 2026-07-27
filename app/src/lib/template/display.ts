import type { Macro } from './types';
import { AssetService, type AssetReadLocator } from '$lib/services/asset';
import { assetRegistryId } from '$lib/adapters/asset';
import { ChatService } from '$lib/services';
import { getAssetMediaType, type AssetMediaType } from '$lib/types/asset';

export type AssetNameIndex = Map<string, Map<string, AssetReadLocator[]>>;
export type RawAssetUrlCache = Map<string, string | null>;

export function createBackgroundMacros(
    index: AssetNameIndex,
    ownerIds: readonly (string | null | undefined)[],
    rawUrlCache: RawAssetUrlCache
): Map<string, Macro> {
    const macros = createDisplayMacros(index, ownerIds, rawUrlCache);
    macros.set('bg', {
        run: async ([name]) => {
            if (!name) return '';

            const url = await readAssetUrl(index, ownerIds, rawUrlCache, name);
            if (!url) return '';

            const style = [
                'width:100%',
                'height:100%',
                `background: linear-gradient(rgba(0, 0, 0, 0.8), rgba(0, 0, 0, 0.8)),url("${escapeCssString(url)}")`,
                'background-size: cover'
            ].join(';');
            return `<div style="${escapeHtmlAttribute(style)}"></div>`;
        }
    });
    return macros;
}

export function createDisplayMacros(
    index: AssetNameIndex,
    ownerIds: readonly (string | null | undefined)[],
    rawUrlCache: RawAssetUrlCache
): Map<string, Macro> {
    const macros = new Map<string, Macro>();

    const mediaMacro: Macro = {
        run: ([name]) => {
            if (!name) return '';

            const resolved = resolveAssetName(index, ownerIds, name);
            if (!resolved) return '';

            return renderMediaElement(resolved, {
                assetName: name,
                mediaType: resolved.mimeType ? getAssetMediaType(resolved.mimeType) : 'image'
            });
        }
    };

    macros.set('asset', mediaMacro);
    macros.set('media', mediaMacro);
    macros.set('img', mediaMacro);
    macros.set('image', mediaMacro);
    macros.set('audio', mediaMacro);
    macros.set('video', mediaMacro);
    macros.set('inlay', {
        run: async ([inlayId], ctx) => {
            if (!inlayId || !ctx.chatId) return '';
            const chat = await ChatService.get(ctx.chatId);
            const ref = chat?.inlays.refs[inlayId];
            if (!chat || !ref) return '';

            const locator: AssetReadLocator = {
                scopeType: chat.scopeType,
                scopeId: chat.scopeId,
                ownerTable: 'chats',
                ownerId: chat.id,
                hash: ref.hash,
                encKey: ref.encKey,
                mimeType: ref.mimeType
            };

            return renderMediaElement(locator, {
                inlayId,
                mediaType: ref.mimeType ? getAssetMediaType(ref.mimeType) : 'image'
            });
        }
    });

    const rawMacro: Macro = {
        run: ([name]) => readAssetUrl(index, ownerIds, rawUrlCache, name)
    };
    macros.set('raw', rawMacro);
    macros.set('path', rawMacro);

    return macros;
}

function renderMediaElement(
    locator: AssetReadLocator,
    options: { mediaType: AssetMediaType; assetName?: string; inlayId?: string }
): string {
    const data = [
        ` data-keiai-asset="${escapeHtmlAttribute(JSON.stringify(locator))}"`,
        options.assetName
            ? ` data-keiai-asset-name="${escapeHtmlAttribute(options.assetName)}"`
            : '',
        options.inlayId ? ` data-keiai-inlay-id="${escapeHtmlAttribute(options.inlayId)}"` : ''
    ].join('');

    if (options.mediaType === 'audio') {
        return `<audio${data} controls preload="metadata" style="max-width:100%;"></audio>`;
    }
    if (options.mediaType === 'video') {
        return `<video${data} controls preload="metadata" playsinline style="max-width:100%;max-height:320px;border-radius:0.375rem;"></video>`;
    }
    if (options.mediaType !== 'image') return '';

    return `<img${data} alt="" loading="lazy" decoding="async" style="max-width: 100%; max-height: 320px; object-fit: contain; border-radius: 0.375rem;" />`;
}

async function readAssetUrl(
    index: AssetNameIndex,
    ownerIds: readonly (string | null | undefined)[],
    rawUrlCache: RawAssetUrlCache,
    name: string | undefined
): Promise<string> {
    if (!name) return '';

    const resolved = resolveAssetName(index, ownerIds, name);
    if (resolved) {
        const key = assetRegistryId(resolved);
        const cached = rawUrlCache.get(key);
        if (cached !== undefined) return cached ?? '';

        const url = await AssetService.read(resolved);
        rawUrlCache.set(key, url);
        return url ?? '';
    }

    return '';
}

/**
 * Normalizes an asset name to prevent slight typing mismatches.
 * Converts to lowercase, trims whitespaces, strips common media extensions,
 * and removes delimiters like underscores, hyphens, dots, and spaces.
 */
export function normalizeAssetName(name: string): string {
    let normalized = name.toLowerCase().trim();
    const extensions = [
        'webp',
        'png',
        'jpg',
        'jpeg',
        'gif',
        'mp4',
        'webm',
        'avi',
        'm4p',
        'm4v',
        'mp3',
        'wav',
        'ogg'
    ];
    for (const ext of extensions) {
        if (normalized.endsWith('.' + ext)) {
            normalized = normalized.slice(0, -(ext.length + 1));
            break;
        }
    }
    return normalized.replace(/[\s_.-]/g, '');
}

export function resolveAssetName(
    index: AssetNameIndex,
    ownerIds: readonly (string | undefined | null)[],
    name: string,
    maxDiff = 4
): AssetReadLocator | null {
    const key = normalizeAssetName(name);
    if (!key) return null;
    const effectiveMaxDiff = Math.min(maxDiff, Math.floor(key.length * 0.3));

    for (const ownerId of ownerIds) {
        if (!ownerId) continue;
        const ownerMap = index.get(ownerId);
        if (!ownerMap) continue;
        const ids = ownerMap.get(key);
        if (ids?.length === 1) return ids[0];
        if (ids && ids.length > 1) return null;
        if (effectiveMaxDiff <= 0) continue;
        let closestKey: string | null = null;
        let closestDist = Infinity;
        for (const candidateKey of ownerMap.keys()) {
            if (Math.abs(key.length - candidateKey.length) > effectiveMaxDiff) {
                continue;
            }
            const dist = getDistance(key, candidateKey);
            if (dist < closestDist) {
                closestDist = dist;
                closestKey = candidateKey;
            }
        }
        if (closestKey && closestDist <= effectiveMaxDiff) {
            const closestIds = ownerMap.get(closestKey);
            if (closestIds?.length === 1) {
                ownerMap.set(key, closestIds);
                return closestIds[0];
            }
        }
    }
    return null;
}

function getDistance(a: string, b: string): number {
    const h = a.length + 1;
    const w = b.length + 1;
    const d = new Int16Array(h * w);
    for (let i = 0; i < h; i++) {
        d[i * w] = i;
    }
    for (let i = 0; i < w; i++) {
        d[i] = i;
    }
    for (let i = 1; i < h; i++) {
        for (let j = 1; j < w; j++) {
            d[i * w + j] = Math.min(
                d[(i - 1) * w + j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1),
                d[(i - 1) * w + j] + 1,
                d[i * w + j - 1] + 1
            );
        }
    }
    return d[h * w - 1];
}

function escapeHtmlAttribute(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeCssString(str: string): string {
    return str
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r?\n|\r/g, '');
}
