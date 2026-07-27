import { describe, expect, it } from 'vitest';
import { MockSTTHandler } from '$lib/stt/handlers/mock';

describe('MockSTTHandler', () => {
    it('returns a fixed transcript and segment in sample mode', async () => {
        const result = await new MockSTTHandler({ behavior: 'sample' }).transcribe(
            new Blob(['audio'], { type: 'audio/webm' })
        );

        expect(result.text).toBe('This is a mock transcription.');
        expect(result.segments).toEqual([
            { text: 'This is a mock transcription.', start: 0, end: 1.5 }
        ]);
    });

    it('reports the received file metadata in diagnostic mode', async () => {
        const result = await new MockSTTHandler({ behavior: 'diagnostic' }).transcribe(
            new File(['audio'], 'recording.webm', { type: 'audio/webm' })
        );

        expect(result.text).toContain('Name: recording.webm');
        expect(result.text).toContain('Type: audio/webm');
        expect(result.text).toContain('Size: 5 bytes');
    });
});
