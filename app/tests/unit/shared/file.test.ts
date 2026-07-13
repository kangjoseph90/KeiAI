import { describe, expect, it } from 'vitest';
import {
    detectFileKind,
    fileNameFromPath,
    mimeTypeForFileKind,
    withDetectedExtension
} from '$lib/utils/file';

describe('file utilities', () => {
    it.each([
        {
            bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            kind: 'png'
        },
        { bytes: new TextEncoder().encode('GIF89a'), kind: 'gif' },
        { bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]), kind: 'zip' },
        { bytes: new TextEncoder().encode('\uFEFF  {"ok":true}'), kind: 'json' }
    ] as const)('detects $kind content', ({ bytes, kind }) => {
        expect(detectFileKind(bytes)).toBe(kind);
    });

    it('recovers a decoded name from a content URI', () => {
        expect(fileNameFromPath('content://media/images/image%3A42?size=1')).toBe('image:42');
    });

    it('adds metadata only when a filename has no extension', () => {
        expect(withDetectedExtension('image:42', 'jpeg')).toBe('image:42.jpg');
        expect(withDetectedExtension('avatar.bin', 'png')).toBe('avatar.bin');
        expect(mimeTypeForFileKind('jpeg')).toBe('image/jpeg');
    });
});
