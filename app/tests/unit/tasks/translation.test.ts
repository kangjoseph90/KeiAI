import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTranslationSourceHash, runTranslation } from '$lib/tasks/translation';

const mocks = vi.hoisted(() => ({
    getSettings: vi.fn(),
    getMessage: vi.fn(),
    getChat: vi.fn(),
    findLoaded: vi.fn(),
    createTranslation: vi.fn(),
    updateTranslation: vi.fn(),
    createTask: vi.fn(),
    clearTask: vi.fn(),
    setTaskError: vi.fn(),
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
    getMessage: mocks.getMessage
}));

vi.mock('$lib/stores/content/translation', () => ({
    findLoadedTranslation: mocks.findLoaded,
    createTranslation: mocks.createTranslation,
    updateTranslation: mocks.updateTranslation
}));

vi.mock('$lib/stores/tasks/translation', () => ({
    createTranslationTask: mocks.createTask,
    clearTranslationTask: mocks.clearTask,
    setTranslationTaskError: mocks.setTaskError,
    getTranslationTask: mocks.getTask
}));

vi.mock('$lib/services/content/paged_messages', () => ({
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
        mocks.getMessage.mockResolvedValue({
            id: 'message-1',
            chatId: 'chat-1',
            sortOrder: 'b0',
            role: 'assistant',
            activeSwipeId: 'swipe-1',
            swipes: {
                'swipe-1': {
                    id: 'swipe-1',
                    content: 'Hello',
                    createdAt: 1,
                    speakerId: 'character-1',
                    speakerName: 'Character'
                }
            }
        });
        mocks.getChat.mockResolvedValue({ id: 'chat-1', roomId: 'room-1' });
        mocks.createPagedMessages.mockResolvedValue({ length: 3 });
        mocks.findLoaded.mockReturnValue(null);
        mocks.createTranslation.mockResolvedValue({
            id: 'translation-1',
            chatId: 'chat-1',
            messageId: 'message-1',
            sourceHash: 'hash:Korean\0Hello',
            text: '안녕하세요'
        });
        mocks.runtimeStream.mockImplementation(async function* () {
            yield { content: '안녕' };
            yield { content: '안녕하세요' };
        });
    });

    it('hashes only the trimmed target language and source snapshot', async () => {
        await expect(createTranslationSourceHash('Hello', 'Korean')).resolves.toBe(
            'hash:Korean\0Hello'
        );
        expect(mocks.sha256).toHaveBeenCalledWith('Korean\0Hello');
    });

    it('bounds history before the target message and streams the workflow result', async () => {
        await runTranslation('message-1');

        expect(mocks.createPagedMessages).toHaveBeenCalledWith('chat-1', 'b0');
        expect(mocks.createTask).toHaveBeenCalledWith(
            'message-1',
            'hash:Korean\0Hello',
            expect.any(AbortController)
        );
        expect(mocks.createTranslation).toHaveBeenCalledWith('chat-1', 'message-1', {
            sourceHash: 'hash:Korean\0Hello',
            text: ''
        });
        expect(mocks.updateTranslation).toHaveBeenNthCalledWith(1, 'translation-1', {
            text: '안녕'
        });
        expect(mocks.updateTranslation).toHaveBeenNthCalledWith(2, 'translation-1', {
            text: '안녕하세요'
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
        const cached = {
            id: 'translation-1',
            chatId: 'chat-1',
            messageId: 'message-1',
            sourceHash: 'hash:Korean\0Hello',
            text: '안녕하세요'
        };
        mocks.findLoaded.mockReturnValue(cached);

        await expect(runTranslation('message-1')).resolves.toBeUndefined();
        expect(mocks.createPagedMessages).not.toHaveBeenCalled();
        expect(mocks.createTask).not.toHaveBeenCalled();
    });

    it('keeps a failed task available for the UI to dismiss', async () => {
        mocks.runtimeStream.mockImplementation(async function* () {
            yield { content: 'partial' };
            throw new Error('provider failed');
        });

        await expect(runTranslation('message-1')).rejects.toThrow('provider failed');
        expect(mocks.setTaskError).toHaveBeenCalledWith('message-1', 'provider failed');
        expect(mocks.clearTask).not.toHaveBeenCalled();
    });
});
