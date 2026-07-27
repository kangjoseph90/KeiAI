import { describe, expect, it } from 'vitest';
import { MockLLMStreamHandler } from '$lib/llm/handlers/mock';
import { getTextContent } from '$lib/workflow/agent/llm';

async function getCompleteResponse(messages: Parameters<MockLLMStreamHandler['stream']>[0]) {
    const handler = new MockLLMStreamHandler({ behavior: 'echo' });
    const chunks = [];
    for await (const chunk of handler.stream(messages, new AbortController().signal, {
        stream: false
    })) {
        chunks.push(chunk);
    }
    return chunks.at(-1);
}

describe('MockLLMStreamHandler multimodal input', () => {
    it('acknowledges image attachments and preserves the accompanying text prompt', async () => {
        const response = await getCompleteResponse([
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Describe these images.' },
                    { type: 'image', mimeType: 'image/webp', data: 'AQID' },
                    { type: 'image', mimeType: 'image/webp', data: 'BAUG' }
                ]
            }
        ]);

        expect(response && getTextContent(response.parts)).toBe(
            '[Mock multimodal] Received 2 image attachments.\n\nText prompt: Describe these images.'
        );
    });

    it('acknowledges image-only input', async () => {
        const response = await getCompleteResponse([
            {
                role: 'user',
                content: [{ type: 'image', mimeType: 'image/webp', data: 'AQID' }]
            }
        ]);

        expect(response && getTextContent(response.parts)).toBe(
            '[Mock multimodal] Received 1 image attachment.'
        );
    });
});
