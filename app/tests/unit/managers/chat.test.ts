import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    forkChat,
    getChatDefaultVariables,
    getChatVariable,
    getChatVariables,
    getChatVariablesBefore,
    setChatVariable,
    syncChatGreetings
} from '$lib/managers/chat';
import {
    createChat,
    createChatLorebook,
    createMessage,
    deleteMessage,
    getCharacter,
    getChat,
    getLastMessage,
    getMessage,
    getRoom,
    updateChat,
    updateMessage
} from '$lib/stores';
import { LorebookService, MessageService } from '$lib/services';
import { AppError } from '$lib/types/errors';
import type { Character, Chat, Lorebook, Message, Room } from '$lib/services';

vi.mock('$lib/stores', () => ({
    createChat: vi.fn(),
    createChatLorebook: vi.fn(),
    createMessage: vi.fn(),
    deleteMessage: vi.fn(),
    getActivePreset: vi.fn(),
    getCharacter: vi.fn(),
    getChat: vi.fn(),
    getLastMessage: vi.fn(),
    getMessage: vi.fn(),
    getRoom: vi.fn(),
    updateChat: vi.fn(),
    updateMessage: vi.fn()
}));

vi.mock('$lib/services', () => ({
    LorebookService: {
        listByOwner: vi.fn()
    },
    MessageService: {
        getMessagesBefore: vi.fn(),
        create: vi.fn()
    }
}));

