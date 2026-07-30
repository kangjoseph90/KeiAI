import { TABLES, type TableName } from '$lib/adapters/db';
import type { AssetReadLocator } from './types';

const GIF_DATA_URI_PREFIX = 'data:image/gif;base64,';
export const ASSET_URI_MARKER = '#keiai-asset:';
export const ASSET_URI_PATTERN =
    /data:image\/gif;base64,[A-Za-z0-9+/]+={0,2}#keiai-asset:[A-Za-z0-9_-]+/g;

const PLACEHOLDER_GIF = Uint8Array.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00,
    0xff, 0xff, 0xff, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x01, 0x4c,
    0x00, 0x3b
]);

export function createAssetUri(locator: AssetReadLocator): string {
    const bytes = new TextEncoder().encode(JSON.stringify(locator));
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    const payload = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    return createPlaceholderDataUri(locator.width, locator.height) + ASSET_URI_MARKER + payload;
}

export function parseAssetUri(uri: string): AssetReadLocator | null {
    if (!uri.startsWith(GIF_DATA_URI_PREFIX)) return null;

    const markerIndex = uri.indexOf(ASSET_URI_MARKER, GIF_DATA_URI_PREFIX.length);
    if (markerIndex < 0) return null;

    const payload = uri.slice(markerIndex + ASSET_URI_MARKER.length);
    if (!payload || !/^[A-Za-z0-9_-]+$/.test(payload)) return null;

    try {
        const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
        const binary = atob(padded);
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
        return isAssetReadLocator(value) ? value : null;
    } catch {
        return null;
    }
}

function createPlaceholderDataUri(width: number | undefined, height: number | undefined): string {
    const gif = PLACEHOLDER_GIF.slice();
    writeGifDimension(gif, 6, width);
    writeGifDimension(gif, 8, height);
    const binary = Array.from(gif, (byte) => String.fromCharCode(byte)).join('');
    return GIF_DATA_URI_PREFIX + btoa(binary);
}

function writeGifDimension(bytes: Uint8Array, offset: number, value: number | undefined): void {
    const dimension =
        isOptionalDimension(value) && value !== undefined && value <= 0xffff ? value : 1;
    bytes[offset] = dimension & 0xff;
    bytes[offset + 1] = dimension >> 8;
}

function isAssetReadLocator(value: unknown): value is AssetReadLocator {
    if (!value || typeof value !== 'object') return false;

    const locator = value as Record<string, unknown>;
    return (
        (locator.scopeType === 'user' || locator.scopeType === 'room') &&
        isNonEmptyString(locator.scopeId) &&
        isTableName(locator.ownerTable) &&
        isNonEmptyString(locator.ownerId) &&
        isNonEmptyString(locator.hash) &&
        isNonEmptyString(locator.encKey) &&
        (locator.mimeType === undefined || typeof locator.mimeType === 'string') &&
        isOptionalDimension(locator.width) &&
        isOptionalDimension(locator.height)
    );
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function isTableName(value: unknown): value is TableName {
    return typeof value === 'string' && TABLES.some((table) => table === value);
}

function isOptionalDimension(value: unknown): value is number | undefined {
    return (
        value === undefined || (typeof value === 'number' && Number.isInteger(value) && value > 0)
    );
}
