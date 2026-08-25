import { describe, expect, it } from 'vitest';
import { charsetFromMimeType, decodeTextBytes } from '$lib/utils/text';

describe('text decoding', () => {
    it('decodes UTF-16 byte-order marks', () => {
        expect(decodeTextBytes(new Uint8Array([0xff, 0xfe, 0x41, 0x00]))).toBe('A');
        expect(decodeTextBytes(new Uint8Array([0xfe, 0xff, 0x00, 0x41]))).toBe('A');
    });

    it('uses a declared legacy charset', () => {
        expect(decodeTextBytes(new Uint8Array([0xb0, 0xa1]), 'euc-kr')).toBe('가');
        expect(decodeTextBytes(new Uint8Array([0xb0, 0xa1]), 'cp949')).toBe('가');
    });

    it('extracts quoted charset parameters', () => {
        expect(charsetFromMimeType('text/plain; charset="euc-kr"')).toBe('euc-kr');
    });
});
