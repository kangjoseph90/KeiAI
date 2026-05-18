import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    collectTemplateMacros,
    interpretTemplate,
    parseTemplate,
    runTemplate
} from '$lib/template';
import type { PluginInstance } from '$lib/plugins/manager';

const {
    mockCollectCharJSInstances,
    mockInvokeHandler,
    mockPluginGetInstances,
    mockGetCharacter,
    mockGetPersona,
    mockGetChat,
    mockGetChatVariable,
    mockSetChatVariable
} = vi.hoisted(() => ({
    mockCollectCharJSInstances: vi.fn(),
    mockInvokeHandler: vi.fn(),
    mockPluginGetInstances: vi.fn(),
    mockGetCharacter: vi.fn(),
    mockGetPersona: vi.fn(),
    mockGetChat: vi.fn(),
    mockGetChatVariable: vi.fn(),
    mockSetChatVariable: vi.fn()
}));

vi.mock('$lib/charjs/collect', () => ({
    collectCharJSInstances: mockCollectCharJSInstances
}));

vi.mock('$lib/charjs/engine', () => ({
    invokeHandler: mockInvokeHandler
}));

vi.mock('$lib/plugins', () => ({
    pluginManager: {
        getInstances: mockPluginGetInstances
    }
}));

vi.mock('$lib/stores/content/character', () => ({
    getCharacter: mockGetCharacter
}));

vi.mock('$lib/stores/content/persona', () => ({
    getPersona: mockGetPersona
}));

vi.mock('$lib/stores/content/chat', () => ({
    getChat: mockGetChat
}));

vi.mock('$lib/managers/chat', () => ({
    getChatVariable: mockGetChatVariable,
    setChatVariable: mockSetChatVariable
}));

function createPluginInstance(): PluginInstance {
    return {
        pluginId: 'plugin-1',
        iframe: {} as HTMLIFrameElement,
        transport: {} as PluginInstance['transport'],
        broker: {
            invoke: mockInvokeHandler,
            fireEvent: vi.fn()
        } as unknown as PluginInstance['broker'],
        pipelineHandlers: new Map(),
        eventListeners: new Map(),
        macroHandlers: new Map([['char', { fnId: 'plugin-char' }]]),
        llmProviders: new Map(),
        unloadHandlers: []
    };
}

