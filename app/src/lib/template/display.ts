import type { Macro } from './types';
import { AssetService } from '$lib/services/asset';

export type AssetNameIndex = Map<string, Map<string, string[]>>;
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

    const imageMacro: Macro = {
        run: ([name]) => {
            if (!name) return '';

            const assetId = resolveAssetName(index, ownerIds, name) ?? name;

            return [
                '<img',
                ` data-keiai-asset-id="${escapeHtmlAttribute(assetId)}"`,
                ` data-keiai-asset-name="${escapeHtmlAttribute(name)}"`,
                ' alt=""',
                ' loading="lazy"',
                ' decoding="async"',
                ' />'
            ].join('');
        }
    };

    macros.set('img', imageMacro);
    macros.set('image', imageMacro);
    macros.set('inlay', {
        run: ([assetId]) => {
            if (!assetId) return '';

            return [
                '<img',
                ` data-keiai-asset-id="${escapeHtmlAttribute(assetId)}"`,
                ' alt=""',
                ' loading="lazy"',
                ' decoding="async"',
                ' />'
            ].join('');
        }
    });

    const rawMacro: Macro = {
        run: ([name]) => readAssetUrl(index, ownerIds, rawUrlCache, name)
    };
    macros.set('raw', rawMacro);
    macros.set('path', rawMacro);

    return macros;
}

async function readAssetUrl(
    index: AssetNameIndex,
    ownerIds: readonly (string | null | undefined)[],
    rawUrlCache: RawAssetUrlCache,
    name: string | undefined
): Promise<string> {
    if (!name) return '';

    const assetId = resolveAssetName(index, ownerIds, name) ?? name;
    const cached = rawUrlCache.get(assetId);
    if (cached !== undefined) return cached ?? '';

    const url = await AssetService.read(assetId);
    rawUrlCache.set(assetId, url);
    return url ?? '';
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
): string | null {
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
