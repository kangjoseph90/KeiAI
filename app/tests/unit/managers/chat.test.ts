import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setGreetings, getChatVariable, setChatVariable } from '$lib/managers/chat';
import {
    getChat,
    updateChat,
    getMessage,
    createMessage,
    updateMessage,
    deleteMessage
} from '$lib/stores';
import { ChatService, MessageService } from '$lib/services';
import type { Chat, Message } from '$lib/services';

// Mock Stores
vi.mock('$lib/stores', () => ({
    getChat: vi.fn(),
    updateChat: vi.fn(),
    getMessage: vi.fn(),
    createMessage: vi.fn(),
    updateMessage: vi.fn(),
    deleteMessage: vi.fn()
}));

// Mock Services (some managers might call services directly if needed, though they should use stores)
vi.mock('$lib/services', () => ({
    ChatService: {
        update: vi.fn(),
        get: vi.fn()
    },
    MessageService: {
        create: vi.fn(),
        update: vi.fn(),
        get: vi.fn(),
        delete: vi.fn()
    },
    AuthService: {
        isPbConnected: vi.fn(() => false),
        onPbAuthChange: vi.fn()
    }
}));

describe('ChatManager', () => {
    const mockChat: Chat = {
        id: 'chat-1',
        characterId: 'char-1',
        title: 'Test Chat',
        chatNote: '',
        lorebookRefs: [],
        folders: {}
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
});
