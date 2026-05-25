import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPrompt, type PromptInput } from '$lib/tasks/chat/prompt';
import type { PagedMessages } from '$lib/services/content/paged_messages';
import type { Character, Chat, Message, Persona, Preset, PromptBlock } from '$lib/services';
import type { LLMModelConfig } from '$lib/types/models/llm';
import type { Macro, TemplateContext } from '$lib/template';

const { mockCollectTemplateMacros, mockRunTemplate, mockRunPipeline, mockTokenCount } = vi.hoisted(
    () => ({
        mockCollectTemplateMacros: vi.fn(),
        mockRunTemplate: vi.fn(),
        mockRunPipeline: vi.fn(),
        mockTokenCount: vi.fn()
    })
);

vi.mock('$lib/template', () => ({
    collectTemplateMacros: mockCollectTemplateMacros,
    runTemplate: mockRunTemplate,
    createDryRunMacros: vi.fn(() => new Map())
}));

vi.mock('$lib/pipeline', () => ({
    runPipeline: mockRunPipeline
}));

vi.mock('$lib/llm/tokenizer', () => ({
    TokenCounter: {
        count: mockTokenCount
    }
}));

const model: LLMModelConfig = { id: 'mock::default', provider: 'mock' };

const character: Character = {
    id: 'char-1',
    scopeType: 'user',
    scopeId: 'user-1',
    name: 'Test Character',
    description: 'character',
    characterNote: 'character note',
    backgroundHTML: '',
    messageCSS: '',
    greetings: {},
    defaultVariables: {},
    allowLowLevel: false,
    modules: { refs: {}, folders: {} },
    lorebooks: { refs: {}, folders: {} },
    scripts: { refs: {}, folders: {} },
    charjs: { refs: {}, folders: {} },
    assets: { refs: {}, folders: {} }
};

const chat: Chat = {
    id: 'chat-1',
    roomId: 'room-1',
    scopeType: 'user',
    scopeId: 'user-1',
    title: 'Test Chat',
    chatNote: 'chat note',
    messageCount: 0,
    personas: { refs: {}, folders: {} },
    lorebooks: { refs: {}, folders: {} }
};

const persona: Persona = {
    id: 'persona-1',
    scopeType: 'user',
    scopeId: 'user-1',
    name: 'Test Persona',
    description: 'persona description',
    assets: { refs: {}, folders: {} }
};

function makePreset(promptBlocks: Record<string, PromptBlock>): Preset {
    return {
        id: 'preset-1',
        name: 'Test Preset',
        description: '',
        models: {
            chat: model,
            aux: model
        },
        parameters: {},
        promptBlocks,
        maxResponse: 6000,
        maxContext: 60000,
        lorebookRatio: 0.2,
        lorebookScanDepth: 5,
        memoryRatio: 0.2,
        defaultVariables: {},
        globalVariables: {},
        customToggles: {},
        scripts: { refs: {}, folders: {} }
    };
}

function makeMessage(
    id: string,
    role: Message['role'],
    content: string,
    speaker?: { id: string; name: string }
): Message {
    const swipeId = `${id}-swipe`;
    return {
        id,
        chatId: 'chat-1',
        scopeType: 'user',
        scopeId: 'user-1',
        sortOrder: id,
        role,
        activeSwipeId: swipeId,
        swipes: {
            [swipeId]: {
                id: swipeId,
                content,
                createdAt: 1,
                speakerId: speaker?.id,
                speakerName: speaker?.name
            }
        }
    };
}

function buildTestPrompt(
    input: Omit<PromptInput, 'tokenizer' | 'context'> & { context?: TemplateContext }
) {
    const defaultContext: TemplateContext = {
        characterId: character.id,
        chatId: chat.id
    };
    return buildPrompt({
        ...input,
        context: input.context ?? defaultContext,
        tokenizer: 'o200k_base'
    });
}

