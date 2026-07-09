import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPrompt, type AgentPromptConfig, type PromptInput } from '$lib/workflow/agent/prompt';
import type { PagedMessages } from '$lib/services/content/paged_messages';
import type { Character, Chat, Message, Persona } from '$lib/services';
import type { Macro } from '$lib/template';
import type { RuntimeContext } from '$lib/types/context';
import type { PromptBlock } from '$lib/workflow/types';
import { getTextContent, type LLMMessage } from '$lib/llm/types';

const {
    mockCollectTemplateMacros,
    mockRunTemplate,
    mockRunPipeline,
    mockTokenCount,
    mockReadBytes
} = vi.hoisted(() => ({
    mockCollectTemplateMacros: vi.fn(),
    mockRunTemplate: vi.fn(),
    mockRunPipeline: vi.fn(),
    mockTokenCount: vi.fn(),
    mockReadBytes: vi.fn()
}));

// collectTemplateMacros / runTemplate are impure; the rest of $lib/template is pure.
vi.mock('$lib/template', async (importOriginal) => {
    const actual = await importOriginal<typeof import('$lib/template')>();
    return {
        ...actual,
        collectTemplateMacros: mockCollectTemplateMacros,
        runTemplate: mockRunTemplate
    };
});

vi.mock('$lib/pipeline', () => ({
    runPipeline: mockRunPipeline
}));

vi.mock('$lib/llm/tokenizer', () => ({
    TokenCounter: {
        count: mockTokenCount
    }
}));

vi.mock('$lib/services/asset', () => ({
    AssetService: { readBytes: mockReadBytes }
}));

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
    lorebooks: { refs: {}, folders: {} },
    inlays: { refs: {}, folders: {} }
};

const persona: Persona = {
    id: 'persona-1',
    scopeType: 'user',
    scopeId: 'user-1',
    name: 'Test Persona',
    description: 'persona description',
    assets: { refs: {}, folders: {} }
};

function makePreset(promptBlocks: Record<string, PromptBlock>): AgentPromptConfig {
    return {
        promptBlocks,
        maxResponse: 6000,
        maxContext: 60000,
        lorebookRatio: 0.2,
        lorebookScanDepth: 5,
        memoryRatio: 0.2
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
                parts: [{ type: 'content', text: content }],
                createdAt: 1,
                speakerId: speaker?.id,
                speakerName: speaker?.name
            }
        }
    };
}

type BuildTestPromptInput = Omit<PromptInput, 'agent' | 'tokenizer' | 'ctx'> & {
    agent?: AgentPromptConfig;
    preset?: AgentPromptConfig;
    ctx?: RuntimeContext;
};

function buildTestPrompt(input: BuildTestPromptInput) {
    const defaultContext: RuntimeContext = {
        characterId: character.id,
        chatId: chat.id
    };
    const agent = input.agent ?? input.preset;
    if (!agent) throw new Error('buildTestPrompt requires agent or preset');

    return buildPrompt({
        ...input,
        agent,
        ctx: input.ctx ?? defaultContext,
        tokenizer: 'o200k_base'
    });
}

function toTextMessages(messages: LLMMessage[]) {
    return messages.map((message) => ({
        role: message.role,
        content: getTextContent(message.content)
    }));
}

