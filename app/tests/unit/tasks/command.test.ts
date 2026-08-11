import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runCommand } from '$lib/tasks/command';
import { serializeAgentParts, type AgentPart } from '$lib/workflow/agent/llm';

const mocks = vi.hoisted(() => ({
    getChat: vi.fn(),
    getRoom: vi.fn(),
    getSettings: vi.fn(),
    getCharacter: vi.fn(),
    getPersona: vi.fn(),
    getLastMessage: vi.fn(),
    createMessage: vi.fn(),
    getMessage: vi.fn(),
    updateMessageSwipe: vi.fn(),
    getVariables: vi.fn(),
    prepareSwipe: vi.fn(),
    createPagedBefore: vi.fn(),
    createPagedThrough: vi.fn(),
    getChatTask: vi.fn(),
    getCommandTask: vi.fn(),
    createTask: vi.fn(),
    completeTask: vi.fn(),
    errorTask: vi.fn(),
    clearTask: vi.fn(),
    notifyComplete: vi.fn(),
    notifyError: vi.fn(),
    runtimeOptions: vi.fn(),
    runtimeStream: vi.fn(),
    runTemplate: vi.fn(),
    runPipeline: vi.fn(),
    emitEvent: vi.fn()
}));

vi.mock('$lib/stores/content/chat', () => ({ getChat: mocks.getChat }));
vi.mock('$lib/stores/content/room', () => ({ getRoom: mocks.getRoom }));
vi.mock('$lib/stores/content/settings', () => ({ getAppSettings: mocks.getSettings }));
vi.mock('$lib/stores/content/character', () => ({ getCharacter: mocks.getCharacter }));
vi.mock('$lib/stores/content/persona', () => ({ getPersona: mocks.getPersona }));
vi.mock('$lib/stores/content/message', () => ({
    getLastMessage: mocks.getLastMessage,
    createMessage: mocks.createMessage,
    getMessage: mocks.getMessage,
    updateMessageSwipe: mocks.updateMessageSwipe
}));
vi.mock('$lib/managers', () => ({
    getChatVariablesBefore: mocks.getVariables,
    prepareNextSwipe: mocks.prepareSwipe
}));
vi.mock('$lib/services/content/paged_messages', () => ({
    PagedMessages: {
        createBefore: mocks.createPagedBefore,
        createThrough: mocks.createPagedThrough
    }
}));
vi.mock('$lib/stores/tasks/chat', () => ({ getChatTask: mocks.getChatTask }));
vi.mock('$lib/stores/tasks/command', () => ({
    getCommandTask: mocks.getCommandTask,
    createCommandTask: mocks.createTask,
    setCommandTaskComplete: mocks.completeTask,
    setCommandTaskError: mocks.errorTask,
    clearCommandTask: mocks.clearTask,
    notifyCommandTaskComplete: mocks.notifyComplete,
    notifyCommandTaskError: mocks.notifyError
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
vi.mock('$lib/template', () => ({
    runTemplate: mocks.runTemplate
}));
vi.mock('$lib/pipeline', () => ({ runPipeline: mocks.runPipeline }));
vi.mock('$lib/events', () => ({ emitEvent: mocks.emitEvent }));
vi.mock('$lib/workflow/agent/context', () => ({ toMessageContext: vi.fn(() => ({})) }));

const backgroundCommand = {
    id: 'command-1',
    sortOrder: 'a0',
    name: 'compact',
    description: '',
    workflow: {
        nodes: {
            sink: {
                id: 'sink',
                name: 'Sink',
                class: 'Sink' as const,
                position: { x: 0, y: 0 },
                collapsed: false,
                inputs: {},
                inputValues: {}
            }
        }
    }
};

describe('command task', () => {
    let finalParts: AgentPart[];

    beforeEach(() => {
        vi.clearAllMocks();
        finalParts = [];
        mocks.getChat.mockResolvedValue({
            id: 'chat-1',
            roomId: 'room-1',
            title: 'Chat',
            personas: { refs: { 'persona-1': { id: 'persona-1', sortOrder: 'a0' } }, folders: {} }
        });
        mocks.getRoom.mockResolvedValue({
            id: 'room-1',
            characters: {
                refs: { 'character-1': { id: 'character-1', sortOrder: 'a0' } },
                folders: {}
            }
        });
        mocks.getSettings.mockResolvedValue({ presetId: 'preset-1' });
        mocks.getCharacter.mockResolvedValue({ id: 'character-1', name: 'Character' });
        mocks.getPersona.mockResolvedValue({ id: 'persona-1', name: 'Persona' });
        mocks.getLastMessage.mockResolvedValue({ id: 'last-1', sortOrder: 'a0' });
        mocks.createMessage.mockResolvedValue({ id: 'message-1', sortOrder: 'b0' });
        mocks.getVariables.mockResolvedValue({});
        mocks.prepareSwipe.mockResolvedValue({
            message: { id: 'message-1', sortOrder: 'b0' },
            swipeId: 'swipe-1'
        });
        mocks.createPagedBefore.mockResolvedValue({ length: 1 });
        mocks.createPagedThrough.mockResolvedValue({ length: 1 });
        mocks.getChatTask.mockReturnValue(null);
        mocks.getCommandTask.mockReturnValue(null);
        mocks.runtimeStream.mockImplementation(async function* () {});
        mocks.updateMessageSwipe.mockImplementation(
            async (_messageId: string, _swipeId: string, changes: { parts: AgentPart[] }) => {
                finalParts = changes.parts;
            }
        );
        mocks.getMessage.mockImplementation(async () => ({
            id: 'message-1',
            swipes: { 'swipe-1': { parts: finalParts } }
        }));
        mocks.runTemplate.mockImplementation(async (value: string) => value);
        mocks.runPipeline.mockImplementation(async (_phase: string, _ctx: unknown, value: string) =>
            Promise.resolve(value)
        );
    });

    it('does not start while another command is generating in the chat slot', async () => {
        mocks.getCommandTask.mockReturnValue({ status: 'generating' });

        await expect(runCommand('chat-1', backgroundCommand, '')).rejects.toThrow(
            'Another chat task is already running'
        );

        expect(mocks.getChat).not.toHaveBeenCalled();
        expect(mocks.createTask).not.toHaveBeenCalled();
    });

    it('rechecks the chat slot after asynchronous preflight', async () => {
        mocks.getChatTask.mockReturnValueOnce(null).mockReturnValue({ status: 'generating' });

        await expect(runCommand('chat-1', backgroundCommand, '')).rejects.toThrow(
            'Another chat task is already running'
        );

        expect(mocks.getLastMessage).not.toHaveBeenCalled();
        expect(mocks.createTask).not.toHaveBeenCalled();
    });

    it('runs a workflow without Output as a background task without reserving a message', async () => {
        await runCommand('chat-1', backgroundCommand, 'now');

        expect(mocks.createMessage).not.toHaveBeenCalled();
        expect(mocks.createPagedThrough).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'last-1' })
        );
        expect(mocks.createTask).toHaveBeenCalledWith(
            'command-1',
            'compact',
            undefined,
            expect.any(AbortController),
            expect.objectContaining({ chatId: 'chat-1', title: '/compact' })
        );
        expect(mocks.createTask.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.getLastMessage.mock.invocationCallOrder[0]
        );
        expect(mocks.completeTask).toHaveBeenCalledWith('chat-1');
    });

    it('reserves one assistant message and streams every Output update into its swipe', async () => {
        const command = {
            ...backgroundCommand,
            workflow: {
                nodes: {
                    output: {
                        id: 'output',
                        name: 'Output',
                        class: 'Output' as const,
                        position: { x: 0, y: 0 },
                        collapsed: false,
                        inputs: {},
                        inputValues: {}
                    }
                }
            }
        };
        mocks.runtimeStream.mockImplementation(async function* () {
            yield serializeAgentParts([{ type: 'text', text: 'partial' }]);
            yield serializeAgentParts([{ type: 'text', text: 'complete' }]);
        });

        await runCommand('chat-1', command, '', {
            characterId: 'character-1',
            personaId: 'persona-1'
        });

        expect(mocks.createMessage).toHaveBeenCalledTimes(1);
        expect(mocks.createTask.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.createPagedBefore.mock.invocationCallOrder[0]
        );
        expect(mocks.createPagedBefore).toHaveBeenCalledWith('chat-1', 'b0');
        expect(mocks.updateMessageSwipe).toHaveBeenCalledTimes(3);
        expect(mocks.updateMessageSwipe).toHaveBeenNthCalledWith(1, 'message-1', 'swipe-1', {
            parts: [{ type: 'text', text: 'partial' }]
        });
        expect(mocks.updateMessageSwipe).toHaveBeenNthCalledWith(2, 'message-1', 'swipe-1', {
            parts: [{ type: 'text', text: 'complete' }]
        });
        expect(mocks.completeTask).toHaveBeenCalledWith('chat-1');
    });

    it('provides command name and source as local template macros', async () => {
        await runCommand('chat-1', backgroundCommand, 'the recent context');

        const options = mocks.runtimeOptions.mock.calls[0]?.[0] as {
            localMacros: Map<string, { run: (args: string[]) => string }>;
        };
        expect(options.localMacros.get('command')?.run([])).toBe('compact');
        expect(options.localMacros.get('source')?.run([])).toBe('the recent context');
    });

    it('records setup failures after task creation', async () => {
        mocks.createPagedThrough.mockRejectedValueOnce(new Error('Could not load history'));

        await runCommand('chat-1', backgroundCommand, '');

        expect(mocks.createTask).toHaveBeenCalledOnce();
        expect(mocks.errorTask).toHaveBeenCalledWith('chat-1', 'Could not load history');
        expect(mocks.notifyError).toHaveBeenCalledWith('compact', 'Could not load history');
    });

    it('validates output character and persona membership before creating a message', async () => {
        const command = {
            ...backgroundCommand,
            workflow: {
                nodes: {
                    output: {
                        id: 'output',
                        name: 'Output',
                        class: 'Output' as const,
                        position: { x: 0, y: 0 },
                        collapsed: false,
                        inputs: {},
                        inputValues: {}
                    }
                }
            }
        };
        mocks.getRoom.mockResolvedValue({
            id: 'room-1',
            characters: { refs: {}, folders: {} }
        });

        await expect(
            runCommand('chat-1', command, '', {
                characterId: 'character-1',
                personaId: 'persona-1'
            })
        ).rejects.toThrow('Character is not available: character-1');

        expect(mocks.createMessage).not.toHaveBeenCalled();
        expect(mocks.createTask).not.toHaveBeenCalled();

        mocks.getRoom.mockResolvedValue({
            id: 'room-1',
            characters: {
                refs: { 'character-1': { id: 'character-1', sortOrder: 'a0' } },
                folders: {}
            }
        });
        mocks.getChat.mockResolvedValue({
            id: 'chat-1',
            roomId: 'room-1',
            title: 'Chat',
            personas: { refs: {}, folders: {} }
        });

        await expect(
            runCommand('chat-1', command, '', {
                characterId: 'character-1',
                personaId: 'persona-1'
            })
        ).rejects.toThrow('Persona is not available: persona-1');

        expect(mocks.createMessage).not.toHaveBeenCalled();
        expect(mocks.createTask).not.toHaveBeenCalled();
    });
});
