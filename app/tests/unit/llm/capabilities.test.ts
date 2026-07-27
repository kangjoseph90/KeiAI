import { describe, expect, it } from 'vitest';
import { adaptMediaForCapabilities } from '$lib/llm/capabilities';
import type { LLMMessage } from '$lib/llm/types';

describe('adaptMediaForCapabilities', () => {
    it('replaces only unsupported media types with explicit text markers', () => {
        const messages: LLMMessage[] = [
            {
                role: 'user',
                content: [
                    { type: 'image', mimeType: 'image/png', data: 'image' },
                    { type: 'audio', mimeType: 'audio/mpeg', data: 'audio' },
                    { type: 'video', mimeType: 'video/mp4', data: 'video' }
                ]
            }
        ];

        expect(adaptMediaForCapabilities(messages, ['audio_input', 'video_input'])).toEqual([
            {
                role: 'user',
                content: [
                    { type: 'image', mimeType: 'image/png', data: 'image' },
                    { type: 'text', text: '[Audio omitted: unsupported by model]' },
                    { type: 'text', text: '[Video omitted: unsupported by model]' }
                ]
            }
        ]);
    });
});
