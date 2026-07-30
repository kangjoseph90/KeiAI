import { describe, expect, it } from 'vitest';
import { createAssetUri, parseAssetUri } from '$lib/services/asset';
import type { AssetReadLocator } from '$lib/services/asset';

const locator: AssetReadLocator = {
    scopeType: 'room',
    scopeId: 'room-한글',
    ownerTable: 'characters',
    ownerId: 'character-1',
    hash: 'hash-1',
    encKey: 'key-1',
    mimeType: 'image/webp',
    width: 1024,
    height: 1536
};

describe('asset URI', () => {
    it('round trips an asset read locator through a URL-safe URI', () => {
        const uri = createAssetUri(locator);

        expect(uri).toMatch(/^data:image\/gif;base64,[A-Za-z0-9+/=]+#keiai-asset:[A-Za-z0-9_-]+$/);
        expect(parseAssetUri(uri)).toEqual(locator);
    });

    it('uses the asset dimensions as the placeholder GIF intrinsic size', () => {
        const uri = createAssetUri(locator);
        const [dataUrl] = uri.split('#', 1);
        const payload = dataUrl.slice('data:image/gif;base64,'.length);
        const bytes = Uint8Array.from(atob(payload), (char) => char.charCodeAt(0));

        expect([...bytes.slice(0, 6)]).toEqual([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
        expect(bytes[6] | (bytes[7] << 8)).toBe(1024);
        expect(bytes[8] | (bytes[9] << 8)).toBe(1536);
    });

    it('rejects malformed and structurally invalid asset URIs', () => {
        expect(parseAssetUri('https://example.com/asset')).toBeNull();
        expect(
            parseAssetUri('data:image/gif;base64,invalid#keiai-asset:not-valid-json')
        ).toBeNull();

        const bytes = new TextEncoder().encode(JSON.stringify({ ...locator, scopeType: 'global' }));
        const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
        const invalidPayload = btoa(binary)
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/g, '');
        expect(
            parseAssetUri(
                `data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==#keiai-asset:${invalidPayload}`
            )
        ).toBeNull();
    });
});
