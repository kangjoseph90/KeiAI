import { afterEach, describe, expect, it, vi } from 'vitest';
import { destroyAllInstances, getOrCreateInstance, invokeHandler } from '$lib/charjs';
import type { CharJS } from '$lib/services';

const mocks = vi.hoisted(() => ({
    getRoom: vi.fn().mockResolvedValue({ id: 'room-1', name: 'Room' }),
    getChat: vi.fn().mockResolvedValue({ id: 'chat-1', roomId: 'room-1', title: 'Chat' }),
    getMessage: vi.fn().mockResolvedValue({ id: 'message-1', chatId: 'chat-1', role: 'user' }),
    listInlays: vi
        .fn()
        .mockResolvedValue([{ id: 'image-1', name: 'image.png', mimeType: 'image/png' }])
}));

vi.mock('$lib/stores', () => ({
    getRoom: mocks.getRoom,
    getChat: mocks.getChat,
    getMessage: mocks.getMessage
}));

vi.mock('$lib/managers/media', () => ({
    generateImageInlay: vi.fn(),
    synthesizeSpeechInlay: vi.fn(),
    transcribeSpeechInlay: vi.fn(),
    listInlays: mocks.listInlays
}));

vi.mock('$lib/managers/chat', () => ({
    getChatVariable: vi.fn(),
    setChatVariable: vi.fn()
}));

const script: CharJS = {
    id: 'resource-script',
    sortOrder: 'a',
    name: 'Resource Script',
    enabled: true,
    code: `
        KeiAPI.onPipeline('display', async () => {
            const room = await KeiAPI.getRoom('room-1');
            const chat = await KeiAPI.getChat('chat-1');
            const message = await KeiAPI.getMessage('message-1');
            const inlays = await KeiAPI.listInlays('chat-1');
            return JSON.stringify({ room, chat, message, inlays });
        });
    `
};

describe('CharJS resource APIs', () => {
    afterEach(() => {
        destroyAllInstances();
        vi.clearAllMocks();
    });

    it('reads domain objects and inlay metadata by ID', async () => {
        const instance = await getOrCreateInstance('chat-1', script, 'pipe', 'display', true);
        const handler = instance?.pipelineHandlers.get('display')?.[0];

        const result = await invokeHandler(instance!, handler!.fnHandle, 'value');
        expect(JSON.parse(String(result))).toEqual({
            room: { id: 'room-1', name: 'Room' },
            chat: { id: 'chat-1', roomId: 'room-1', title: 'Chat' },
            message: { id: 'message-1', chatId: 'chat-1', role: 'user' },
            inlays: [{ id: 'image-1', name: 'image.png', mimeType: 'image/png' }]
        });
    });
});