describe('buildPrompt', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCollectTemplateMacros.mockResolvedValue(new Map());
        mockRunTemplate.mockImplementation(
            async (text: string, ctx?: RuntimeContext, macros?: ReadonlyMap<string, Macro>) => {
                const slot = macros?.get('slot');
                if (text === '{{slot}}' && slot) return slot.run([], ctx ?? {});
                return text;
            }
        );
        mockRunPipeline.mockImplementation(
            async (_chatId: string, _phase: string, data: string) => data
        );
        mockTokenCount.mockImplementation(async (text: string) => text.length);
        mockReadBytes.mockResolvedValue(null);
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

        const ctx: RuntimeContext = {
            characterId: 'char-1',
            chatId: 'chat-1'
        };

        const prompt = await buildTestPrompt({
            chat,
            preset,
            lorebooks: [],
            messages,
            ctx
        });

        expect(slice).toHaveBeenCalledWith(-10, -1);
        expect(mockRunPipeline).toHaveBeenCalledTimes(2);
        expect(toTextMessages(prompt)).toEqual([
            { role: 'system', content: 'rules' },
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'hi' }
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
            chat,
            preset,
            lorebooks: [],
            messages
        });

        expect(slice).toHaveBeenCalledWith(-10, undefined);
    });

    it('does not touch PagedMessages when the template has no history entries', async () => {
        const slice = vi.fn<PagedMessages['slice']>().mockResolvedValue([]);
        const messages = { slice } as unknown as PagedMessages;
        const preset = makePreset({
            text: {
                id: 'text',
                name: 'Text',
                type: 'text',
                role: 'system',
                content: '{{character}}\n{{characternote}}\n{{chatnote}}',
                sortOrder: 'a',
                enabled: true
            },
            text2: {
                id: 'text2',
                name: 'Text 2',
                type: 'text',
                role: 'system',
                content: 'static',
                sortOrder: 'b',
                enabled: true
            }
        });

        const prompt = await buildTestPrompt({
            chat,
            preset,
            lorebooks: [],
            messages
        });

        expect(slice).not.toHaveBeenCalled();
        expect(toTextMessages(prompt)).toEqual([
            { role: 'system', content: '{{character}}\n{{characternote}}\n{{chatnote}}' },
            { role: 'system', content: 'static' }
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
            async (text: string, ctx?: RuntimeContext, macros?: ReadonlyMap<string, Macro>) => {
                const slot = macros?.get('slot');
                const resolved = text === '{{slot}}' && slot ? await slot.run([], ctx ?? {}) : text;
                return `template(${resolved})`;
            }
        );
        mockRunPipeline.mockImplementation(
            async (_chatId: string, _phase: string, data: string) => `request(${data})`
        );

        const prompt = await buildTestPrompt({
            chat,
            preset,
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
        expect(toTextMessages(prompt)).toEqual([
            {
                role: 'user',
                content: 'template(request(template({{char}} says hi)))'
            }
        ]);
    });

    it('adds attached chat inlays as image content parts in history', async () => {
        const message = makeMessage('msg-1', 'user', 'Describe this image.');
        message.swipes[message.activeSwipeId].attachments = ['inlay-1'];
        const slice = vi.fn<PagedMessages['slice']>().mockResolvedValue([{ message, index: 0 }]);
        const messages = { slice } as unknown as PagedMessages;
        const chatWithInlay: Chat = {
            ...chat,
            inlays: {
                refs: {
                    'inlay-1': {
                        id: 'inlay-1',
                        sortOrder: 'a',
                        name: 'image.webp',
                        hash: 'hash-1',
                        encKey: 'key-1',
                        mimeType: 'image/webp'
                    }
                },
                folders: {}
            }
        };
        mockReadBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));

        const prompt = await buildTestPrompt({
            chat: chatWithInlay,
            preset: makePreset({
                history: {
                    id: 'history',
                    name: 'History',
                    type: 'history',
                    start: -1,
                    sortOrder: 'a',
                    enabled: true
                }
            }),
            lorebooks: [],
            messages
        });

        expect(mockReadBytes).toHaveBeenCalledWith({
            scopeType: 'user',
            scopeId: 'user-1',
            ownerTable: 'chats',
            ownerId: 'chat-1',
            hash: 'hash-1'
        });
        expect(prompt).toEqual([
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Describe this image.' },
                    {
                        type: 'image',
                        mimeType: 'image/webp',
                        data: 'AQID'
                    }
                ]
            }
        ]);
    });

    it('uses bare slot only for the formatted content and delegates named slots', async () => {
        const slice = vi.fn<PagedMessages['slice']>().mockResolvedValue([
            {
                message: makeMessage('msg-1', 'assistant', 'hello', {
                    id: 'char-2',
                    name: 'Alice'
                }),
                index: 0
            }
        ]);
        const messages = { slice } as unknown as PagedMessages;
        const preset = makePreset({
            history: {
                id: 'history',
                name: 'History',
                type: 'history',
                start: -10,
                end: -1,
                format: '원본: {{slot}}\n입력: {{slot::source}}\n이름: {{name}}',
                sortOrder: 'a',
                enabled: true
            }
        });
        const localMacros = new Map<string, Macro>([
            [
                'slot',
                {
                    recursive: true,
                    run: (args) => {
                        if (args.length !== 1) throw new Error('named slot required');
                        if (args[0] === 'source') return 'external input';
                        throw new Error('slot not handled');
                    }
                }
            ]
        ]);

        mockRunTemplate.mockImplementation(
            async (text: string, ctx?: RuntimeContext, macros?: ReadonlyMap<string, Macro>) => {
                const macroCtx = ctx ?? {};
                let output = text;
                const slot = macros?.get('slot');
                if (slot) {
                    if (output.includes('{{slot::source}}')) {
                        output = output.replaceAll(
                            '{{slot::source}}',
                            await slot.run(['source'], macroCtx)
                        );
                    }
                    if (output.includes('{{slot}}')) {
                        output = output.replaceAll('{{slot}}', await slot.run([], macroCtx));
                    }
                }
                const name = macros?.get('name');
                if (name && output.includes('{{name}}')) {
                    output = output.replaceAll('{{name}}', await name.run([], macroCtx));
                }
                return output;
            }
        );

        const prompt = await buildTestPrompt({
            chat,
            preset,
            lorebooks: [],
            messages,
            localMacros
        });

        expect(toTextMessages(prompt)).toEqual([
            {
                role: 'assistant',
                content: '원본: hello\n입력: external input\n이름: Alice'
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
            chat,
            preset,
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
                chat,
                preset,
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
                chat,
                preset,
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
            chat,
            preset,
            lorebooks: [],
            messages
        });

        expect(at).toHaveBeenCalledWith(1);
        expect(at).toHaveBeenCalledWith(0);
        expect(toTextMessages(prompt)).toEqual([{ role: 'assistant', content: 'ok' }]);
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
                chat,
                preset,
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
                chat,
                preset,
                lorebooks: [],
                messages
            })
        ).rejects.toThrow('Prompt can only have one unbounded history block');
    });
});
