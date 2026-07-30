import { describe, expect, it } from 'vitest';
import { MockTTSHandler } from '$lib/tts/handlers/mock';

describe('MockTTSHandler', () => {
    it.each(['sample', 'morse'] as const)(
        'returns playable WAV data for the %s model',
        async (modelId) => {
            const handler = new MockTTSHandler({ behavior: modelId });
            const result = await handler.synthesize('SOS', new AbortController().signal);

            expect(result.mimeType).toBe('audio/wav');
            expect(new TextDecoder().decode(result.data.subarray(0, 4))).toBe('RIFF');
            expect(result.data.byteLength).toBeGreaterThan(44);
        }
    );
});
