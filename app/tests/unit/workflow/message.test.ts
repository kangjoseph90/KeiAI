import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message, PagedMessages } from '$lib/services';
import type {
    GetHistoryNode,
    SetHistoryNode,
    SetImageAttachmentsNode,
    WorkflowInput,
    WorkflowOutput
} from '$lib/workflow';
import {
    executeGetHistoryNode,
    executeSetHistoryNode,
    executeSetImageAttachmentsNode
} from '$lib/workflow/history/execute';

const mocks = vi.hoisted(() => ({
    getAppSettings: vi.fn(),
    getChat: vi.fn(),
    updateMessageSwipe: vi.fn()
}));

vi.mock('$lib/stores', () => ({
    getAppSettings: mocks.getAppSettings,
    getChat: mocks.getChat,
    updateMessageSwipe: mocks.updateMessageSwipe
}));

function input(value: string | number): WorkflowInput {
    return {
        subscribe: vi.fn(),
        done: Promise.resolve({ status: 'value', value })
    };
}

function output(): { port: WorkflowOutput; emit: ReturnType<typeof vi.fn> } {
    const emit = vi.fn();
    return { port: { emit }, emit };
}

function message(): Message {
    return {
        id: 'message-1',
        chatId: 'chat-1',
        scopeType: 'user',
        scopeId: 'user-1',
        sortOrder: 'a0',
        role: 'assistant',
        activeSwipeId: 'swipe-1',
        swipes: {
            'swipe-1': {
                id: 'swipe-1',
                createdAt: 1,
                parts: [{ type: 'text', text: 'hello' }]
            }
        }
    };
}

function history(target: Message): {
    messages: PagedMessages;
    at: ReturnType<typeof vi.fn>;
    invalidate: ReturnType<typeof vi.fn>;
} {
    const at = vi.fn().mockResolvedValue({ message: target, index: 4 });
    const invalidate = vi.fn();
    return {
        messages: { at, invalidate } as unknown as PagedMessages,
        at,
        invalidate
    };
}

describe('workflow message nodes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('serializes the active swipe when reading history', async () => {
        const target = message();
        const paged = history(target);
        const result = output();
        const node: GetHistoryNode = {
            id: 'get',
            name: 'Get History',
            class: 'GetHistory',
            position: { x: 0, y: 0 },
            collapsed: false,
            inputs: { index: null },
            inputValues: { index: -1 }
        };

        await executeGetHistoryNode({
            node,
            inputs: { index: input(-1) },
            output: result.port,
            emitRuntimeOutput: vi.fn(),
            messages: paged.messages,
            signal: new AbortController().signal
        });

        expect(paged.at).toHaveBeenCalledWith(-1);
        expect(result.emit).toHaveBeenCalledWith(0, {
            status: 'value',
            value: 'hello'
        });
    });

    it('writes deserialized history and invalidates only its resolved page index', async () => {
        const target = message();
        const paged = history(target);
        const node: SetHistoryNode = {
            id: 'set',
            name: 'Set History',
            class: 'SetHistory',
            position: { x: 0, y: 0 },
            collapsed: false,
            inputs: { index: null, content: null },
            inputValues: { index: -1, content: '' }
        };

        await executeSetHistoryNode({
            node,
            inputs: {
                index: input(-1),
                content: input('updated<|inlay|>["asset-1"]<|/inlay|>')
            },
            output: output().port,
            emitRuntimeOutput: vi.fn(),
            messages: paged.messages,
            signal: new AbortController().signal
        });

        expect(mocks.updateMessageSwipe).toHaveBeenCalledWith('message-1', 'swipe-1', {
            parts: [
                { type: 'text', text: 'updated' },
                { type: 'inlay', ids: ['asset-1'] }
            ]
        });
        expect(paged.invalidate).toHaveBeenCalledWith(4);
    });

    it('stores only image inlays in image attachments', async () => {
        const target = message();
        const paged = history(target);
        mocks.getChat.mockResolvedValue({
            id: 'chat-1',
            inlays: {
                refs: {
                    image: { mimeType: 'image/png' },
                    audio: { mimeType: 'audio/wav' }
                }
            }
        });
        const node: SetImageAttachmentsNode = {
            id: 'set-images',
            name: 'Set Image Attachments',
            class: 'SetImageAttachments',
            position: { x: 0, y: 0 },
            collapsed: false,
            inputs: { index: null, content: null },
            inputValues: { index: -1, content: '' }
        };

        await executeSetImageAttachmentsNode({
            node,
            inputs: {
                index: input(-1),
                content: input('<|inlay|>["audio","image"]<|/inlay|>')
            },
            output: output().port,
            emitRuntimeOutput: vi.fn(),
            ctx: { chatId: 'chat-1' },
            messages: paged.messages,
            signal: new AbortController().signal
        });

        expect(mocks.updateMessageSwipe).toHaveBeenCalledWith('message-1', 'swipe-1', {
            imageAttachments: ['image']
        });
        expect(paged.invalidate).toHaveBeenCalledWith(4);
    });
});
