import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runTitle } from '$lib/tasks/title';
import { titleTasks } from '$lib/stores/state';

const mocks = vi.hoisted(() => ({
    getSettings: vi.fn(),
    getChat: vi.fn(),
    getLastMessage: vi.fn(),
    updateChat: vi.fn(),
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
    getChat: mocks.getChat,
    updateChat: mocks.updateChat
}));

vi.mock('$lib/stores/content/message', () => ({
    getLastMessage: mocks.getLastMessage
}));

vi.mock('$lib/stores/tasks/title', () => ({
    createTitleTask: mocks.createTask,
    clearTitleTask: mocks.clearTask,
    setTitleTaskComplete: mocks.completeTask,
    setTitleTaskError: mocks.setTaskError,
    notifyTitleTaskComplete: mocks.notifyTaskComplete,
    notifyTitleTaskError: mocks.notifyTaskError,
    getTitleTask: mocks.getTask,
    getGeneratingTitleTaskIds: mocks.getGeneratingIds
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

describe('title task', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTask.mockReturnValue(null);
        mocks.getGeneratingIds.mockReturnValue([]);
        mocks.getSettings.mockResolvedValue({
            presetId: 'preset-1',
            titleGeneration: { workflow: { nodes: {} } }
        });
        mocks.getChat.mockResolvedValue({
            id: 'chat-1',
            roomId: 'room-1',
            title: 'New Chat 1'
        });
        mocks.getLastMessage.mockResolvedValue({
            id: 'last-1',
            chatId: 'chat-1',
            sortOrder: 'b0'
        });
        mocks.createPagedMessages.mockResolvedValue({ length: 3 });
        mocks.runtimeStream.mockImplementation(async function* () {
            yield 'Beach Trip Plans';
        });
    });

    afterEach(() => {
        titleTasks.set(new Map());
    });

    it('writes the workflow output into the chat title', async () => {
        await runTitle('chat-1');

        expect(mocks.completeTask).toHaveBeenCalledWith('chat-1');
        expect(mocks.notifyTaskComplete).toHaveBeenCalledWith('chat-1');
        expect(mocks.updateChat).toHaveBeenCalledWith('chat-1', { title: 'Beach Trip Plans' });
    });

    it('includes the last message via createThrough for index stability', async () => {
        await runTitle('chat-1');

        expect(mocks.createPagedMessages).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'last-1', sortOrder: 'b0' })
        );
    });

    it('passes no local macros to the runtime', async () => {
        await runTitle('chat-1');

        const options = mocks.runtimeOptions.mock.calls[0]?.[0] as {
            localMacros?: Map<string, unknown>;
        };
        // title task has no source/lang macros — conversation flows via the history block
        expect(options.localMacros).toBeUndefined();
    });

    it('throws when the chat has no messages', async () => {
        mocks.getLastMessage.mockResolvedValue(null);

        await expect(runTitle('chat-1')).rejects.toThrow();
        expect(mocks.createTask).not.toHaveBeenCalled();
    });

    it('does not update the title when the output is empty', async () => {
        mocks.runtimeStream.mockImplementation(async function* () {
            yield '   ';
        });

        await runTitle('chat-1');

        expect(mocks.updateChat).not.toHaveBeenCalled();
        expect(mocks.completeTask).toHaveBeenCalledWith('chat-1');
    });

    it('keeps a failed task available for the UI to dismiss', async () => {
        mocks.runtimeStream.mockImplementation(async function* () {
            yield 'partial';
            throw new Error('provider failed');
        });

        await expect(runTitle('chat-1')).resolves.toBeUndefined();
        expect(mocks.setTaskError).toHaveBeenCalledWith('chat-1', 'provider failed');
        expect(mocks.notifyTaskError).toHaveBeenCalledWith('chat-1', 'provider failed');
        expect(mocks.clearTask).not.toHaveBeenCalled();
    });

    it('clears the task when aborted', async () => {
        mocks.createTask.mockImplementation((_chatId: string, controller: AbortController) => {
            controller.abort();
        });
        mocks.runtimeStream.mockImplementation(async function* () {
            yield 'partial';
            throw new DOMException('Aborted', 'AbortError');
        });

        await expect(runTitle('chat-1')).resolves.toBeUndefined();

        expect(mocks.clearTask).toHaveBeenCalledWith('chat-1');
        expect(mocks.setTaskError).not.toHaveBeenCalled();
        expect(mocks.notifyTaskError).not.toHaveBeenCalled();
    });

    it('registers the task keyed by chat id', async () => {
        await runTitle('chat-1');

        expect(mocks.createTask).toHaveBeenCalledWith(
            'chat-1',
            expect.any(AbortController),
            expect.objectContaining({
                roomId: 'room-1',
                chatId: 'chat-1',
                chatTitle: 'New Chat 1',
                title: 'Generate title'
            })
        );
    });
});
