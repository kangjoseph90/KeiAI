import type { Macro } from './types';
import { AssetService } from '$lib/services/asset';

export type AssetNameIndex = Map<string, Map<string, string[]>>;
export type RawAssetUrlCache = Map<string, string | null>;

export function createAssetMacros(
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
    macros.set('raw', {
        run: async ([name]) => {
            if (!name) return '';

            const assetId = resolveAssetName(index, ownerIds, name) ?? name;
            const cached = rawUrlCache.get(assetId);
            if (cached !== undefined) return cached ?? '';

            const url = await AssetService.read(assetId);
            rawUrlCache.set(assetId, url);
            return url ?? '';
        }
    });

    return macros;
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
    name: string
): string | null {
    const key = normalizeAssetName(name);
    if (!key) return null;

    for (const ownerId of ownerIds) {
        if (!ownerId) continue;

        const ids = index.get(ownerId)?.get(key);
        if (ids?.length === 1) return ids[0];
        if (ids && ids.length > 1) return null;
    }

    return null;
}

function escapeHtmlAttribute(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
