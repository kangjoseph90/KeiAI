import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { runInputTranslation } from '$lib/tasks/input_translation';
import { inputTranslationTasks, chatDrafts } from '$lib/stores/state';

const mocks = vi.hoisted(() => ({
    getSettings: vi.fn(),
    getChat: vi.fn(),
    getLastMessage: vi.fn(),
    getChatDraft: vi.fn(),
    setChatDraftSuggestion: vi.fn(),
    dismissChatDraftSuggestion: vi.fn(),
    createTask: vi.fn(),
    clearTask: vi.fn(),
    completeTask: vi.fn(),
    setTaskError: vi.fn(),
    notifyTaskComplete: vi.fn(),
    notifyTaskError: vi.fn(),
    getTask: vi.fn(),
    createPagedMessages: vi.fn(),
    runtimeOptions: vi.fn(),
    runtimeStream: vi.fn()
}));

vi.mock('$lib/stores/content/settings', () => ({
    getAppSettings: mocks.getSettings
}));

vi.mock('$lib/stores/content/chat', () => ({
    getChat: mocks.getChat
}));

vi.mock('$lib/stores/content/message', () => ({
    getLastMessage: mocks.getLastMessage
}));

vi.mock('$lib/stores/content/draft', () => ({
    getChatDraft: mocks.getChatDraft,
    setChatDraftSuggestion: mocks.setChatDraftSuggestion,
    dismissChatDraftSuggestion: mocks.dismissChatDraftSuggestion
}));

vi.mock('$lib/stores/tasks/input_translation', () => ({
    createInputTranslationTask: mocks.createTask,
    clearInputTranslationTask: mocks.clearTask,
    setInputTranslationTaskComplete: mocks.completeTask,
    setInputTranslationTaskError: mocks.setTaskError,
    notifyInputTranslationTaskComplete: mocks.notifyTaskComplete,
    notifyInputTranslationTaskError: mocks.notifyTaskError,
    getInputTranslationTask: mocks.getTask
}));

vi.mock('$lib/services/content/paged_messages', () => ({
    PagedMessages: {
        createThrough: mocks.createPagedMessages,
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

describe('input translation task', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTask.mockReturnValue(null);
        mocks.getSettings.mockResolvedValue({
            presetId: 'preset-1',
            translation: {
                targetLanguage: 'ko',
                bidirectional: false,
                secondaryLanguage: 'en',
                workflow: { nodes: {} }
            }
        });
        mocks.getChat.mockResolvedValue({ id: 'chat-1', roomId: 'room-1', title: 'Chat 1' });
        mocks.getChatDraft.mockReturnValue({
            text: 'Hello world, how are you today?',
            inlayIds: [],
            suggestions: {}
        });
        mocks.getLastMessage.mockResolvedValue({
            id: 'last-1',
            chatId: 'chat-1',
            sortOrder: 'b0'
        });
        mocks.createPagedMessages.mockResolvedValue({ length: 3 });
        mocks.runtimeStream.mockImplementation(async function* () {
            yield '안녕';
            yield '안녕하세요';
        });
    });

    afterEach(() => {
        inputTranslationTasks.set(new Map());
        chatDrafts.set(new Map());
    });

    it('streams the workflow output into a draft suggestion', async () => {
        await runInputTranslation('chat-1');

        expect(mocks.completeTask).toHaveBeenCalledWith(expect.any(String));
        expect(mocks.notifyTaskComplete).toHaveBeenCalledWith(expect.any(String));
        expect(mocks.setChatDraftSuggestion).toHaveBeenNthCalledWith(
            1,
            'chat-1',
            expect.any(String),
            ''
        );
        expect(mocks.setChatDraftSuggestion).toHaveBeenNthCalledWith(
            2,
            'chat-1',
            expect.any(String),
            '안녕'
        );
        expect(mocks.setChatDraftSuggestion).toHaveBeenNthCalledWith(
            3,
            'chat-1',
            expect.any(String),
            '안녕하세요'
        );
    });

    it('includes the last message via createThrough for index stability', async () => {
        await runInputTranslation('chat-1');

        expect(mocks.createPagedMessages).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'last-1', sortOrder: 'b0' })
        );
    });

    it('falls back to createBefore when the chat has no messages', async () => {
        mocks.getLastMessage.mockResolvedValue(null);

        await runInputTranslation('chat-1');

        expect(mocks.createPagedMessages).toHaveBeenCalledWith('chat-1', '\uffff');
    });

    it('injects source, sourcelang, and targetlang macros', async () => {
        await runInputTranslation('chat-1');

        const options = mocks.runtimeOptions.mock.calls[0]?.[0] as {
            localMacros: Map<string, { run: (args: string[]) => string }>;
        };
        expect(options.localMacros.get('source')?.run([])).toBe('Hello world, how are you today?');
        expect(options.localMacros.get('sourcelang')?.run([])).toBe('en');
        expect(options.localMacros.get('targetlang')?.run([])).toBe('ko');
    });

    it('throws when the draft is empty', async () => {
        mocks.getChatDraft.mockReturnValue({ text: '   ', inlayIds: [], suggestions: {} });

        await expect(runInputTranslation('chat-1')).rejects.toThrow();
        expect(mocks.createTask).not.toHaveBeenCalled();
    });

    it('keeps a failed task available for the UI to dismiss', async () => {
        mocks.runtimeStream.mockImplementation(async function* () {
            yield 'partial';
            throw new Error('provider failed');
        });

        await expect(runInputTranslation('chat-1')).resolves.toBeUndefined();
        expect(mocks.setTaskError).toHaveBeenCalledWith(expect.any(String), 'provider failed');
        expect(mocks.notifyTaskError).toHaveBeenCalledWith(expect.any(String), 'provider failed');
        expect(mocks.clearTask).not.toHaveBeenCalled();
    });

    it('clears the task and dismisses the suggestion when aborted', async () => {
        mocks.createTask.mockImplementation(
            (_suggestionId: string, controller: AbortController) => {
                controller.abort();
            }
        );
        mocks.runtimeStream.mockImplementation(async function* () {
            yield 'partial';
            throw new DOMException('Aborted', 'AbortError');
        });

        await expect(runInputTranslation('chat-1')).resolves.toBeUndefined();

        expect(mocks.clearTask).toHaveBeenCalledWith(expect.any(String));
        expect(mocks.dismissChatDraftSuggestion).toHaveBeenCalledWith('chat-1', expect.any(String));
        expect(mocks.setTaskError).not.toHaveBeenCalled();
        expect(mocks.notifyTaskError).not.toHaveBeenCalled();
    });

    it('registers the task under a generated suggestion id', async () => {
        await runInputTranslation('chat-1');

        expect(mocks.createTask).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(AbortController),
            expect.objectContaining({
                roomId: 'room-1',
                chatId: 'chat-1',
                title: 'Input translation'
            })
        );
    });
});