describe('template', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        mockCollectCharJSInstances.mockResolvedValue([]);
        mockPluginGetInstances.mockReturnValue([]);
        mockGetCharacter.mockResolvedValue({
            id: 'char-1',
            name: 'Kei',
            description: 'A {{char}}-aware character',
            characterNote: 'Sharp and direct'
        });
        mockGetPersona.mockResolvedValue({
            id: 'persona-1',
            name: 'Mina',
            description: 'Helpful persona'
        });
        mockGetChat.mockResolvedValue({
            id: 'chat-1',
            title: 'Demo chat',
            chatNote: 'Talk softly'
        });
        mockGetChatVariable.mockImplementation(async (_chatId: string, key: string) => {
            if (key === 'flag') return '1';
            if (key === 'mood') return 'happy';
            return null;
        });
        mockSetChatVariable.mockResolvedValue(undefined);
        mockInvokeHandler.mockResolvedValue('Plugin Kei');
    });

    it('parses text and simple macro nodes', () => {
        expect(parseTemplate('hello {{char}}')).toEqual([
            { type: 'text', value: 'hello ' },
            { type: 'macro', name: 'char', args: [] }
        ]);
    });

    it('parses nested macro arguments as templates', () => {
        expect(parseTemplate('{{? {{getvar::flag}}==1}}')).toEqual([
            {
                type: 'macro',
                name: '?',
                args: [
                    [
                        {
                            type: 'macro',
                            name: 'getvar',
                            args: [[{ type: 'text', value: 'flag' }]]
                        },
                        { type: 'text', value: '==1' }
                    ]
                ]
            }
        ]);
    });

    it('collects builtin macros and keeps helper aliases working', async () => {
        const macros = await collectTemplateMacros({});

        await expect(interpretTemplate(parseTemplate('{{upper::kei}}'), {}, macros)).resolves.toBe(
            'KEI'
        );
        await expect(
            interpretTemplate(
                parseTemplate('{{replace::hello {{upper::kei}}::KEI::AI}}'),
                {},
                macros
            )
        ).resolves.toBe('hello AI');
        await expect(
            interpretTemplate(parseTemplate('{{greater::2::1}}'), {}, macros)
        ).resolves.toBe('1');
        await expect(interpretTemplate(parseTemplate('{{? 2 + 3 * 4}}'), {}, macros)).resolves.toBe(
            '14'
        );
        await expect(interpretTemplate(parseTemplate('{{? 2 = 2}}'), {}, macros)).resolves.toBe(
            '1'
        );
    });

    it('collects charjs macros only when chatId is present', async () => {
        await collectTemplateMacros({});
        expect(mockCollectCharJSInstances).not.toHaveBeenCalled();

        await collectTemplateMacros({ chatId: 'chat-1' });
        expect(mockCollectCharJSInstances).toHaveBeenCalledWith(
            'chat-1',
            'template',
            'macro',
            undefined
        );
    });

    it('interprets KeiAI domain macros from live stores', async () => {
        await expect(runTemplate('{{char}}', { characterId: 'char-1' })).resolves.toBe('Kei');
        await expect(runTemplate('{{description}}', { characterId: 'char-1' })).resolves.toBe(
            'A Kei-aware character'
        );
        await expect(runTemplate('{{user}}', { personaId: 'persona-1' })).resolves.toBe('Mina');
        await expect(runTemplate('{{persona}}', { personaId: 'persona-1' })).resolves.toBe(
            'Helpful persona'
        );
        await expect(runTemplate('{{chat}}', { chatId: 'chat-1' })).resolves.toBe('Demo chat');
        await expect(runTemplate('{{chatnote}}', { chatId: 'chat-1' })).resolves.toBe(
            'Talk softly'
        );
    });

    it('exposes template execution context macros', async () => {
        const ctx = {
            chatId: 'chat-1',
            characterId: 'char-1',
            personaId: 'persona-1',
            messageId: 'msg-1',
            messageIndex: 12,
            speakerId: 'char-1',
            speakerName: 'Kei',
            role: 'assistant' as const,
            display: true,
            dryRun: true
        };

        await expect(
            runTemplate(
                [
                    '{{chatid}}',
                    '{{charid}}',
                    '{{personaid}}',
                    '{{msgid}}',
                    '{{msgindex}}',
                    '{{speakerid}}',
                    '{{speaker}}',
                    '{{speakername}}',
                    '{{role}}',
                    '{{isuser}}',
                    '{{isbot}}',
                    '{{isdisplay}}',
                    '{{isdryrun}}'
                ].join('|'),
                ctx
            )
        ).resolves.toBe('chat-1|char-1|persona-1|msg-1|12|char-1|Kei|Kei|assistant|0|1|1|1');
    });

    it('treats dryRun setvar as read-only', async () => {
        await expect(
            runTemplate('{{setvar::mood::happy}}', { chatId: 'chat-1', dryRun: true })
        ).resolves.toBe('');
        expect(mockSetChatVariable).not.toHaveBeenCalled();
    });

    it('prefers plugin macros over builtins during collection', async () => {
        mockPluginGetInstances.mockReturnValue([createPluginInstance()]);

        await expect(runTemplate('{{char}}', { characterId: 'char-1' })).resolves.toBe(
            'Plugin Kei'
        );
        expect(mockGetCharacter).not.toHaveBeenCalled();
    });

    it('interprets if, elif, and else branches', async () => {
        const macros = await collectTemplateMacros({});
        const template = parseTemplate(
            '{{#if::0}}no{{:elif::{{? 2>1}}}}yes{{:else}}fallback{{/if}}'
        );

        await expect(interpretTemplate(template, {}, macros)).resolves.toBe('yes');
    });

    it('accepts anonymous block close tags for Risu compatibility', async () => {
        const macros = await collectTemplateMacros({});
        const template = parseTemplate('{{#if::1}}yes{{/}}');

        await expect(interpretTemplate(template, {}, macros)).resolves.toBe('yes');
    });

    it('renders img macros as lazy asset placeholders in display mode', async () => {
        await expect(runTemplate('{{img::asset-"<&>}}', { display: true })).resolves.toBe(
            '<img data-keiai-asset-id="asset-&quot;&lt;&amp;&gt;" alt="" loading="lazy" decoding="async" />'
        );
    });

    it('leaves img macros untouched outside display mode', async () => {
        await expect(runTemplate('{{img::asset-1}}', { display: false })).resolves.toBe(
            '{{img::asset-1}}'
        );
    });

    it('keeps escape block body as raw text', () => {
        expect(parseTemplate('{{#escape}}{{char}}{{/escape}}')).toEqual([
            {
                type: 'block',
                name: 'escape',
                args: [],
                branches: [[{ type: 'text', value: '{{char}}' }]]
            }
        ]);
    });

    it('preserves unknown macros in output', async () => {
        await expect(runTemplate('{{unknown::a::b}}', {})).resolves.toBe('{{unknown::a::b}}');
    });
});
