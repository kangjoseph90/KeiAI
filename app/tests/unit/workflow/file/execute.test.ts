import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeFileReadNode, executeFileWriteNode } from '$lib/workflow/file/execute';
import type { WorkflowInput, WorkflowNodeEvent, WorkflowOutput } from '$lib/workflow';

const mocks = vi.hoisted(() => ({
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    getRoom: vi.fn(),
    updateRoom: vi.fn(),
    getChat: vi.fn(),
    updateChat: vi.fn()
}));

vi.mock('$lib/stores/content/settings', () => ({
    getAppSettings: mocks.getSettings,
    saveGlobalFile: (file: unknown) =>
        mocks.updateSettings({
            files: { refs: { [(file as { id: string }).id]: file } }
        })
}));

vi.mock('$lib/stores/content/room', () => ({
    getRoom: mocks.getRoom,
    saveRoomFile: (roomId: string, file: unknown) =>
        mocks.updateRoom(roomId, { files: { refs: { [(file as { id: string }).id]: file } } })
}));

vi.mock('$lib/stores/content/chat', () => ({
    getChat: mocks.getChat,
    saveChatFile: (chatId: string, file: unknown) =>
        mocks.updateChat(chatId, { files: { refs: { [(file as { id: string }).id]: file } } })
}));

vi.mock('$lib/utils/id', () => ({
    generateId: () => 'file-1'
}));

vi.mock('$lib/utils/ordering', () => ({
    generateSortOrder: () => 'a0',
    listItems: <T>(config: { refs: Record<string, T> }) => Object.values(config.refs)
}));

describe('workflow file executors', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getSettings.mockResolvedValue({ files: { refs: {}, folders: {} } });
        mocks.getRoom.mockResolvedValue({
            id: 'room-1',
            files: { refs: {}, folders: {} }
        });
        mocks.getChat.mockResolvedValue({
            id: 'chat-1',
            files: {
                refs: {
                    stored: {
                        id: 'stored',
                        sortOrder: 'a0',
                        path: 'dynamic.txt',
                        content: 'saved content'
                    }
                },
                folders: {}
            }
        });
    });

    it('reads once and pushes the stored content once', async () => {
        const { output, events } = capture();

        await executeFileReadNode({
            node: {
                id: 'read',
                name: 'Read',
                class: 'FileRead',
                position: { x: 0, y: 0 },
                collapsed: false,
                namespace: 'chat',
                inputs: { path: { sourceNode: 'path', sourcePort: 0 } },
                inputValues: { path: 'fallback.txt' }
            },
            inputs: { path: input('dynamic.txt') },
            ctx: { chatId: 'chat-1' },
            output,
            emitRuntimeOutput: () => undefined,
            signal: new AbortController().signal
        });

        expect(events).toEqual([{ status: 'value', value: 'saved content' }]);
        expect(mocks.getChat).toHaveBeenCalledWith('chat-1');
    });

    it('waits for final content, writes once, and pushes once', async () => {
        const content = input('final content');

        const { output, events } = capture();

        await executeFileWriteNode({
            node: {
                id: 'write',
                name: 'Write',
                class: 'FileWrite',
                position: { x: 0, y: 0 },
                collapsed: false,
                namespace: 'room',
                inputs: { path: null, content: { sourceNode: 'agent', sourcePort: 0 } },
                inputValues: { path: 'result.txt', content: '' }
            },
            inputs: { path: input('result.txt'), content },
            ctx: { roomId: 'room-1' },
            output,
            emitRuntimeOutput: () => undefined,
            signal: new AbortController().signal
        });

        expect(events).toEqual([]);
        expect(content.doneCount).toBe(1);
        expect(mocks.updateRoom).toHaveBeenCalledWith('room-1', {
            files: {
                refs: {
                    'file-1': {
                        path: 'result.txt',
                        content: 'final content',
                        id: 'file-1',
                        sortOrder: 'a0'
                    }
                }
            }
        });
    });

    it('stores global files on settings', async () => {
        const { output } = capture();

        await executeFileWriteNode({
            node: {
                id: 'write-global',
                name: 'Write Global',
                class: 'FileWrite',
                position: { x: 0, y: 0 },
                collapsed: false,
                namespace: 'global',
                inputs: { path: null, content: null },
                inputValues: { path: 'memory.txt', content: 'remember this' }
            },
            inputs: { path: input('memory.txt'), content: input('remember this') },
            output,
            emitRuntimeOutput: () => undefined,
            signal: new AbortController().signal
        });

        expect(mocks.updateSettings).toHaveBeenCalledWith({
            files: {
                refs: {
                    'file-1': {
                        path: 'memory.txt',
                        content: 'remember this',
                        id: 'file-1',
                        sortOrder: 'a0'
                    }
                }
            }
        });
    });
});

function input(content: string): WorkflowInput & { doneCount: number } {
    let doneCount = 0;
    return {
        subscribe: () => undefined,
        get done(): Promise<WorkflowNodeEvent> {
            doneCount += 1;
            return Promise.resolve({ status: 'value', value: content });
        },
        get doneCount(): number {
            return doneCount;
        }
    };
}

function capture(): {
    output: WorkflowOutput;
    events: WorkflowNodeEvent[];
} {
    const events: WorkflowNodeEvent[] = [];
    const output = {
        emit: (_port: number, event: WorkflowNodeEvent) => events.push(event)
    };
    return { output, events };
}
