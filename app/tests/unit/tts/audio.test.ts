import { describe, expect, it } from 'vitest';
import { float32ToWav, pcm16ToWav } from '$lib/utils/audio';

describe('TTS WAV encoding', () => {
    it('wraps PCM16 bytes in a playable mono WAV container', () => {
        const pcm = new Uint8Array([0x00, 0x00, 0xff, 0x7f]);
        const wav = pcm16ToWav(pcm, 24000);
        const view = new DataView(wav.buffer);

        expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF');
        expect(new TextDecoder().decode(wav.subarray(8, 12))).toBe('WAVE');
        expect(view.getUint16(22, true)).toBe(1);
        expect(view.getUint32(24, true)).toBe(24000);
        expect(view.getUint16(34, true)).toBe(16);
        expect(view.getUint32(40, true)).toBe(pcm.byteLength);
        expect(wav.subarray(44)).toEqual(pcm);
    });

    it('converts and clamps float samples to signed PCM16', () => {
        const wav = float32ToWav(new Float32Array([-2, 0, 2]), 22050);
        const view = new DataView(wav.buffer);

        expect(view.getInt16(44, true)).toBe(-32768);
        expect(view.getInt16(46, true)).toBe(0);
        expect(view.getInt16(48, true)).toBe(32767);
    });
});
