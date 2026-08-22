import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PagedMessages } from '$lib/services/content/paged_messages';
import { MessageService, type Message } from '$lib/services/content/message';

vi.mock('$lib/services/content/message', () => ({
    MessageService: {
        get: vi.fn(),
        countByChat: vi.fn(),
        countByChatBefore: vi.fn(),
        getMessagesAfter: vi.fn(),
        getMessagesBefore: vi.fn()
    }
}));

function makeMessage(index: number): Message {
    const swipeId = `swipe-${index}`;
    return {
        id: `msg-${index}`,
        chatId: 'chat-1',
        scopeType: 'user',
        scopeId: 'user-1',
        sortOrder: `a${index}`,
        role: 'user',
        activeSwipeId: swipeId,
        swipes: {
            [swipeId]: {
                id: swipeId,
                parts: [{ type: 'text', text: `message ${index}` }],
                createdAt: index
            }
        }
    };
}

function mockPages(messages: Message[]): void {
    vi.mocked(MessageService.getMessagesAfter).mockImplementation(
        async (_chatId, _cursorSortOrder, limit = 50, offset = 0) =>
            messages.slice(offset, offset + limit)
    );
    vi.mocked(MessageService.getMessagesBefore).mockImplementation(
        async (_chatId, cursorSortOrder, limit = 50, offset = 0) => {
            const cursor = cursorSortOrder ?? '\uffff';
            const boundedMessages =
                cursor === 'a-target'
                    ? messages
                    : messages.filter((message) => message.sortOrder < cursor);
            const end = boundedMessages.length - offset;
            const start = Math.max(0, end - limit);
            return boundedMessages.slice(start, end);
        }
    );
}

