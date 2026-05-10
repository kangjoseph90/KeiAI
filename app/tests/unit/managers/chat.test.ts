import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setGreetings, getChatVariable, setChatVariable, forkChat } from '$lib/managers/chat';
import {
    createChat,
    createChatLorebook,
    createMessage,
    deleteMessage,
    getChat,
    getMessage,
    updateChat,
    updateMessage
} from '$lib/stores';
import { LorebookService, MessageService } from '$lib/services';
import { AppError } from '$lib/types/errors';
import type { Chat, Message, Lorebook } from '$lib/services';

// Mock Stores
vi.mock('$lib/stores', () => ({
    createChat: vi.fn(),
    createChatLorebook: vi.fn(),
    createMessage: vi.fn(),
    deleteMessage: vi.fn(),
    getChat: vi.fn(),
    getMessage: vi.fn(),
    updateChat: vi.fn(),
    updateMessage: vi.fn()
}));

// Mock Services
vi.mock('$lib/services', () => ({
    LorebookService: {
        listByOwner: vi.fn()
    },
    MessageService: {
        getMessagesBefore: vi.fn()
    }
}));

describe('ChatManager', () => {
    const mockChat: Chat = {
        id: 'chat-1',
        characterId: 'char-1',
        title: 'Test Chat',
        chatNote: '',
        lorebooks: { refs: {}, folders: {} }
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('setGreetings', () => {
        it('should create a greeting message for an empty chat', async () => {
            vi.mocked(getChat).mockResolvedValue(mockChat);
            vi.mocked(createMessage).mockResolvedValue({ id: 'msg-1' } as Message);

            await setGreetings('chat-1', {
                '1': { id: '1', content: 'Hello', createdAt: 1 }
            });

            expect(createMessage).toHaveBeenCalledWith(
                'chat-1',
                expect.objectContaining({
                    role: 'assistant',
                    swipes: {
                        '1': expect.objectContaining({ content: 'Hello' })
                    }
                })
            );
            expect(updateChat).toHaveBeenCalledWith('chat-1', {
                greetingMessageId: 'msg-1',
                lastMessageId: 'msg-1'
            });
        });

        it('should update existing greeting message in-place', async () => {
            const chat = { ...mockChat, greetingMessageId: 'msg-1', lastMessageId: 'msg-1' };
            const existingMessage = {
                id: 'msg-1',
                chatId: 'chat-1',
                sortOrder: 'a0',
                role: 'assistant',
                swipes: { '1': { id: '1', content: 'Old', createdAt: 1 } },
                activeSwipeId: '1'
            } as Message;

            vi.mocked(getChat).mockResolvedValue(chat);
            vi.mocked(getMessage).mockResolvedValue(existingMessage);

            await setGreetings('chat-1', {
                '1': { id: '1', content: 'New', createdAt: 1 }
            });

            expect(updateMessage).toHaveBeenCalledWith(
                'msg-1',
                expect.objectContaining({
                    swipes: expect.objectContaining({
                        '1': expect.objectContaining({ content: 'New' })
                    })
                })
            );
        });

        it('should clear greeting when input is empty', async () => {
            const chat = { ...mockChat, greetingMessageId: 'msg-1', lastMessageId: 'msg-1' };
            vi.mocked(getChat).mockResolvedValue(chat);

            await setGreetings('chat-1', {});

            expect(updateChat).toHaveBeenCalledWith('chat-1', {
                greetingMessageId: undefined,
                lastMessageId: undefined
            });
            expect(deleteMessage).toHaveBeenCalledWith('chat-1', 'msg-1');
        });
    });

    describe('Variables', () => {
        it('should get a chat variable from the last message', async () => {
            const lastMessage = {
                id: 'msg-last',
                chatId: 'chat-1',
                sortOrder: 'a0',
                role: 'assistant',
                swipes: {
                    s1: { id: 's1', content: '...', variables: { key1: 'val1' }, createdAt: 1 }
                },
                activeSwipeId: 's1'
            } as Message;

            vi.mocked(getChat).mockResolvedValue({ ...mockChat, lastMessageId: 'msg-last' });
            vi.mocked(getMessage).mockResolvedValue(lastMessage);

            const val = await getChatVariable('chat-1', 'key1');
            expect(val).toBe('val1');
        });

        it('should set a chat variable on the last message', async () => {
            const lastMessage = {
                id: 'msg-last',
                chatId: 'chat-1',
                sortOrder: 'a0',
                role: 'assistant',
                swipes: {
                    s1: { id: 's1', content: '...', variables: {}, createdAt: 1 }
                },
                activeSwipeId: 's1'
            } as Message;

            vi.mocked(getChat).mockResolvedValue({ ...mockChat, lastMessageId: 'msg-last' });
            vi.mocked(getMessage).mockResolvedValue(lastMessage);

            await setChatVariable('chat-1', 'key2', 'val2');

            expect(updateMessage).toHaveBeenCalledWith('msg-last', {
                swipes: {
                    s1: {
                        variables: { key2: 'val2' }
                    }
                }
            });
        });
    });

    describe('forkChat', () => {
        const mockMessage = {
            id: 'msg-2',
            chatId: 'chat-1',
            sortOrder: 'b',
            role: 'assistant',
            swipes: { s1: { id: 's1', content: 'Fork me', createdAt: 2000 } },
            activeSwipeId: 's1'
        };
        const mockPrevMessage = {
            id: 'msg-1',
            chatId: 'chat-1',
            sortOrder: 'a',
            role: 'user',
            swipes: { s1: { id: 's1', content: 'Hello', createdAt: 1000 } },
            activeSwipeId: 's1'
        };
        const mockLorebook = {
            id: 'lb-1',
            ownerId: 'chat-1',
            keys: ['test'],
            content: 'some content'
        } as unknown as Lorebook;

        beforeEach(() => {
            vi.mocked(getMessage).mockResolvedValue(mockMessage as unknown as Message);
            vi.mocked(MessageService.getMessagesBefore).mockResolvedValue([
                mockPrevMessage
            ] as unknown as Message[]);
            vi.mocked(getChat).mockResolvedValue(mockChat);
            vi.mocked(createChat).mockResolvedValue({ ...mockChat, id: 'new-chat-id' });
            vi.mocked(LorebookService.listByOwner).mockResolvedValue([mockLorebook]);
            vi.mocked(createMessage).mockResolvedValue({} as unknown as Message);
            vi.mocked(createChatLorebook).mockResolvedValue({} as unknown as Lorebook);
        });

        it('should fork chat successfully using store CRUDs', async () => {
            const newChatId = await forkChat('msg-2');

            expect(newChatId).toBe('new-chat-id');
            // Verifies high-level store CRUDs were called instead of services directly
            expect(createChat).toHaveBeenCalledWith(
                'char-1',
                expect.objectContaining({ title: 'Test Chat (Fork)' })
            );
            expect(createMessage).toHaveBeenCalledTimes(2);
            expect(createChatLorebook).toHaveBeenCalledWith(
                'new-chat-id',
                expect.objectContaining({ content: 'some content' })
            );
        });

        it('should throw error if message is not found (propagated from getMessage)', async () => {
            vi.mocked(getMessage).mockRejectedValue(new AppError('NOT_FOUND', '...'));

            await expect(forkChat('msg-not-found')).rejects.toThrow(AppError);
        });
    });
});
