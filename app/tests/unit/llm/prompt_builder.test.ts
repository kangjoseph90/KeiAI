import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPrompt } from '$lib/llm/prompt/builder';
import type { PagedMessages } from '$lib/services/content/paged_messages';
import type { Character, Chat, Message, Preset, PromptBlock } from '$lib/services';
import type { LLMModelConfig } from '$lib/types/models/llm';

const {
    mockCollectTemplateMacros,
    mockRunTemplate,
    mockCollectPipelineHandlers,
    mockRunPipelineHandlers
} = vi.hoisted(() => ({
    mockCollectTemplateMacros: vi.fn(),
    mockRunTemplate: vi.fn(),
    mockCollectPipelineHandlers: vi.fn(),
    mockRunPipelineHandlers: vi.fn()
}));

vi.mock('$lib/template', () => ({
    collectTemplateMacros: mockCollectTemplateMacros,
    runTemplate: mockRunTemplate
}));

vi.mock('$lib/pipeline', () => ({
    collectPipelineHandlers: mockCollectPipelineHandlers,
    runPipelineHandlers: mockRunPipelineHandlers
}));

const model: LLMModelConfig = { id: 'mock::default', provider: 'mock', parameters: {} };

const character: Character = {
    id: 'char-1',
    name: 'Test Character',
    description: 'character',
    characterNote: 'character note',
    greetings: {},
    allowLowLevel: false
};

const chat: Chat = {
    id: 'chat-1',
    characterId: 'char-1',
    title: 'Test Chat',
    chatNote: 'chat note'
};

function makePreset(promptBlocks: Record<string, PromptBlock>): Preset {
    return {
        id: 'preset-1',
        name: 'Test Preset',
        description: '',
        chatModel: model,
        auxModel: model,
        promptBlocks,
        maxResponse: 6000,
        maxContext: 60000,
        lorebookRatio: 0.2,
        memoryRatio: 0.2
    };
}

function makeMessage(id: string, role: Message['role'], content: string): Message {
    const swipeId = `${id}-swipe`;
    return {
        id,
        chatId: 'chat-1',
        sortOrder: id,
        role,
        activeSwipeId: swipeId,
        swipes: {
            [swipeId]: {
                id: swipeId,
                content,
                createdAt: 1
            }
        }
    };
}

describe('buildPrompt', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCollectTemplateMacros.mockResolvedValue(new Map());
        mockCollectPipelineHandlers.mockResolvedValue([]);
        mockRunTemplate.mockImplementation(async (text: string) => text);
        mockRunPipelineHandlers.mockImplementation(
            async (_handlers: unknown[], data: string) => data
        );
    });

    it('loads history from PagedMessages only when processing history entries', async () => {
        const slice = vi
            .fn<PagedMessages['slice']>()
            .mockResolvedValue([
                makeMessage('msg-1', 'user', 'hello'),
                makeMessage('msg-2', 'assistant', 'hi')
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

        const prompt = await buildPrompt({
            character,
            chat,
            preset,
            persona: null,
            lorebooks: [],
            messages
        });

        expect(slice).toHaveBeenCalledWith(-10, -1);
        expect(mockCollectTemplateMacros).toHaveBeenCalledWith({
            characterId: 'char-1',
            personaId: undefined,
            chatId: 'chat-1',
            display: false,
            dryRun: false
        });
        expect(mockCollectPipelineHandlers).toHaveBeenCalledWith('chat-1', 'request');
        expect(mockRunPipelineHandlers).toHaveBeenCalledTimes(2);
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

        await buildPrompt({
            character,
            chat,
            preset,
            persona: null,
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

        const prompt = await buildPrompt({
            character,
            chat,
            preset,
            persona: null,
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
            .mockResolvedValue([makeMessage('msg-1', 'user', '{{char}} says hi')]);
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

        mockRunTemplate.mockImplementation(async (text: string) => `template(${text})`);
        mockRunPipelineHandlers.mockImplementation(
            async (_handlers: unknown[], data: string) => `request(${data})`
        );

        const prompt = await buildPrompt({
            character,
            chat,
            preset,
            persona: null,
            lorebooks: [],
            messages
        });

        expect(mockRunPipelineHandlers).toHaveBeenCalledWith([], 'template({{char}} says hi)', {
            role: 'user'
        });
        expect(prompt).toEqual([
            {
                role: 'user',
                content: 'template(request(template({{char}} says hi)))',
                thought: undefined
            }
        ]);
    });
});
