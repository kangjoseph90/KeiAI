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
    prepareNextSwipe: vi.fn(),
    updateMessage: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    deleteMessageSwipe: vi.fn(),
    getLastMessage: vi.fn(),
    getMessage: vi.fn()
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
        characterId: 'char-1',
        title: 'Chat 1',
        chatNote: '',
        defaultVariables: {}
    }),
    getCharacter: vi
        .fn()
        .mockResolvedValue({ id: 'char-1', name: 'Char 1', description: '', characterNote: '' }),
    getAppSettings: vi.fn().mockResolvedValue({
        personaId: 'persona-1',
        presetId: 'preset-1',
        apiKeys: {},
        chat: { saveMessagesOnSwipe: true }
    }),
    getPersona: vi.fn().mockResolvedValue({ id: 'persona-1', name: '', description: '' }),
    getPreset: vi.fn().mockResolvedValue({
        id: 'preset-1',
        chatModel: { id: '', provider: 'openai', parameters: {} }
    }),
    getMergedLorebooks: vi.fn().mockResolvedValue([]),
    getMergedScripts: vi.fn().mockResolvedValue([])
}));

vi.mock('$lib/stores/content/chat', () => ({
    getChat: vi.fn().mockResolvedValue({
        id: 'chat-1',
        characterId: 'char-1',
        title: 'Chat 1',
        chatNote: '',
        defaultVariables: {}
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
    getActiveModuleIds: vi.fn().mockResolvedValue(new Set())
}));

vi.mock('$lib/stores/content/module', () => ({
    getModule: vi.fn().mockResolvedValue({ id: 'mod-1', charjs: { code: '' } })
}));

vi.mock('$lib/charjs', () => ({
    getOrCreateInstance: vi.fn().mockResolvedValue(null),
    collectCharJSInstances: vi.fn().mockResolvedValue([]),
    invokeHandler: vi.fn()
}));

vi.mock('$lib/llm/prompt/builder', () => ({
    buildPrompt: vi.fn().mockResolvedValue([])
}));

vi.mock('$lib/llm/handler', () => ({
    selectLLMHandler: vi.fn().mockReturnValue(null)
}));

vi.mock('$lib/pipeline', () => ({
    runPipeline: vi.fn((_chatId: string, _phase: string, data: unknown) => Promise.resolve(data))
}));

import {
    createChatTask,
    setChatTaskError,
    getChatTask,
    clearChatTask
} from '$lib/stores/tasks/chat';
import {
    createMessage,
    getLastMessage,
    prepareNextSwipe,
    updateMessage,
    getMessage
} from '$lib/stores/content/message';
import { MessageService } from '$lib/services/content/message';
import { getChat } from '$lib/stores';
import { buildPrompt } from '$lib/llm/prompt/builder';
import { selectLLMHandler } from '$lib/llm/handler';
import type { Chat, Message } from '$lib/services';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mockNewMessage = {
    id: 'msg-new',
    chatId: 'chat-1',
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
                        variables: {}
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

        await runChat(mockChatId, { handlerOverride: mockHandler });

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
            expect.objectContaining({ content: '' }),
            false
        );
        expect(updateMessage).toHaveBeenCalled();
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
        await runChat(mockChatId, { handlerOverride: foreverHandler });

        // Should not have created a new task
        expect(createChatTask).not.toHaveBeenCalled();
    });

    it('should catch and surface errors during prompt building', async () => {
        vi.mocked(buildPrompt).mockImplementation(() => {
            throw new Error('Prompt error');
        });

        await runChat(mockChatId);

        expect(setChatTaskError).toHaveBeenCalledWith(mockChatId, 'Prompt error');
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

        await runChat(mockChatId, { handlerOverride: mockHandler });

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

        await runChat(mockChatId, { handlerOverride: mockHandler });

        expect(clearChatTask).toHaveBeenCalledWith(mockChatId);
    });

    it('should surface handler errors', async () => {
        const mockHandler: LLMStreamHandler = {
            stream: vi.fn(async function* () {
                yield { content: '' };
                throw new Error('Network fail');
            })
        };

        await runChat(mockChatId, { handlerOverride: mockHandler });

        expect(setChatTaskError).toHaveBeenCalledWith(mockChatId, 'Network fail');
        expect(clearChatTask).not.toHaveBeenCalled();
    });

    it('should use handler override when provided', async () => {
        const mockHandler: LLMStreamHandler = {
            stream: vi.fn(async function* () {
                yield { content: 'Override response' };
            })
        };

        await runChat(mockChatId, { handlerOverride: mockHandler });

        expect(selectLLMHandler).not.toHaveBeenCalled();
        expect(createChatTask).toHaveBeenCalledWith(
            mockChatId,
            'msg-new',
            expect.any(AbortController)
        );
    });

    it('selects handler from preset when no override', async () => {
        const mockHandler: LLMStreamHandler = {
            stream: vi.fn(async function* () {
                yield { content: 'Preset response' };
            })
        };

        vi.mocked(selectLLMHandler).mockReturnValue(mockHandler);

        await runChat(mockChatId);

        expect(selectLLMHandler).toHaveBeenCalled();
    });

    describe('Reroll (targetMessageId)', () => {
        const targetMessageId = 'msg-1';
        const mockExistingMessage = {
            id: targetMessageId,
            chatId: mockChatId,
            role: 'assistant',
            swipes: {
                'swipe-new': {
                    id: 'swipe-new',
                    content: 'Old content',
                    createdAt: 1000,
                    thought: '',
                    toolCalls: {}
                }
            },
            activeSwipeId: 'swipe-new',
            sortOrder: 'a0'
        };

        beforeEach(() => {
            vi.mocked(getChat).mockResolvedValue({
                id: mockChatId,
                characterId: 'char-1',
                title: 'Mock Chat',
                chatNote: '',
                defaultVariables: {},
                lastMessageId: targetMessageId
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

            await runChat(mockChatId, { handlerOverride: mockHandler, reroll: true });

            // Should add swipe to existing message, not create new message
            expect(prepareNextSwipe).toHaveBeenCalledWith(
                expect.objectContaining({ id: targetMessageId }),
                expect.objectContaining({ content: '' }),
                false
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
                personaId: 'persona-1',
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

            await runChat(mockChatId, { handlerOverride: mockHandler, reroll: true });

            expect(prepareNextSwipe).toHaveBeenCalledWith(
                expect.objectContaining({ id: targetMessageId }),
                expect.objectContaining({ content: '' }),
                true
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
