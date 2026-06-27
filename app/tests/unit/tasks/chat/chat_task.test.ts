/**
 * Generation Pipeline Tests — Chat
 *
 * Tests the DB-first streaming lifecycle.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runChat, stopChat, dismissChat } from '$lib/tasks/chat';
import type { LLMStreamHandler, LLMStreamContent } from '$lib/llm/types';

// ─── Mock all dependencies ───────────────────────────────────────────────────

vi.mock('$lib/stores/tasks/chat', () => ({
    createChatTask: vi.fn(),
    setChatTaskError: vi.fn(),
    getChatTask: vi.fn(),
    clearChatTask: vi.fn()
}));

vi.mock('$lib/stores/content/message', () => ({
    createMessage: vi.fn().mockResolvedValue(undefined),
    createMessageSwipe: vi.fn(),
    updateMessage: vi.fn().mockResolvedValue(undefined),
    updateMessageSwipe: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    deleteMessageSwipe: vi.fn(),
    getLastMessage: vi.fn(),
    getMessage: vi.fn()
}));

vi.mock('$lib/managers', () => ({
    getChatVariablesBefore: vi.fn().mockResolvedValue({}),
    prepareNextSwipe: vi.fn()
}));

vi.mock('$lib/services/content/tool', () => ({
    ToolCallService: {
        create: vi
            .fn()
            .mockResolvedValue({ id: 'tc-1', call: { name: 'mock_tool' }, chatId: 'chat-1' }),
        update: vi.fn().mockResolvedValue(undefined)
    }
}));

vi.mock('$lib/utils/id', () => ({
    generateId: vi.fn(() => 'swipe-new')
}));

vi.mock('$lib/services/content/message', () => {
    return {
        MessageService: {
            get: vi.fn().mockResolvedValue(null),
            getMessagesAfter: vi.fn().mockResolvedValue([]),
            getMessagesBefore: vi.fn().mockResolvedValue([]),
            countByChat: vi.fn().mockResolvedValue(0),
            countByChatBefore: vi.fn().mockResolvedValue(0)
        }
    };
});

vi.mock('$lib/stores', () => ({
    getChat: vi.fn().mockResolvedValue({
        id: 'chat-1',
        roomId: 'room-1',
        title: 'Chat 1',
        chatNote: '',
        defaultCharacterId: 'char-1',
        defaultPersonaId: 'persona-1',
        lorebooks: { refs: {}, folders: {} },
        personas: {
            refs: { 'persona-1': { id: 'persona-1', enabled: true, sortOrder: 'a0' } },
            folders: {}
        },
        inlays: { refs: {}, folders: {} }
    }),
    getRoom: vi.fn().mockResolvedValue({
        id: 'room-1',
        name: 'Room 1',
        chats: { refs: {}, folders: {} },
        characters: { refs: { 'char-1': { enabled: true, sortOrder: 'a0' } }, folders: {} }
    }),
    getCharacter: vi.fn().mockResolvedValue({
        id: 'char-1',
        name: 'Char 1',
        description: '',
        characterNote: '',
        defaultVariables: {}
    }),
    getAppSettings: vi.fn().mockResolvedValue({
        presetId: 'preset-1',
        apiKeys: {},
        chat: { saveMessagesOnSwipe: true }
    }),
    getPersona: vi.fn().mockResolvedValue({ id: 'persona-1', name: '', description: '' }),
    getPreset: vi.fn().mockResolvedValue({
        id: 'preset-1',
        models: {
            chat: { id: '', provider: 'openai' },
            aux: { id: '', provider: 'openai' }
        },
        parameters: {
            chat: {}
        },
        chatWorkflow: {
            nodes: {
                agent: {
                    id: 'agent',
                    name: 'Agent',
                    class: 'Agent',
                    position: { x: 0, y: 0 },
                    llmType: 'chat',
                    promptBlocks: {},
                    maxContext: 60000,
                    maxResponse: 6000,
                    lorebookRatio: 0.2,
                    memoryRatio: 0.2,
                    lorebookScanDepth: 5,
                    slotNames: {},
                    inputs: {},
                    inputValues: {}
                },
                output: {
                    id: 'output',
                    name: 'Output',
                    class: 'Output',
                    position: { x: 360, y: 0 },
                    inputs: {
                        content: {
                            sourceNode: 'agent',
                            sourcePort: 0
                        }
                    },
                    inputValues: {}
                }
            }
        }
    }),
    getMergedLorebooks: vi.fn().mockResolvedValue([]),
    getMergedScripts: vi.fn().mockResolvedValue([])
}));

vi.mock('$lib/stores/content/chat', () => ({
    getChat: vi.fn().mockResolvedValue({
        id: 'chat-1',
        roomId: 'room-1',
        title: 'Chat 1',
        chatNote: '',
        defaultCharacterId: 'char-1',
        defaultPersonaId: 'persona-1',
        lorebooks: { refs: {}, folders: {} },
        personas: {
            refs: { 'persona-1': { id: 'persona-1', enabled: true, sortOrder: 'a0' } },
            folders: {}
        },
        inlays: { refs: {}, folders: {} }
    })
}));

vi.mock('$lib/stores/content/character', () => ({
    getCharacter: vi.fn().mockResolvedValue({
        id: 'char-1',
        name: 'Char 1',
        description: '',
        characterNote: ''
    })
}));

vi.mock('$lib/stores/content/merged', () => ({
    getActiveModuleIds: vi.fn().mockResolvedValue(new Set()),
    getMergedLorebooks: vi.fn().mockResolvedValue([])
}));

vi.mock('$lib/stores/content/settings', () => ({
    getAppSettings: vi.fn().mockResolvedValue({
        presetId: 'preset-1',
        apiKeys: {},
        chat: { saveMessagesOnSwipe: true }
    })
}));

vi.mock('$lib/stores/content/module', () => ({
    getModule: vi.fn().mockResolvedValue({ id: 'mod-1', charjs: { code: '' } })
}));

vi.mock('$lib/charjs', () => ({
    getOrCreateInstance: vi.fn().mockResolvedValue(null),
    collectCharJSInstances: vi.fn().mockResolvedValue([]),
    invokeHandler: vi.fn()
}));

vi.mock('$lib/workflow/agent/prompt', () => ({
    buildPrompt: vi.fn().mockResolvedValue([])
}));

vi.mock('$lib/llm/handler', () => ({
    selectLLMHandler: vi.fn().mockReturnValue(null),
    resolveLLMModelConfig: vi.fn().mockResolvedValue({ id: '', provider: 'openai' }),
    resolveLLMParameters: vi.fn().mockResolvedValue({})
}));

vi.mock('$lib/pipeline', () => ({
    runPipeline: vi.fn((_chatId: string, _phase: string, data: unknown) => Promise.resolve(data))
}));

// Only runTemplate needs faking; pure helpers flow through from the real module.
vi.mock('$lib/template', async (importOriginal) => {
    const actual = await importOriginal<typeof import('$lib/template')>();
    return {
        ...actual,
        runTemplate: vi.fn((text: string) => Promise.resolve(text))
    };
});

import {
    createChatTask,
    setChatTaskError,
    getChatTask,
    clearChatTask
} from '$lib/stores/tasks/chat';
import {
    createMessage,
    getLastMessage,
    updateMessage,
    updateMessageSwipe,
    getMessage
} from '$lib/stores/content/message';
import { getChatVariablesBefore, prepareNextSwipe } from '$lib/managers';
import { MessageService } from '$lib/services/content/message';
import { getChat, getRoom } from '$lib/stores';
import { buildPrompt } from '$lib/workflow/agent/prompt';
import { selectLLMHandler } from '$lib/llm/handler';
import { runPipeline } from '$lib/pipeline';
import type { Chat, Message, Preset } from '$lib/services';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mockNewMessage = {
    id: 'msg-new',
    chatId: 'chat-1',
    scopeType: 'user',
    scopeId: 'user-1',
    role: 'assistant',
    swipes: {},
    activeSwipeId: '',
    sortOrder: 'a0'
};

function makeMockTask(overrides: Record<string, unknown> = {}) {
    return {
        status: 'generating' as const,
        messageId: 'msg-new',
        controller: new AbortController(),
        errorMessage: undefined,
        ...overrides
    };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Chat Pipeline', () => {
    const mockChatId = 'chat-1';

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getChatTask).mockReturnValue(null);
        vi.mocked(buildPrompt).mockResolvedValue([{ role: 'user', content: 'test' }]);
        vi.mocked(selectLLMHandler).mockReturnValue({
            stream: vi.fn(async function* () {
                yield { content: 'Response' };
            })
        });
        // Default: createMessage returns a new message
        vi.mocked(createMessage).mockResolvedValue(
            mockNewMessage as unknown as import('$lib/services').Message
        );
        vi.mocked(getChatVariablesBefore).mockResolvedValue({});
        vi.mocked(prepareNextSwipe).mockResolvedValue({
            swipeId: 'swipe-new',
            message: {
                ...mockNewMessage,
                activeSwipeId: 'swipe-new',
                swipes: {
                    'swipe-new': {
                        id: 'swipe-new',
                        content: '',
                        createdAt: Date.now(),
                        variables: {},
                        speakerId: 'char-1',
                        speakerName: 'Char 1'
                    }
                }
            } as unknown as import('$lib/services').Message
        });
        // Default: getMessage returns message with content
        vi.mocked(getMessage).mockResolvedValue({
            ...mockNewMessage,
            swipes: {
                'swipe-new': {
                    id: 'swipe-new',
                    content: 'Hello world',
                    createdAt: Date.now(),
                    variables: {}
                }
            },
            activeSwipeId: 'swipe-new'
        } as unknown as import('$lib/services').Message);
        vi.mocked(getLastMessage).mockResolvedValue(mockNewMessage as Message);

        // Default: bounded history view has one prior message
        vi.mocked(MessageService.countByChatBefore).mockResolvedValue(1);

        // Default: paged message view returns the generated target message
        vi.mocked(MessageService.getMessagesAfter).mockResolvedValue([
            mockNewMessage as unknown as import('$lib/services').Message
        ]);
    });

    it('should run a successful chat generation', async () => {
        const mockHandler: LLMStreamHandler = {
            stream: vi.fn(async function* () {
                yield { content: 'Hello' };
                yield { content: 'Hello world' };
            })
        };

        // Mock getMessage to return a fresh copy each time to avoid reference contamination
        vi.mocked(getMessage).mockImplementation(
            async () =>
                ({
                    ...mockNewMessage,
                    swipes: {
                        'swipe-new': {
                            id: 'swipe-new',
                            content: 'Hello world',
                            createdAt: Date.now(),
                            variables: {}
                        }
                    },
                    activeSwipeId: 'swipe-new'
                }) as Message
        );
        vi.mocked(selectLLMHandler).mockReturnValue(mockHandler);

        await runChat(mockChatId, 'char-1', 'persona-1');

        // Should create message in DB immediately
        expect(createMessage).toHaveBeenCalled();
        // Should register task with messageId
        expect(createChatTask).toHaveBeenCalledWith(
            mockChatId,
            'msg-new',
            expect.any(AbortController)
        );
        // Should update swipe content during streaming
        expect(prepareNextSwipe).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'msg-new' }),
            expect.objectContaining({
                content: '',
                variables: {},
                speakerId: 'char-1',
                speakerName: 'Char 1',
                replaceActiveSwipe: false
            })
        );
        expect(updateMessageSwipe).toHaveBeenCalled();
        const promptInput = vi.mocked(buildPrompt).mock.calls[0]?.[0];
        expect(promptInput?.ctx).toMatchObject({
            characterId: 'char-1',
            personaId: 'persona-1',
            chatId: 'chat-1'
        });
        expect(promptInput?.ctx).not.toHaveProperty('messageId');
        expect(promptInput?.ctx).not.toHaveProperty('messageIndex');
        expect(promptInput?.ctx).not.toHaveProperty('role');
        expect(promptInput?.ctx).not.toHaveProperty('speakerId');
        expect(promptInput?.ctx).not.toHaveProperty('speakerName');
        expect(runPipeline).toHaveBeenCalledWith(
            mockChatId,
            'output',
            'Hello world',
            expect.objectContaining({
                characterId: 'char-1',
                speakerId: 'char-1',
                speakerName: 'Char 1',
                role: 'assistant'
            })
        );
        // Should NOT have an error
        expect(setChatTaskError).not.toHaveBeenCalled();
        // Should clear task on success
        expect(clearChatTask).toHaveBeenCalledWith(mockChatId);
    });

    it('should prevent duplicate runs for the same chat', async () => {
        const foreverHandler: LLMStreamHandler = {
            stream: vi.fn(async function* (_msgs, signal) {
                yield { content: '' };
                if (signal.aborted) return;
                await new Promise((resolve) => {
                    signal.addEventListener('abort', resolve, { once: true });
                });
            })
        };

        // Simulate existing task
        vi.mocked(getChatTask).mockReturnValue(makeMockTask());

        // Attempt run while one is active
        await runChat(mockChatId, 'char-1', 'persona-1');

        // Should not have created a new task
        expect(createChatTask).not.toHaveBeenCalled();
    });

    it('should catch and surface errors during prompt building', async () => {
        vi.mocked(buildPrompt).mockImplementation(() => {
            throw new Error('Prompt error');
        });

        await runChat(mockChatId, 'char-1', 'persona-1');

        expect(setChatTaskError).toHaveBeenCalledWith(mockChatId, 'Agent failed: Prompt error');
    });

    it('should reject generation when the character ref is missing in room', async () => {
        vi.mocked(getRoom).mockResolvedValueOnce({
            id: 'room-1',
            scopeType: 'user',
            scopeId: 'user-1',
            name: 'Room 1',
            chats: { refs: {}, folders: {} },
            characters: { refs: {}, folders: {} }
        });

        await runChat(mockChatId, 'char-missing', 'persona-1');

        expect(setChatTaskError).toHaveBeenCalledWith(
            mockChatId,
            'Character is not available: char-missing'
        );
        expect(createMessage).not.toHaveBeenCalled();
    });

    it('should reject generation when the persona ref is disabled in the chat', async () => {
        vi.mocked(getChat).mockResolvedValueOnce({
            id: mockChatId,
            roomId: 'room-1',
            scopeType: 'user',
            scopeId: 'user-1',
            title: 'Mock Chat',
            chatNote: '',
            messageCount: 0,
            defaultCharacterId: 'char-1',
            lorebooks: { refs: {}, folders: {} },
            personas: {
                refs: { 'persona-1': { id: 'persona-1', enabled: false, sortOrder: 'a0' } },
                folders: {}
            },
            inlays: { refs: {}, folders: {} }
        } as Chat);

        await runChat(mockChatId, 'char-1', 'persona-1');

        expect(setChatTaskError).toHaveBeenCalledWith(
            mockChatId,
            'Persona is not available: persona-1'
        );
        expect(createMessage).not.toHaveBeenCalled();
    });

    it('should handle empty response', async () => {
        const mockHandler: LLMStreamHandler = {
            stream: vi.fn(async function* () {
                const empty: LLMStreamContent[] = [];
                for (const chunk of empty) yield chunk;
            })
        };

        // getMessage returns swipe with empty content for empty check
        vi.mocked(getMessage).mockResolvedValue({
            ...mockNewMessage,
            swipes: { 'swipe-new': { id: 'swipe-new', content: '', createdAt: Date.now() } },
            activeSwipeId: 'swipe-new'
        } as unknown as import('$lib/services').Message);
        vi.mocked(selectLLMHandler).mockReturnValue(mockHandler);

        await runChat(mockChatId, 'char-1', 'persona-1');

        expect(setChatTaskError).toHaveBeenCalledWith(mockChatId, 'Empty response from model');
        expect(clearChatTask).not.toHaveBeenCalled();
    });

    it('should cleanup on abort', async () => {
        const mockHandler: LLMStreamHandler = {
            stream: vi.fn(async function* () {
                yield { content: 'Partial' };
                throw new DOMException('Aborted', 'AbortError');
            })
        };
        vi.mocked(selectLLMHandler).mockReturnValue(mockHandler);

        await runChat(mockChatId, 'char-1', 'persona-1');

        expect(clearChatTask).toHaveBeenCalledWith(mockChatId);
    });

    it('should surface handler errors', async () => {
        const mockHandler: LLMStreamHandler = {
            stream: vi.fn(async function* () {
                yield { content: '' };
                throw new Error('Network fail');
            })
        };
        vi.mocked(selectLLMHandler).mockReturnValue(mockHandler);

        await runChat(mockChatId, 'char-1', 'persona-1');

        expect(setChatTaskError).toHaveBeenCalledWith(mockChatId, 'Agent failed: Network fail');
        expect(clearChatTask).not.toHaveBeenCalled();
    });

    it('selects handler from preset when no override', async () => {
        const mockHandler: LLMStreamHandler = {
            stream: vi.fn(async function* () {
                yield { content: 'Preset response' };
            })
        };

        vi.mocked(selectLLMHandler).mockReturnValue(mockHandler);

        await runChat(mockChatId, 'char-1', 'persona-1');

        expect(selectLLMHandler).toHaveBeenCalled();
    });

    describe('Reroll (targetMessageId)', () => {
        const targetMessageId = 'msg-1';
        const mockExistingMessage = {
            id: targetMessageId,
            chatId: mockChatId,
            scopeType: 'user',
            scopeId: 'user-1',
            role: 'assistant',
            swipes: {
                'swipe-new': {
                    id: 'swipe-new',
                    content: 'Old content',
                    createdAt: 1000
                }
            },
            activeSwipeId: 'swipe-new',
            sortOrder: 'a0'
        };

        beforeEach(() => {
            vi.mocked(getChat).mockResolvedValue({
                id: mockChatId,
                roomId: 'room-1',
                scopeType: 'user',
                scopeId: 'user-1',
                title: 'Mock Chat',
                chatNote: '',
                messageCount: 1,
                defaultCharacterId: 'char-1',
                defaultPersonaId: 'persona-1',
                lastMessageId: targetMessageId,
                lorebooks: { refs: {}, folders: {} },
                personas: {
                    refs: { 'persona-1': { id: 'persona-1', enabled: true, sortOrder: 'a0' } },
                    folders: {}
                },
                inlays: { refs: {}, folders: {} }
            } as Chat);
            vi.mocked(MessageService.get).mockResolvedValue(mockExistingMessage as Message);
            vi.mocked(getLastMessage).mockResolvedValue(mockExistingMessage as Message);
        });

        it('should add a new swipe for reroll', async () => {
            const mockHandler: LLMStreamHandler = {
                stream: vi.fn(async function* () {
                    yield { content: 'New content' };
                })
            };

            // Return a message with the new swipe for the final empty check
            vi.mocked(getMessage)
                .mockResolvedValueOnce(
                    mockExistingMessage as unknown as import('$lib/services').Message
                ) // swipe creation
                .mockResolvedValue({
                    ...mockExistingMessage,
                    swipes: {
                        ...mockExistingMessage.swipes,
                        'swipe-new': {
                            id: 'swipe-new',
                            content: 'New content',
                            createdAt: Date.now()
                        }
                    },
                    activeSwipeId: 'swipe-new'
                } as unknown as import('$lib/services').Message);
            vi.mocked(selectLLMHandler).mockReturnValue(mockHandler);

            await runChat(mockChatId, 'char-1', 'persona-1', { reroll: true });

            // Should add swipe to existing message, not create new message
            expect(prepareNextSwipe).toHaveBeenCalledWith(
                expect.objectContaining({ id: targetMessageId }),
                expect.objectContaining({
                    content: '',
                    variables: {},
                    speakerId: 'char-1',
                    speakerName: 'Char 1',
                    replaceActiveSwipe: false
                })
            );
            expect(createMessage).not.toHaveBeenCalled();
        });

        it('should replace the active swipe when previous swipes are not kept', async () => {
            const mockHandler: LLMStreamHandler = {
                stream: vi.fn(async function* () {
                    yield { content: 'Replacement' };
                })
            };

            const { getAppSettings } = await import('$lib/stores');
            vi.mocked(getAppSettings).mockResolvedValueOnce({
                presetId: 'preset-1',
                apiKeys: {},
                chat: { saveMessagesOnSwipe: false }
            } as unknown as Awaited<ReturnType<typeof getAppSettings>>);
            vi.mocked(MessageService.getMessagesAfter).mockResolvedValue([
                mockExistingMessage as unknown as import('$lib/services').Message
            ]);
            vi.mocked(getMessage).mockResolvedValue({
                ...mockExistingMessage,
                swipes: {
                    'swipe-new': {
                        id: 'swipe-new',
                        content: 'Replacement',
                        createdAt: Date.now()
                    }
                },
                activeSwipeId: 'swipe-new'
            } as unknown as import('$lib/services').Message);
            vi.mocked(selectLLMHandler).mockReturnValue(mockHandler);

            await runChat(mockChatId, 'char-1', 'persona-1', { reroll: true });

            expect(prepareNextSwipe).toHaveBeenCalledWith(
                expect.objectContaining({ id: targetMessageId }),
                expect.objectContaining({
                    content: '',
                    variables: {},
                    speakerId: 'char-1',
                    speakerName: 'Char 1',
                    replaceActiveSwipe: true
                })
            );
        });
    });

    describe('Controls', () => {
        it('dismissChat should call clearChatTask', () => {
            dismissChat(mockChatId);
            expect(clearChatTask).toHaveBeenCalledWith(mockChatId);
        });

        it('stopChat does not throw when no active controller', () => {
            expect(() => stopChat(mockChatId)).not.toThrow();
        });

        it('stopChat should abort via task controller', () => {
            const mockController = new AbortController();
            vi.mocked(getChatTask).mockReturnValue(makeMockTask({ controller: mockController }));

            stopChat(mockChatId);

            expect(mockController.signal.aborted).toBe(true);
        });
    });
});
