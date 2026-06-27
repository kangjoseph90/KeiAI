import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeFileReadNode, executeFileWriteNode } from '$lib/workflow/file/execute';
import type { WorkflowInputStream } from '$lib/workflow';

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

    it('reads once and yields the stored content once', async () => {
        mocks.getByPath.mockResolvedValue({ content: 'saved content' });

        const states = await collect(
            executeFileReadNode({
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
                signal: new AbortController().signal
            })
        );

        expect(states).toEqual([
            { content: 'saved content', type: 'string', value: 'saved content' }
        ]);
        expect(mocks.getByPath).toHaveBeenCalledOnce();
        expect(mocks.getByPath).toHaveBeenCalledWith('chat', 'chat-1', 'dynamic.txt');
    });

    it('waits for final content, writes once, and yields once', async () => {
        const content = input('final content');

        const states = await collect(
            executeFileWriteNode({
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
                signal: new AbortController().signal
            })
        );

        expect(states).toEqual([
            { content: 'final content', type: 'string', value: 'final content' }
        ]);
        expect(content.final).toHaveBeenCalledOnce();
        expect(content.stream).not.toHaveBeenCalled();
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

function input(content: string): WorkflowInputStream {
    return {
        stream: vi.fn(() => emptyStream()),
        final: vi.fn(async () => content)
    };
}

async function* emptyStream() {}

async function collect(stream: AsyncIterable<{ content: string; type: string; value: unknown }>) {
    const states: Array<{ content: string; type: string; value: unknown }> = [];
    for await (const state of stream) states.push(state);
    return states;
}
