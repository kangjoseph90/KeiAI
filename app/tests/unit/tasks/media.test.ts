import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { Message } from '$lib/services/content/message';
import { imageGenerationTasks, ttsTasks } from '$lib/stores/state';
import { runImageGeneration } from '$lib/tasks/image';
import { runTTS } from '$lib/tasks/tts';

const mocks = vi.hoisted(() => ({
    getAppSettings: vi.fn(),
    getChat: vi.fn(),
    getMessage: vi.fn(),
    updateMessageSwipe: vi.fn(),
    createPagedMessages: vi.fn(),
    runtimeOptions: vi.fn(),
    runtimeStream: vi.fn()
}));

vi.mock('$lib/stores', () => ({
    getAppSettings: mocks.getAppSettings,
    getChat: mocks.getChat,
    getMessage: mocks.getMessage,
    updateMessageSwipe: mocks.updateMessageSwipe
}));

vi.mock('$lib/services', () => ({
    PagedMessages: {
        createBefore: mocks.createPagedMessages
    }
}));

vi.mock('$lib/workflow', () => ({
    WorkflowRuntime: class {
        constructor(_workflow: unknown, options: unknown) {
            mocks.runtimeOptions(options);
        }

        run() {
            return mocks.runtimeStream();
        }
    }
}));

describe('media tasks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        const message: Message = {
            id: 'message-1',
            chatId: 'chat-1',
            scopeType: 'user',
            scopeId: 'user-1',
            sortOrder: 'b0',
            role: 'assistant',
            activeSwipeId: 'swipe-1',
            swipes: {
                'swipe-1': {
                    id: 'swipe-1',
                    parts: [{ type: 'text', text: 'describe this scene' }],
                    createdAt: 1
                }
            }
        };
        mocks.getMessage.mockResolvedValue(message);
        mocks.getAppSettings.mockResolvedValue({
            presetId: 'preset-1',
            imageGeneration: { workflow: { nodes: { image: {} } } },
            tts: { workflow: { nodes: { tts: {} } } }
        });
        mocks.getChat.mockResolvedValue({
            id: 'chat-1',
            roomId: 'room-1',
            inlays: {
                refs: {
                    'image-1': { mimeType: 'image/png' },
                    'audio-1': { mimeType: 'audio/wav' }
                }
            }
        });
        mocks.createPagedMessages.mockResolvedValue({ length: 3 });
        mocks.runtimeStream.mockImplementation(async function* () {
            yield '<|inlay|>["audio-1","image-1"]<|/inlay|>';
        });
    });

    afterEach(() => {
        imageGenerationTasks.set(new Map());
        ttsTasks.set(new Map());
    });

    it('stores only image outputs from the image generation workflow', async () => {
        await runImageGeneration('message-1');

        expect(mocks.createPagedMessages).toHaveBeenCalledWith('chat-1', 'b0');
        expect(mocks.updateMessageSwipe).toHaveBeenCalledWith('message-1', 'swipe-1', {
            imageAttachments: ['image-1']
        });
        const options = mocks.runtimeOptions.mock.calls[0]?.[0] as {
            ctx: { messageId: string; messageIndex: number };
            localMacros: Map<string, { run: (args: string[]) => string }>;
        };
        expect(options.ctx).toMatchObject({ messageId: 'message-1', messageIndex: 3 });
        expect(options.localMacros.get('source')?.run([])).toBe('describe this scene');
    });

    it('stores only audio outputs from the TTS workflow', async () => {
        await runTTS('message-1');

        expect(mocks.createPagedMessages).toHaveBeenCalledWith('chat-1', 'b0');
        expect(mocks.updateMessageSwipe).toHaveBeenCalledWith('message-1', 'swipe-1', {
            audioAttachments: ['audio-1']
        });
    });

    it('keeps a failed image task available for retry', async () => {
        mocks.runtimeStream.mockImplementation(async function* () {
            yield* [];
            throw new Error('provider failed');
        });

        await expect(runImageGeneration('message-1')).resolves.toBeUndefined();
        expect(get(imageGenerationTasks).get('message-1')).toMatchObject({
            status: 'error',
            errorMessage: 'provider failed'
        });
    });
});
