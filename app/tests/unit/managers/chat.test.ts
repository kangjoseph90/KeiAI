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
    getActivePreset,
    getCharacter,
    getActiveModuleIds,
    getChat,
    getLastMessage,
    getMessage,
    getModule,
    getRoom,
    updateChat,
    updateMessage
} from '$lib/stores';
import { LorebookService, MessageService } from '$lib/services';
import { AppError } from '$lib/types/errors';
import type { Character, Chat, Lorebook, Message, Module, Preset, Room } from '$lib/services';

vi.mock('$lib/stores', () => ({
    createChat: vi.fn(),
    createChatLorebook: vi.fn(),
    createMessage: vi.fn(),
    deleteMessage: vi.fn(),
    getActivePreset: vi.fn(),
    getActiveModuleIds: vi.fn(),
    getCharacter: vi.fn(),
    getChat: vi.fn(),
    getLastMessage: vi.fn(),
    getMessage: vi.fn(),
    getModule: vi.fn(),
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
                'char-1': { id: 'char-1', sortOrder: 'a' },
                'char-2': { id: 'char-2', sortOrder: 'b' }
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
    const globalModule: Module = {
        id: 'mod-global',
        name: 'Global Module',
        description: '',
        backgroundHTML: '',
        messageCSS: '',
        defaultVariables: { mood: 'module-calm', shared: 'global-module', moduleOnly: 'yes' },
        toggles: { refs: {}, folders: {} },
        allowLowLevel: false,
        lorebooks: { refs: {}, folders: {} },
        scripts: { refs: {}, folders: {} },
        charjs: { refs: {}, folders: {} },
        assets: { refs: {}, folders: {} }
    };
    const characterModule: Module = {
        ...globalModule,
        id: 'mod-character',
        name: 'Character Module',
        defaultVariables: { shared: 'character-module', characterModuleOnly: 'yes' }
    };
    const mockPreset: Preset = {
        id: 'preset-1',
        name: 'Preset',
        description: '',
        models: {},
        parameters: {},
        chatWorkflow: { nodes: {} },
        defaultVariables: { mood: 'preset-calm', shared: 'preset', presetOnly: 'yes' },
        toggles: { refs: {}, folders: {} },
        scripts: { refs: {}, folders: {} }
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getActivePreset).mockReturnValue(null);
        vi.mocked(getChat).mockResolvedValue(mockChat);
        vi.mocked(getRoom).mockResolvedValue(mockRoom);
        vi.mocked(getCharacter).mockImplementation(async (id: string) => {
            if (id === 'char-1') return charOne;
            if (id === 'char-2') return charTwo;
            return null;
        });
        vi.mocked(getActiveModuleIds).mockResolvedValue(new Set());
        vi.mocked(getModule).mockResolvedValue(null);
    });

    describe('syncChatGreetings', () => {
        it('creates one greeting message with attached character greeting swipes', async () => {
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
                            parts: [{ type: 'content', text: 'Hello' }],
                            speakerId: 'char-1',
                            speakerName: 'Alpha',
                            variables: { mood: 'calm', shared: 'beta', energy: 'high' }
                        }),
                        greet2: expect.objectContaining({
                            id: 'greet2',
                            parts: [{ type: 'content', text: 'Yo' }],
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

        it('builds greeting swipes only for attached characters', async () => {
            vi.mocked(getLastMessage).mockResolvedValue(null);
            vi.mocked(getRoom).mockResolvedValue({
                ...mockRoom,
                characters: {
                    refs: {
                        'char-1': { id: 'char-1', sortOrder: 'a' }
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
                swipes: {
                    greet2: {
                        id: 'greet2',
                        parts: [{ type: 'content', text: 'Old' }],
                        createdAt: 2
                    }
                },
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
                        greet1: expect.objectContaining({
                            parts: [{ type: 'content', text: 'Hello' }]
                        }),
                        greet2: expect.objectContaining({
                            parts: [{ type: 'content', text: 'Yo' }]
                        })
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
                s1: {
                    id: 's1',
                    parts: [{ type: 'content', text: '...' }],
                    variables: { mood: 'tense' },
                    createdAt: 1
                }
            },
            activeSwipeId: 's1'
        } as Message;

        it('merges preset, active module, and character defaults in specificity order', async () => {
            vi.mocked(getActivePreset).mockReturnValue(mockPreset);
            vi.mocked(getActiveModuleIds).mockImplementation(async (characterId?: string) => {
                if (characterId === 'char-1') return new Set(['mod-global', 'mod-character']);
                if (characterId === 'char-2') return new Set(['mod-global']);
                return new Set();
            });
            vi.mocked(getModule).mockImplementation(async (id: string) => {
                if (id === 'mod-global') return globalModule;
                if (id === 'mod-character') return characterModule;
                return null;
            });

            const variables = await getChatDefaultVariables('chat-1');

            expect(variables).toEqual({
                mood: 'calm',
                shared: 'beta',
                presetOnly: 'yes',
                moduleOnly: 'yes',
                characterModuleOnly: 'yes',
                energy: 'high'
            });
        });

        it('skips missing characters when merging defaults', async () => {
            vi.mocked(getRoom).mockResolvedValue({
                ...mockRoom,
                characters: {
                    refs: {
                        missing: { id: 'missing', sortOrder: 'b' },
                        'char-1': { id: 'char-1', sortOrder: 'c' }
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
            swipes: {
                s1: { id: 's1', parts: [{ type: 'content', text: 'Fork me' }], createdAt: 2000 }
            },
            activeSwipeId: 's1'
        };
        const mockPrevMessage = {
            id: 'msg-1',
            chatId: 'chat-1',
            sortOrder: 'a',
            role: 'user',
            swipes: {
                s1: { id: 's1', parts: [{ type: 'content', text: 'Hello' }], createdAt: 1000 }
            },
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
