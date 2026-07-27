import { describe, expect, it } from 'vitest';
import { MockTTSStreamHandler } from '$lib/tts/handlers/mock';

describe('MockTTSStreamHandler', () => {
    it.each(['sample', 'morse'] as const)(
        'returns playable WAV data for the %s model',
        async (modelId) => {
            const handler = new MockTTSStreamHandler({ behavior: modelId });
            const chunks = [];

            for await (const chunk of handler.synthesize('SOS', new AbortController().signal)) {
                chunks.push(chunk);
            }

            expect(chunks).toHaveLength(1);
            expect(chunks[0].mimeType).toBe('audio/wav');
            expect(new TextDecoder().decode(chunks[0].data.subarray(0, 4))).toBe('RIFF');
            expect(chunks[0].data.byteLength).toBeGreaterThan(44);
        }
    );
});