describe('ChatManager', () => {
    const mockRoom: Room = {
        id: 'room-1',
        scopeType: 'user',
        scopeId: 'user-1',
        name: 'Test Room',
        chats: { refs: {}, folders: {} },
        characters: {
            refs: {
                'char-1': { id: 'char-1', sortOrder: 'a', enabled: true },
                'char-2': { id: 'char-2', sortOrder: 'b', enabled: true }
            },
            folders: {}
        }
    };
    const mockChat: Chat = {
        id: 'chat-1',
        roomId: 'room-1',
        scopeType: 'user',
        scopeId: 'user-1',
        title: 'Test Chat',
        chatNote: '',
        messageCount: 0,
        lorebooks: { refs: {}, folders: {} },
        personas: { refs: {}, folders: {} },
        inlays: { refs: {}, folders: {} }
    };
    const charOne: Character = {
        id: 'char-1',
        scopeType: 'user',
        scopeId: 'user-1',
        name: 'Alpha',
        description: '',
        characterNote: '',
        backgroundHTML: '',
        messageCSS: '',
        greetings: { greet1: { id: 'greet1', content: 'Hello', sortOrder: 'a' } },
        defaultVariables: { mood: 'calm', shared: 'alpha' },
        allowLowLevel: false,
        modules: { refs: {}, folders: {} },
        lorebooks: { refs: {}, folders: {} },
        scripts: { refs: {}, folders: {} },
        charjs: { refs: {}, folders: {} },
        assets: { refs: {}, folders: {} }
    };
    const charTwo: Character = {
        ...charOne,
        id: 'char-2',
        name: 'Beta',
        greetings: { greet2: { id: 'greet2', content: 'Yo', sortOrder: 'b' } },
        defaultVariables: { shared: 'beta', energy: 'high' }
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getChat).mockResolvedValue(mockChat);
        vi.mocked(getRoom).mockResolvedValue(mockRoom);
        vi.mocked(getCharacter).mockImplementation(async (id: string) => {
            if (id === 'char-1') return charOne;
            if (id === 'char-2') return charTwo;
            return null;
        });
    });

    describe('syncChatGreetings', () => {
        it('creates one greeting message with enabled character greeting swipes', async () => {
            vi.mocked(getLastMessage).mockResolvedValue(null);
            vi.mocked(createMessage).mockResolvedValue({ id: 'msg-1' } as Message);

            await syncChatGreetings('chat-1');

            expect(createMessage).toHaveBeenCalledWith(
                'chat-1',
                expect.objectContaining({
                    role: 'assistant',
                    activeSwipeId: 'greet1',
                    swipes: {
                        greet1: expect.objectContaining({
                            id: 'greet1',
                            content: 'Hello',
                            speakerId: 'char-1',
                            speakerName: 'Alpha',
                            variables: { mood: 'calm', shared: 'beta', energy: 'high' }
                        }),
                        greet2: expect.objectContaining({
                            id: 'greet2',
                            content: 'Yo',
                            speakerId: 'char-2',
                            speakerName: 'Beta'
                        })
                    }
                })
            );
            expect(updateChat).toHaveBeenCalledWith('chat-1', {
                greetingMessageId: 'msg-1',
                lastMessageId: 'msg-1'
            });
        });

        it('ignores disabled characters when building greeting swipes', async () => {
            vi.mocked(getLastMessage).mockResolvedValue(null);
            vi.mocked(getRoom).mockResolvedValue({
                ...mockRoom,
                characters: {
                    refs: {
                        'char-1': { id: 'char-1', sortOrder: 'a', enabled: true },
                        'char-2': { id: 'char-2', sortOrder: 'b', enabled: false }
                    },
                    folders: {}
                }
            });
            vi.mocked(createMessage).mockResolvedValue({ id: 'msg-1' } as Message);

            await syncChatGreetings('chat-1');

            expect(createMessage).toHaveBeenCalledWith(
                'chat-1',
                expect.objectContaining({
                    swipes: {
                        greet1: expect.objectContaining({
                            speakerId: 'char-1',
                            speakerName: 'Alpha'
                        })
                    }
                })
            );
            expect(createMessage).not.toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    swipes: expect.objectContaining({
                        greet2: expect.anything()
                    })
                })
            );
        });

        it('updates an existing greeting message in-place and keeps active swipe when possible', async () => {
            const chat = { ...mockChat, greetingMessageId: 'msg-1', lastMessageId: 'msg-1' };
            const existingMessage = {
                id: 'msg-1',
                chatId: 'chat-1',
                scopeType: 'user',
                scopeId: 'user-1',
                sortOrder: 'a0',
                role: 'assistant',
                swipes: { greet2: { id: 'greet2', content: 'Old', createdAt: 2 } },
                activeSwipeId: 'greet2'
            } as Message;

            vi.mocked(getLastMessage).mockResolvedValue(existingMessage);
            vi.mocked(getChat).mockResolvedValue(chat);
            vi.mocked(getMessage).mockResolvedValue(existingMessage);

            await syncChatGreetings('chat-1');

            expect(updateMessage).toHaveBeenCalledWith(
                'msg-1',
                expect.objectContaining({
                    swipes: expect.objectContaining({
                        greet1: expect.objectContaining({ content: 'Hello' }),
                        greet2: expect.objectContaining({ content: 'Yo' })
                    }),
                    activeSwipeId: 'greet2'
                })
            );
        });

        it('does not sync after non-greeting messages exist', async () => {
            vi.mocked(getChat).mockResolvedValue({
                ...mockChat,
                greetingMessageId: 'msg-greeting',
                lastMessageId: 'msg-user'
            });

            await syncChatGreetings('chat-1');

            expect(createMessage).not.toHaveBeenCalled();
            expect(updateMessage).not.toHaveBeenCalled();
        });

        it('clears greeting message when no greetings exist', async () => {
            vi.mocked(getCharacter).mockResolvedValue({
                ...charOne,
                greetings: {}
            });
            vi.mocked(getChat).mockResolvedValue({
                ...mockChat,
                greetingMessageId: 'msg-1',
                lastMessageId: 'msg-1'
            });

            await syncChatGreetings('chat-1');

            expect(updateChat).toHaveBeenCalledWith('chat-1', {
                greetingMessageId: undefined,
                lastMessageId: undefined
            });
            expect(deleteMessage).toHaveBeenCalledWith('chat-1', 'msg-1');
        });
    });

    describe('Variables', () => {
        const lastMessage = {
            id: 'msg-last',
            chatId: 'chat-1',
            scopeType: 'user',
            scopeId: 'user-1',
            sortOrder: 'b',
            role: 'assistant',
            swipes: {
                s1: { id: 's1', content: '...', variables: { mood: 'tense' }, createdAt: 1 }
            },
            activeSwipeId: 's1'
        } as Message;

        it('merges enabled character defaults in room order', async () => {
            const variables = await getChatDefaultVariables('chat-1');

            expect(variables).toEqual({ mood: 'calm', shared: 'beta', energy: 'high' });
        });

        it('skips disabled and missing characters when merging defaults', async () => {
            vi.mocked(getRoom).mockResolvedValue({
                ...mockRoom,
                characters: {
                    refs: {
                        'char-2': { id: 'char-2', sortOrder: 'a', enabled: false },
                        missing: { id: 'missing', sortOrder: 'b', enabled: true },
                        'char-1': { id: 'char-1', sortOrder: 'c', enabled: true }
                    },
                    folders: {}
                }
            });

            const variables = await getChatDefaultVariables('chat-1');

            expect(variables).toEqual({ mood: 'calm', shared: 'alpha' });
        });

        it('returns chat variables from the last message over defaults', async () => {
            vi.mocked(getLastMessage).mockResolvedValue(lastMessage);

            const variables = await getChatVariables('chat-1');

            expect(variables).toEqual({ mood: 'tense', shared: 'beta', energy: 'high' });
        });

        it('returns variables before a sort order', async () => {
            vi.mocked(MessageService.getMessagesBefore).mockResolvedValue([lastMessage]);

            const variables = await getChatVariablesBefore('chat-1', 'c');

            expect(variables).toEqual({ mood: 'tense', shared: 'beta', energy: 'high' });
            expect(MessageService.getMessagesBefore).toHaveBeenCalledWith('chat-1', 'c', 1);
        });

        it('gets and sets a chat variable on the last active swipe', async () => {
            vi.mocked(getLastMessage).mockResolvedValue(lastMessage);

            await expect(getChatVariable('chat-1', 'mood')).resolves.toBe('tense');
            await setChatVariable('chat-1', 'mood', 'happy');

            expect(updateMessage).toHaveBeenCalledWith('msg-last', {
                swipes: {
                    s1: {
                        variables: { mood: 'happy' }
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
            vi.mocked(MessageService.create).mockResolvedValue({} as unknown as Message);
            vi.mocked(createChatLorebook).mockResolvedValue({} as unknown as Lorebook);
        });

        it('forks chat using room ownership', async () => {
            const newChatId = await forkChat('msg-2');

            expect(newChatId).toBe('new-chat-id');
            expect(createChat).toHaveBeenCalledWith(
                'room-1',
                expect.objectContaining({ title: 'Test Chat (Fork)' })
            );
            expect(MessageService.create).toHaveBeenCalledTimes(2);
            expect(updateChat).toHaveBeenCalledWith(
                'new-chat-id',
                expect.objectContaining({
                    messageCount: 2,
                    lastMessageId: undefined
                })
            );
            expect(createChatLorebook).toHaveBeenCalledWith(
                'new-chat-id',
                expect.objectContaining({ content: 'some content' })
            );
        });

        it('throws error if message is not found', async () => {
            vi.mocked(getMessage).mockRejectedValue(new AppError('NOT_FOUND', '...'));

            await expect(forkChat('msg-not-found')).rejects.toThrow(AppError);
        });
    });
});
