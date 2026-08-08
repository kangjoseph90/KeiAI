import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { runSuggestion } from '$lib/tasks/suggestion';
import { suggestionTasks, chatDrafts } from '$lib/stores/state';

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
    getGeneratingIds: vi.fn(),
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

vi.mock('$lib/stores/tasks/suggestion', () => ({
    createSuggestionTask: mocks.createTask,
    clearSuggestionTask: mocks.clearTask,
    setSuggestionTaskComplete: mocks.completeTask,
    setSuggestionTaskError: mocks.setTaskError,
    notifySuggestionTaskComplete: mocks.notifyTaskComplete,
    notifySuggestionTaskError: mocks.notifyTaskError,
    getSuggestionTask: mocks.getTask,
    getGeneratingSuggestionTaskIds: mocks.getGeneratingIds
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

describe('suggestion task', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTask.mockReturnValue(null);
        mocks.getGeneratingIds.mockReturnValue([]);
        mocks.getSettings.mockResolvedValue({
            presetId: 'preset-1',
            suggestion: { workflow: { nodes: {} } }
        });
        mocks.getChat.mockResolvedValue({ id: 'chat-1', roomId: 'room-1', title: 'Chat 1' });
        mocks.getChatDraft.mockReturnValue({
            text: 'I was thinking about',
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
            yield 'What if we went to the beach?';
        });
    });

    afterEach(() => {
        suggestionTasks.set(new Map());
        chatDrafts.set(new Map());
    });

    it('streams the workflow output into a draft suggestion', async () => {
        await runSuggestion('chat-1');

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
            'What if we went to the beach?'
        );
    });

    it('includes the last message via createThrough for index stability', async () => {
        await runSuggestion('chat-1');

        expect(mocks.createPagedMessages).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'last-1', sortOrder: 'b0' })
        );
    });

    it('falls back to createBefore when the chat has no messages', async () => {
        mocks.getLastMessage.mockResolvedValue(null);

        await runSuggestion('chat-1');

        expect(mocks.createPagedMessages).toHaveBeenCalledWith('chat-1', '\uffff');
    });

    it('injects only the source macro', async () => {
        await runSuggestion('chat-1');

        const options = mocks.runtimeOptions.mock.calls[0]?.[0] as {
            localMacros: Map<string, { run: (args: string[]) => string }>;
        };
        expect(options.localMacros.get('source')?.run([])).toBe('I was thinking about');
        expect(options.localMacros.get('sourcelang')).toBeUndefined();
        expect(options.localMacros.get('targetlang')).toBeUndefined();
    });

    it('runs even when the draft is empty', async () => {
        mocks.getChatDraft.mockReturnValue({ text: '', inlayIds: [], suggestions: {} });

        await runSuggestion('chat-1');

        expect(mocks.createTask).toHaveBeenCalled();
    });

    it('keeps a failed task available for the UI to dismiss', async () => {
        mocks.runtimeStream.mockImplementation(async function* () {
            yield 'partial';
            throw new Error('provider failed');
        });

        await expect(runSuggestion('chat-1')).resolves.toBeUndefined();
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

        await expect(runSuggestion('chat-1')).resolves.toBeUndefined();

        expect(mocks.clearTask).toHaveBeenCalledWith(expect.any(String));
        expect(mocks.dismissChatDraftSuggestion).toHaveBeenCalledWith('chat-1', expect.any(String));
        expect(mocks.setTaskError).not.toHaveBeenCalled();
        expect(mocks.notifyTaskError).not.toHaveBeenCalled();
    });

    it('registers the task under a generated suggestion id', async () => {
        await runSuggestion('chat-1');

        expect(mocks.createTask).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(AbortController),
            expect.objectContaining({
                roomId: 'room-1',
                chatId: 'chat-1',
                title: 'Suggestion'
            })
        );
    });
});