describe('buildPrompt', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCollectTemplateMacros.mockResolvedValue(new Map());
        mockRunTemplate.mockImplementation(
            async (text: string, ctx?: TemplateContext, macros?: ReadonlyMap<string, Macro>) => {
                const slot = macros?.get('slot');
                if (text === '{{slot}}' && slot) return slot.run([], ctx ?? {});
                return text;
            }
        );
        mockRunPipeline.mockImplementation(
            async (_chatId: string, _phase: string, data: string) => data
        );
        mockTokenCount.mockImplementation(async (text: string) => text.length);
    });

    it('loads history from PagedMessages only when processing history entries', async () => {
        const slice = vi.fn<PagedMessages['slice']>().mockResolvedValue([
            { message: makeMessage('msg-1', 'user', 'hello'), index: 0 },
            { message: makeMessage('msg-2', 'assistant', 'hi'), index: 1 }
        ]);
        const messages = { slice } as unknown as PagedMessages;
        const preset = makePreset({
            text: {
                id: 'text',
                name: 'System',
                type: 'text',
                role: 'system',
                content: 'rules',
                sortOrder: 'a',
                enabled: true
            },
            history: {
                id: 'history',
                name: 'History',
                type: 'history',
                start: -10,
                end: -1,
                sortOrder: 'b',
                enabled: true
            }
        });

        const context: TemplateContext = {
            characterId: 'char-1',
            chatId: 'chat-1'
        };

        const prompt = await buildTestPrompt({
            character,
            chat,
            preset,
            persona,
            lorebooks: [],
            messages,
            context
        });

        expect(slice).toHaveBeenCalledWith(-10, -1);
        expect(mockRunPipeline).toHaveBeenCalledTimes(2);
        expect(prompt).toEqual([
            { role: 'system', content: 'rules' },
            { role: 'user', content: 'hello', thought: undefined },
            { role: 'assistant', content: 'hi', thought: undefined }
        ]);
    });

    it('defaults history end to the end of the completed history view', async () => {
        const slice = vi.fn<PagedMessages['slice']>().mockResolvedValue([]);
        const messages = { slice } as unknown as PagedMessages;
        const preset = makePreset({
            history: {
                id: 'history',
                name: 'History',
                type: 'history',
                start: -10,
                sortOrder: 'a',
                enabled: true
            }
        });

        await buildTestPrompt({
            character,
            chat,
            preset,
            persona,
            lorebooks: [],
            messages
        });

        expect(slice).toHaveBeenCalledWith(-10, undefined);
    });

    it('does not touch PagedMessages when the template has no history entries', async () => {
        const slice = vi.fn<PagedMessages['slice']>().mockResolvedValue([]);
        const messages = { slice } as unknown as PagedMessages;
        const preset = makePreset({
            character: {
                id: 'character',
                name: 'Character',
                type: 'character',
                role: 'system',
                sortOrder: 'a',
                enabled: true
            },
            characterNote: {
                id: 'characterNote',
                name: 'Character Note',
                type: 'characterNote',
                role: 'system',
                sortOrder: 'b',
                enabled: true
            },
            chatNote: {
                id: 'chatNote',
                name: 'Chat Note',
                type: 'chatNote',
                role: 'system',
                sortOrder: 'c',
                enabled: true
            }
        });

        const prompt = await buildTestPrompt({
            character,
            chat,
            preset,
            persona,
            lorebooks: [],
            messages
        });

        expect(slice).not.toHaveBeenCalled();
        expect(prompt).toEqual([
            { role: 'system', content: 'character' },
            { role: 'system', content: 'character note' },
            { role: 'system', content: 'chat note' }
        ]);
    });

    it('runs history content through template, request handlers, then template again', async () => {
        const slice = vi
            .fn<PagedMessages['slice']>()
            .mockResolvedValue([
                { message: makeMessage('msg-1', 'user', '{{char}} says hi'), index: 0 }
            ]);
        const messages = { slice } as unknown as PagedMessages;
        const preset = makePreset({
            history: {
                id: 'history',
                name: 'History',
                type: 'history',
                start: -10,
                sortOrder: 'a',
                enabled: true
            }
        });

        mockRunTemplate.mockImplementation(
            async (text: string, ctx?: TemplateContext, macros?: ReadonlyMap<string, Macro>) => {
                const slot = macros?.get('slot');
                const resolved = text === '{{slot}}' && slot ? await slot.run([], ctx ?? {}) : text;
                return `template(${resolved})`;
            }
        );
        mockRunPipeline.mockImplementation(
            async (_chatId: string, _phase: string, data: string) => `request(${data})`
        );

        const prompt = await buildTestPrompt({
            character,
            chat,
            preset,
            persona,
            lorebooks: [],
            messages
        });

        expect(mockRunPipeline).toHaveBeenCalledWith(
            'chat-1',
            'request',
            'template({{char}} says hi)',
            {
                chatId: 'chat-1',
                characterId: 'char-1',
                messageId: 'msg-1',
                messageIndex: 0,
                role: 'user',
                speakerId: undefined,
                speakerName: undefined
            }
        );
        expect(prompt).toEqual([
            {
                role: 'user',
                content: 'template(request(template({{char}} says hi)))',
                thought: undefined
            }
        ]);
    });

    it('injects assistant speaker context while rendering history messages', async () => {
        const slice = vi.fn<PagedMessages['slice']>().mockResolvedValue([
            {
                message: makeMessage('msg-1', 'assistant', '{{char}} says hi', {
                    id: 'char-2',
                    name: 'Beta'
                }),
                index: 7
            }
        ]);
        const messages = { slice } as unknown as PagedMessages;
        const preset = makePreset({
            history: {
                id: 'history',
                name: 'History',
                type: 'history',
                start: -10,
                sortOrder: 'a',
                enabled: true
            }
        });

        await buildTestPrompt({
            character,
            chat,
            preset,
            persona,
            lorebooks: [],
            messages
        });

        expect(mockRunPipeline).toHaveBeenCalledWith(
            'chat-1',
            'request',
            '{{char}} says hi',
            expect.objectContaining({
                characterId: 'char-2',
                speakerId: 'char-2',
                speakerName: 'Beta',
                messageId: 'msg-1',
                messageIndex: 7,
                role: 'assistant'
            })
        );
    });

    it('throws when required fixed blocks exceed the prompt input budget', async () => {
        const messages = { slice: vi.fn<PagedMessages['slice']>() } as unknown as PagedMessages;
        const preset = {
            ...makePreset({
                text: {
                    id: 'text',
                    name: 'System',
                    type: 'text',
                    role: 'system',
                    content: 'too long',
                    sortOrder: 'a',
                    enabled: true
                }
            }),
            maxContext: 10,
            maxResponse: 3
        };

        await expect(
            buildTestPrompt({
                character,
                chat,
                preset,
                persona,
                lorebooks: [],
                messages
            })
        ).rejects.toThrow('Prompt budget exceeded');
    });

    it('treats bounded history as required and throws when it exceeds budget', async () => {
        const slice = vi
            .fn<PagedMessages['slice']>()
            .mockResolvedValue([{ message: makeMessage('msg-1', 'user', 'too long'), index: 0 }]);
        const messages = { slice } as unknown as PagedMessages;
        const preset = {
            ...makePreset({
                history: {
                    id: 'history',
                    name: 'History',
                    type: 'history',
                    start: -1,
                    sortOrder: 'a',
                    enabled: true
                }
            }),
            maxContext: 10,
            maxResponse: 3
        };

        await expect(
            buildTestPrompt({
                character,
                chat,
                preset,
                persona,
                lorebooks: [],
                messages
            })
        ).rejects.toThrow('Prompt budget exceeded');
    });

    it('truncates unbounded history to the remaining budget from newest to oldest', async () => {
        const oldest = makeMessage('msg-1', 'user', 'older message');
        const newest = makeMessage('msg-2', 'assistant', 'ok');
        const at = vi.fn<PagedMessages['at']>(async (index) => {
            if (index === 0) return { message: oldest, index: 0 };
            if (index === 1) return { message: newest, index: 1 };
            return null;
        });
        const messages = { length: 2, at } as unknown as PagedMessages;
        const preset = {
            ...makePreset({
                history: {
                    id: 'history',
                    name: 'History',
                    type: 'history',
                    sortOrder: 'a',
                    enabled: true
                }
            }),
            maxContext: 8,
            maxResponse: 5
        };

        const prompt = await buildTestPrompt({
            character,
            chat,
            preset,
            persona,
            lorebooks: [],
            messages
        });

        expect(at).toHaveBeenCalledWith(1);
        expect(at).toHaveBeenCalledWith(0);
        expect(prompt).toEqual([{ role: 'assistant', content: 'ok', thought: undefined }]);
    });

    it('throws when unbounded history has messages but the latest does not fit', async () => {
        const latest = makeMessage('msg-1', 'user', 'too long');
        const at = vi.fn<PagedMessages['at']>(async (index) =>
            index === 0 ? { message: latest, index: 0 } : null
        );
        const messages = { length: 1, at } as unknown as PagedMessages;
        const preset = {
            ...makePreset({
                history: {
                    id: 'history',
                    name: 'History',
                    type: 'history',
                    sortOrder: 'a',
                    enabled: true
                }
            }),
            maxContext: 10,
            maxResponse: 3
        };

        await expect(
            buildTestPrompt({
                character,
                chat,
                preset,
                persona,
                lorebooks: [],
                messages
            })
        ).rejects.toThrow('Latest history message does not fit');
    });

    it('throws when more than one unbounded history block is enabled', async () => {
        const messages = {
            length: 0,
            at: vi.fn<PagedMessages['at']>()
        } as unknown as PagedMessages;
        const preset = makePreset({
            firstHistory: {
                id: 'firstHistory',
                name: 'First History',
                type: 'history',
                sortOrder: 'a',
                enabled: true
            },
            secondHistory: {
                id: 'secondHistory',
                name: 'Second History',
                type: 'history',
                sortOrder: 'b',
                enabled: true
            }
        });

        await expect(
            buildTestPrompt({
                character,
                chat,
                preset,
                persona,
                lorebooks: [],
                messages
            })
        ).rejects.toThrow('Prompt can only have one unbounded history block');
    });
});