describe('PagedMessages', () => {
    const messages = Array.from({ length: 10 }, (_, index) => makeMessage(index));

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(MessageService.countByChat).mockResolvedValue(messages.length);
        vi.mocked(MessageService.countByChatBefore).mockResolvedValue(messages.length);
        vi.mocked(MessageService.get).mockImplementation(
            async (id) => messages.find((message) => message.id === id) ?? null
        );
        mockPages(messages);
    });

    it('creates a readonly view with the bounded chat message count', async () => {
        const paged = await PagedMessages.createBefore('chat-1', 'a-target', { pageSize: 4 });

        expect(paged.chatId).toBe('chat-1');
        expect(paged.pageSize).toBe(4);
        expect(paged.length).toBe(10);
        expect(paged.beforeSortOrder).toBe('a-target');
        expect(MessageService.countByChatBefore).toHaveBeenCalledWith('chat-1', 'a-target');
    });

    it('creates an inclusive view with the target at the normalized last index', async () => {
        vi.mocked(MessageService.countByChatBefore).mockResolvedValueOnce(6);

        const paged = await PagedMessages.createThrough(messages[6], { pageSize: 4 });

        expect(paged.length).toBe(7);
        await expect(paged.at(6)).resolves.toMatchObject({
            message: { id: 'msg-6' },
            index: 6
        });
        await expect(paged.at(-1)).resolves.toMatchObject({
            message: { id: 'msg-6' },
            index: 6
        });
    });

    it('slices the target after the paged messages without shifting the previous page', async () => {
        vi.mocked(MessageService.countByChatBefore).mockResolvedValueOnce(6);

        const paged = await PagedMessages.createThrough(messages[6], { pageSize: 4 });

        const result = await paged.slice(3, 7);

        expect(result.map((entry) => entry.message)).toEqual(messages.slice(3, 7));
        expect(result.map((entry) => entry.index)).toEqual([3, 4, 5, 6]);
        expect(MessageService.getMessagesBefore).toHaveBeenCalledWith('chat-1', 'a6', 2, 0);
    });

    it('refreshes the separately held target when its index is invalidated', async () => {
        vi.mocked(MessageService.countByChatBefore).mockResolvedValueOnce(6);
        const paged = await PagedMessages.createThrough(messages[6]);
        const updatedTarget: Message = {
            ...messages[6],
            swipes: {
                ...messages[6].swipes,
                [messages[6].activeSwipeId]: {
                    ...messages[6].swipes[messages[6].activeSwipeId],
                    parts: [{ type: 'text', text: 'updated target' }]
                }
            }
        };
        vi.mocked(MessageService.get).mockResolvedValue(updatedTarget);

        await paged.at(-1);
        paged.invalidate(6);

        await expect(paged.at(6)).resolves.toMatchObject({
            message: {
                id: 'msg-6',
                swipes: {
                    'swipe-6': { parts: [{ type: 'text', text: 'updated target' }] }
                }
            }
        });
        expect(MessageService.get).toHaveBeenCalledTimes(1);
    });

    it('supports an inclusive target with no preceding messages', async () => {
        vi.mocked(MessageService.countByChatBefore).mockResolvedValueOnce(0);
        const target = makeMessage(0);
        const paged = await PagedMessages.createThrough(target, { pageSize: 4 });

        await expect(paged.at(0)).resolves.toEqual({ message: target, index: 0 });
        await expect(paged.at(-1)).resolves.toEqual({ message: target, index: 0 });
        await expect(paged.toArray()).resolves.toEqual([{ message: target, index: 0 }]);
        expect(MessageService.get).not.toHaveBeenCalled();
        expect(MessageService.getMessagesAfter).not.toHaveBeenCalled();
        expect(MessageService.getMessagesBefore).not.toHaveBeenCalled();
    });

    it('reads positive and negative indexes', async () => {
        const paged = await PagedMessages.createBefore('chat-1', 'a-target', { pageSize: 4 });

        await expect(paged.at(0)).resolves.toMatchObject({ message: { id: 'msg-0' }, index: 0 });
        await expect(paged.at(5)).resolves.toMatchObject({ message: { id: 'msg-5' }, index: 5 });
        await expect(paged.at(-1)).resolves.toMatchObject({ message: { id: 'msg-9' }, index: 9 });
        await expect(paged.at(-10)).resolves.toMatchObject({ message: { id: 'msg-0' }, index: 0 });
        await expect(paged.at(10)).resolves.toBeNull();
        await expect(paged.at(-11)).resolves.toBeNull();
    });

    it('normalizes range indexes against the fixed view length', async () => {
        const paged = await PagedMessages.createBefore('chat-1', 'a-target', { pageSize: 4 });

        expect(paged.normalizeIndex(3.9)).toBe(3);
        expect(paged.normalizeIndex(-1)).toBe(9);
        expect(paged.normalizeIndex(-10)).toBe(0);
        expect(paged.normalizeIndex(-11)).toBe(0);
        expect(paged.normalizeIndex(10)).toBe(10);
        expect(paged.normalizeIndex(11)).toBe(10);
    });

    it('slices across page boundaries with negative bounds', async () => {
        const paged = await PagedMessages.createBefore('chat-1', 'a-target', { pageSize: 4 });

        const slice3_8 = await paged.slice(3, 8);
        expect(slice3_8.map((e) => e.message)).toEqual(messages.slice(3, 8));
        expect(slice3_8.map((e) => e.index)).toEqual([3, 4, 5, 6, 7]);

        const sliceNeg4 = await paged.slice(-4);
        expect(sliceNeg4.map((e) => e.message)).toEqual(messages.slice(6));
        expect(sliceNeg4.map((e) => e.index)).toEqual([6, 7, 8, 9]);

        const sliceNeg4_Neg1 = await paged.slice(-4, -1);
        expect(sliceNeg4_Neg1.map((e) => e.message)).toEqual(messages.slice(6, 9));
        expect(sliceNeg4_Neg1.map((e) => e.index)).toEqual([6, 7, 8]);

        await expect(paged.slice(8, 3)).resolves.toEqual([]);
    });

    it('caches loaded pages for the instance', async () => {
        const paged = await PagedMessages.createBefore('chat-1', 'a-target', { pageSize: 4 });

        await paged.at(5);
        await paged.at(7);
        expect(MessageService.getMessagesBefore).toHaveBeenCalledTimes(1);
        expect(MessageService.getMessagesBefore).toHaveBeenCalledWith('chat-1', 'a-target', 4, 2);

        paged.clear();
        await paged.at(5);
        expect(MessageService.getMessagesBefore).toHaveBeenCalledTimes(2);
    });

    it('invalidates only the page containing the requested index', async () => {
        const paged = await PagedMessages.createBefore('chat-1', 'a-target', { pageSize: 4 });

        await paged.at(1);
        await paged.at(5);
        paged.invalidate(5);
        await paged.at(1);
        await paged.at(5);

        expect(MessageService.getMessagesAfter).toHaveBeenCalledTimes(1);
        expect(MessageService.getMessagesBefore).toHaveBeenCalledTimes(2);
    });

    it('uses the cheaper stable direction for pages near either end', async () => {
        const paged = await PagedMessages.createBefore('chat-1', 'a-target', { pageSize: 4 });

        await paged.at(0);
        await paged.at(-1);

        expect(MessageService.getMessagesAfter).toHaveBeenCalledWith('chat-1', '', 4, 0);
        expect(MessageService.getMessagesBefore).toHaveBeenCalledWith('chat-1', 'a-target', 2, 0);
    });

    it('rejects invalid page sizes', async () => {
        await expect(
            PagedMessages.createBefore('chat-1', 'a-target', { pageSize: 0 })
        ).rejects.toThrow('Page size must be a positive integer');
    });
});
