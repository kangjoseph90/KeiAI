import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
    loadInitialMessages,
    loadOlderMessages,
    loadNewerMessages,
    createMessage,
    updateMessage,
    deleteMessage,
    getMessage
} from '$lib/stores/content/message';
import { messages, roomChats, activeChatId, translations } from '$lib/stores/state';
import {
    MessageService,
    ChatService,
    TranslationService,
    type Message,
    type Chat
} from '$lib/services';
import { getLastContentText } from '$lib/workflow/agent/llm';

// Mock Services
vi.mock('$lib/services', () => ({
    MessageService: {
        getMessagesBefore: vi.fn(),
        getMessagesAfter: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        get: vi.fn(),
        countByChat: vi.fn(),
        countByChatBefore: vi.fn()
    },
    ChatService: {
        get: vi.fn(),
        update: vi.fn()
    },
    TranslationService: {
        listByMessages: vi.fn()
    }
}));

describe('Message Store', () => {
    const mockChatId = 'chat-1';
    const mockMessage: Message = {
        id: 'msg-1',
        chatId: mockChatId,
        scopeType: 'user',
        scopeId: 'user-1',
        role: 'user',
        swipes: { s1: { id: 's1', parts: [{ type: 'content', text: 'Hello' }], createdAt: 1000 } },
        activeSwipeId: 's1',
        sortOrder: 'a'
    };

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset via messages (the EntityStore)
        messages.clear();
        translations.clear();
        roomChats.clear();
        roomChats.set(mockChatId, {
            id: mockChatId,
            roomId: 'room-1',
            scopeType: 'user',
            messageCount: 1
        } as Chat);
        activeChatId.set(mockChatId);
        vi.mocked(ChatService.update).mockResolvedValue({
            id: mockChatId,
            roomId: 'room-1',
            lastMessageId: mockMessage.id,
            messageCount: 1
        } as Chat);
        vi.mocked(ChatService.get).mockResolvedValue({
            id: mockChatId,
            roomId: 'room-1',
            lastMessageId: mockMessage.id,
            messageCount: 1
        } as Chat);
        vi.mocked(TranslationService.listByMessages).mockResolvedValue([]);
    });

    describe('loadInitialMessages', () => {
        it('should load and set messages if activeChatId matches', async () => {
            const mockMsgs = [mockMessage];
            vi.mocked(MessageService.getMessagesBefore).mockResolvedValue(mockMsgs);

            await loadInitialMessages(mockChatId);

            expect(MessageService.getMessagesBefore).toHaveBeenCalled();
            expect(get(messages)).toEqual(mockMsgs);
        });

        it('should not update store if activeChatId has changed', async () => {
            roomChats.set('other-chat', { id: 'other-chat', roomId: 'room-1' } as Chat);
            activeChatId.set('other-chat');
            vi.mocked(MessageService.getMessagesBefore).mockResolvedValue([mockMessage]);

            await loadInitialMessages(mockChatId);

            expect(get(messages)).toEqual([]);
        });
    });

    describe('Pagination', () => {
        it('loadOlderMessages should prepend older messages (sorted via derived)', async () => {
            // sortOrder 'a' — existing message
            messages.setAll([mockMessage]);
            const olderMsg = { ...mockMessage, id: 'msg-old', sortOrder: '0' };
            vi.mocked(MessageService.getMessagesBefore).mockResolvedValue([olderMsg]);

            await loadOlderMessages(mockChatId);

            expect(MessageService.getMessagesBefore).toHaveBeenCalledWith(mockChatId, 'a', 50);
            // derived store sorts by sortOrder: '0' < 'a'
            expect(get(messages)).toEqual([olderMsg, mockMessage]);
        });

        it('loadNewerMessages should append newer messages (sorted via derived)', async () => {
            messages.setAll([mockMessage]);
            const newerMsg = { ...mockMessage, id: 'msg-new', sortOrder: 'b' };
            vi.mocked(MessageService.getMessagesAfter).mockResolvedValue([newerMsg]);

            await loadNewerMessages(mockChatId);

            expect(MessageService.getMessagesAfter).toHaveBeenCalledWith(mockChatId, 'a', 50);
            // derived store sorts by sortOrder: 'a' < 'b'
            expect(get(messages)).toEqual([mockMessage, newerMsg]);
        });
    });

    describe('getMessage', () => {
        it('should return from store cache without hitting IDB', async () => {
            messages.setAll([mockMessage]);

            const result = await getMessage('msg-1');

            expect(result).toEqual(mockMessage);
            expect(MessageService.get).not.toHaveBeenCalled();
        });

        it('should fall back to IDB if not in cache', async () => {
            vi.mocked(MessageService.get).mockResolvedValue(mockMessage);

            const result = await getMessage('msg-1');

            expect(result).toEqual(mockMessage);
            expect(MessageService.get).toHaveBeenCalledWith('msg-1');
        });

        it('should return null if not in cache and not in IDB', async () => {
            vi.mocked(MessageService.get).mockResolvedValue(null);

            const result = await getMessage('missing-id');
            expect(result).toBeNull();
        });
    });

    describe('createMessage', () => {
        it('should create message and add to store', async () => {
            const newMessage = { ...mockMessage, id: 'new-id' };

            vi.mocked(MessageService.create).mockResolvedValue(newMessage);
            // getLastMessage calls getMessagesBefore when no lastMessageId
            vi.mocked(MessageService.getMessagesBefore).mockResolvedValue([]);
            roomChats.setAll([
                { id: mockChatId, roomId: 'room-1', scopeType: 'user', messageCount: 0 } as Chat
            ]);

            await createMessage(mockChatId, {
                swipes: {
                    s1: {
                        id: 's1',
                        parts: [{ type: 'content', text: 'New message content' }],
                        createdAt: Date.now()
                    }
                },
                activeSwipeId: 's1'
            });

            expect(get(messages)).toContainEqual(newMessage);
            expect(MessageService.create).toHaveBeenCalledWith(
                mockChatId,
                expect.any(Object),
                undefined,
                'user'
            );
            expect(ChatService.update).toHaveBeenCalledWith(mockChatId, {
                lastMessageId: newMessage.id,
                messageCount: 1
            });
        });
    });

    describe('updateMessage', () => {
        it('should update message swipes in messages', async () => {
            messages.setAll([mockMessage]);
            const updatedMsg: Message = {
                ...mockMessage,
                swipes: {
                    s1: { id: 's1', parts: [{ type: 'content', text: 'Updated' }], createdAt: 2000 }
                }
            };
            vi.mocked(MessageService.update).mockResolvedValue(updatedMsg);

            await updateMessage('msg-1', {
                swipes: {
                    s1: { id: 's1', parts: [{ type: 'content', text: 'Updated' }], createdAt: 2000 }
                }
            });

            expect(getLastContentText(get(messages)[0].swipes['s1'].parts)).toBe('Updated');
            // O(1) lookup: verify EntityStore contains updated value
            expect(getLastContentText(messages.get('msg-1')?.swipes['s1'].parts ?? [])).toBe(
                'Updated'
            );
        });
    });

    describe('deleteMessage', () => {
        it('should remove message from messages', async () => {
            messages.setAll([mockMessage]);
            vi.mocked(MessageService.delete).mockResolvedValue(undefined);

            await deleteMessage(mockChatId, 'msg-1');

            expect(get(messages)).toHaveLength(0);
            expect(messages.has('msg-1')).toBe(false);
            expect(MessageService.delete).toHaveBeenCalledWith('msg-1');
        });
    });
});
