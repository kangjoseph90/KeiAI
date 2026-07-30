import { describe, expect, it, vi } from 'vitest';
import { fileToPlaintext } from '$lib/services/asset/util';
import { preprocessImage } from '$lib/utils/image';

vi.mock('$lib/utils/image', () => ({
    preprocessImage: vi.fn(),
    readImageDimensions: vi.fn()
}));

describe('fileToPlaintext multimedia MIME detection', () => {
    it('returns the processed dimensions for uploaded images', async () => {
        vi.mocked(preprocessImage).mockResolvedValue({
            blob: new Blob([new Uint8Array([4, 5, 6])], { type: 'image/webp' }),
            width: 640,
            height: 960
        });
        const file = new File([new Uint8Array([1, 2, 3])], 'portrait.png', {
            type: 'image/png'
        });

        await expect(fileToPlaintext(file)).resolves.toMatchObject({
            mimeType: 'image/webp',
            width: 640,
            height: 960
        });
    });

    it('uses an audio extension when the browser provides no MIME type', async () => {
        const file = new File([new Uint8Array([1, 2, 3, 4])], 'voice.mp3');

        await expect(fileToPlaintext(file)).resolves.toMatchObject({
            mimeType: 'audio/mpeg'
        });
    });

    it('recognizes an MP4 container signature', async () => {
        const bytes = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
        const file = new File([bytes], 'clip.bin');

        await expect(fileToPlaintext(file)).resolves.toMatchObject({
            mimeType: 'video/mp4'
        });
    });

    it.each([
        ['A_OPUS', 'audio/webm'],
        ['V_VP9', 'video/webm']
    ])('recognizes the %s WebM codec', async (codec, mimeType) => {
        const header = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
        const file = new File([header, new TextEncoder().encode(codec)], 'recording.webm');

        await expect(fileToPlaintext(file)).resolves.toMatchObject({ mimeType });
    });
});
