import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeFileReadNode, executeFileWriteNode } from '$lib/workflow/file/execute';
import type { WorkflowInput, WorkflowNodeEvent, WorkflowOutput } from '$lib/workflow';

const mocks = vi.hoisted(() => ({
    getByPath: vi.fn(),
    upsert: vi.fn(),
    getRoom: vi.fn(),
    getChat: vi.fn(),
    getActiveSession: vi.fn()
}));

vi.mock('$lib/services/content/file', () => ({
    FileService: {
        getByPath: mocks.getByPath,
        upsert: mocks.upsert
    }
}));

vi.mock('$lib/services/content/room', () => ({
    RoomService: { get: mocks.getRoom }
}));

vi.mock('$lib/services/content/chat', () => ({
    ChatService: { get: mocks.getChat }
}));

vi.mock('$lib/services/session', () => ({
    getActiveSession: mocks.getActiveSession
}));

describe('workflow file executors', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getActiveSession.mockReturnValue({ userId: 'user-1' });
        mocks.getRoom.mockResolvedValue({ id: 'room-1', scopeType: 'user' });
        mocks.getChat.mockResolvedValue({ id: 'chat-1', scopeType: 'room' });
        mocks.upsert.mockResolvedValue(undefined);
    });

    it('reads once and pushes the stored content once', async () => {
        mocks.getByPath.mockResolvedValue({ content: 'saved content' });

        const { output, events } = capture();

        await executeFileReadNode({
            node: {
                id: 'read',
                name: 'Read',
                class: 'FileRead',
                position: { x: 0, y: 0 },
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
        expect(mocks.getByPath).toHaveBeenCalledOnce();
        expect(mocks.getByPath).toHaveBeenCalledWith('chat', 'chat-1', 'dynamic.txt');
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
        expect(mocks.upsert).toHaveBeenCalledOnce();
        expect(mocks.upsert).toHaveBeenCalledWith(
            'room',
            'room-1',
            'result.txt',
            'final content',
            'user'
        );
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
