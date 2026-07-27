import { describe, expect, it } from 'vitest';
import { getAssetMediaType } from '$lib/types/asset';

describe('getAssetMediaType', () => {
    it.each([
        ['image/webp', 'image'],
        ['audio/mpeg', 'audio'],
        ['video/mp4; codecs=avc1', 'video'],
        ['application/pdf', 'other'],
        ['', 'other']
    ] as const)('classifies %s as %s', (mimeType, expected) => {
        expect(getAssetMediaType(mimeType)).toBe(expected);
    });
});
