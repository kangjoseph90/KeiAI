import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTranslationSourceHash, runTranslation } from '$lib/tasks/translation';
import type { Message } from '$lib/services';

const mocks = vi.hoisted(() => ({
    getSettings: vi.fn(),
    getMessage: vi.fn(),
    getChat: vi.fn(),
    updateMessageSwipe: vi.fn(),
    createTask: vi.fn(),
    clearTask: vi.fn(),
    completeTask: vi.fn(),
    setTaskError: vi.fn(),
    notifyTaskComplete: vi.fn(),
    notifyTaskError: vi.fn(),
    getTask: vi.fn(),
    createPagedMessages: vi.fn(),
    runtimeOptions: vi.fn(),
    runtimeStream: vi.fn(),
    sha256: vi.fn()
}));

vi.mock('$lib/crypto', () => ({
    sha256: mocks.sha256
}));

vi.mock('$lib/stores/content/settings', () => ({
    getAppSettings: mocks.getSettings
}));

vi.mock('$lib/stores/content/chat', () => ({
    getChat: mocks.getChat
}));

vi.mock('$lib/stores/content/message', () => ({
    getMessage: mocks.getMessage,
    updateMessageSwipe: mocks.updateMessageSwipe
}));

vi.mock('$lib/stores/tasks/translation', () => ({
    createTranslationTask: mocks.createTask,
    clearTranslationTask: mocks.clearTask,
    setTranslationTaskComplete: mocks.completeTask,
    setTranslationTaskError: mocks.setTaskError,
    notifyTranslationTaskComplete: mocks.notifyTaskComplete,
    notifyTranslationTaskError: mocks.notifyTaskError,
    getTranslationTask: mocks.getTask
}));

vi.mock('$lib/services/content/paged_messages', () => ({
    PagedMessages: {
        createThrough: mocks.createPagedMessages
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

describe('translation task', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.sha256.mockImplementation(async (value: string) => `hash:${value}`);
        mocks.getTask.mockReturnValue(null);
        mocks.getSettings.mockResolvedValue({
            presetId: 'preset-1',
            translation: {
                targetLanguage: ' Korean ',
                workflow: { nodes: {} }
            }
        });
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
                    parts: [{ type: 'text', text: 'Hello' }],
                    createdAt: 1,
                    speakerId: 'character-1',
                    speakerName: 'Character'
                }
            }
        };
        mocks.getMessage.mockImplementation(async () => message);
        mocks.updateMessageSwipe.mockImplementation(
            async (_messageId: string, swipeId: string, changes: { translation?: unknown }) => {
                Object.assign(message.swipes[swipeId as 'swipe-1'], changes);
            }
        );
        mocks.getChat.mockResolvedValue({ id: 'chat-1', roomId: 'room-1' });
        mocks.createPagedMessages.mockResolvedValue({ length: 4 });
        mocks.runtimeStream.mockImplementation(async function* () {
            yield '안녕';
            yield '안녕하세요';
        });
    });

    it('hashes only the trimmed target language and source snapshot', async () => {
        await expect(createTranslationSourceHash('Hello', 'Korean')).resolves.toBe(
            'hash:Korean\0Hello'
        );
        expect(mocks.sha256).toHaveBeenCalledWith('Korean\0Hello');
    });

    it('includes the target message in history and streams the workflow result', async () => {
        await runTranslation('message-1');

        expect(mocks.completeTask).toHaveBeenCalledWith('message-1');
        expect(mocks.notifyTaskComplete).toHaveBeenCalledWith('message-1');
        expect(mocks.notifyTaskError).not.toHaveBeenCalled();
        expect(mocks.createPagedMessages).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'message-1', sortOrder: 'b0' })
        );
        expect(mocks.createTask).toHaveBeenCalledWith(
            'message-1',
            'hash:Korean\0Hello',
            expect.any(AbortController),
            expect.objectContaining({ roomId: 'room-1', chatId: 'chat-1' })
        );
        expect(mocks.updateMessageSwipe).toHaveBeenNthCalledWith(1, 'message-1', 'swipe-1', {
            translation: {
                sourceHash: 'hash:Korean\0Hello',
                text: ''
            }
        });
        expect(mocks.updateMessageSwipe).toHaveBeenNthCalledWith(2, 'message-1', 'swipe-1', {
            translation: {
                sourceHash: 'hash:Korean\0Hello',
                text: '안녕'
            }
        });
        expect(mocks.updateMessageSwipe).toHaveBeenNthCalledWith(3, 'message-1', 'swipe-1', {
            translation: {
                sourceHash: 'hash:Korean\0Hello',
                text: '안녕하세요'
            }
        });
        const options = mocks.runtimeOptions.mock.calls[0]?.[0] as {
            ctx: { messageId: string; messageIndex: number; characterId: string };
            localMacros: Map<string, { run: (args: string[]) => string }>;
        };
        expect(options.ctx).toMatchObject({
            messageId: 'message-1',
            messageIndex: 3,
            characterId: 'character-1'
        });
        expect(options.localMacros.get('source')?.run([])).toBe('Hello');
        expect(options.localMacros.get('targetlang')?.run([])).toBe('Korean');
        expect(() => options.localMacros.get('source')?.run(['unexpected'])).toThrow(
            '{{source}} does not accept arguments'
        );
    });

    it('returns a cached translation without running the workflow', async () => {
        const message = await mocks.getMessage();
        message.swipes['swipe-1'].translation = {
            sourceHash: 'hash:Korean\0Hello',
            text: '안녕하세요'
        };

        await expect(runTranslation('message-1')).resolves.toBeUndefined();
        expect(mocks.createPagedMessages).not.toHaveBeenCalled();
        expect(mocks.createTask).not.toHaveBeenCalled();
    });

    it('keeps a failed task available for the UI to dismiss', async () => {
        mocks.runtimeStream.mockImplementation(async function* () {
            yield 'partial';
            throw new Error('provider failed');
        });

        await expect(runTranslation('message-1')).rejects.toThrow('provider failed');
        expect(mocks.setTaskError).toHaveBeenCalledWith('message-1', 'provider failed');
        expect(mocks.notifyTaskError).toHaveBeenCalledWith('message-1', 'provider failed');
        expect(mocks.clearTask).not.toHaveBeenCalled();
    });

    it('does not notify when the translation is aborted', async () => {
        mocks.createTask.mockImplementation(
            (_messageId, _sourceHash, controller: AbortController) => {
                controller.abort();
            }
        );
        mocks.runtimeStream.mockImplementation(async function* () {
            yield 'partial';
            throw new DOMException('Aborted', 'AbortError');
        });

        await expect(runTranslation('message-1')).rejects.toThrow('Aborted');

        expect(mocks.clearTask).toHaveBeenCalledWith('message-1');
        expect(mocks.setTaskError).not.toHaveBeenCalled();
        expect(mocks.notifyTaskComplete).not.toHaveBeenCalled();
        expect(mocks.notifyTaskError).not.toHaveBeenCalled();
    });
});
