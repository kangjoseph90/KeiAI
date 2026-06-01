import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    collectTemplateMacros,
    interpretTemplate,
    parseTemplate,
    runTemplate,
    createDryRunMacros
} from '$lib/template';
import type { Macro } from '$lib/template';
import {
    createDisplayMacros,
    normalizeAssetName,
    resolveAssetName,
    type AssetNameIndex,
    type RawAssetUrlCache
} from '$lib/template/display';
import type { AssetReadLocator } from '$lib/services/asset';
import type { PluginInstance } from '$lib/plugins/manager';

const {
    mockCollectCharJSInstances,
    mockInvokeHandler,
    mockPluginGetInstances,
    mockGetCharacter,
    mockGetPersona,
    mockGetChat,
    mockGetMessage,
    mockGetChatVariable,
    mockGetGlobalVariable,
    mockSetChatVariable
} = vi.hoisted(() => ({
    mockCollectCharJSInstances: vi.fn(),
    mockInvokeHandler: vi.fn(),
    mockPluginGetInstances: vi.fn(),
    mockGetCharacter: vi.fn(),
    mockGetPersona: vi.fn(),
    mockGetChat: vi.fn(),
    mockGetMessage: vi.fn(),
    mockGetChatVariable: vi.fn(),
    mockGetGlobalVariable: vi.fn(),
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

vi.mock('$lib/services', () => ({
    ChatService: {
        get: mockGetChat
    }
}));

vi.mock('$lib/stores/content/message', () => ({
    getMessage: mockGetMessage
}));

vi.mock('$lib/managers/chat', () => ({
    getChatVariable: mockGetChatVariable,
    setChatVariable: mockSetChatVariable
}));

vi.mock('$lib/managers/preset', () => ({
    getGlobalVariable: mockGetGlobalVariable
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
        llmTypes: new Map(),
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
            chatNote: 'Talk softly',
            greetingMessageId: 'msg-greeting',
            lastMessageId: 'msg-last',
            messageCount: 7,
            scopeType: 'room',
            scopeId: 'room-1',
            inlays: {
                refs: {
                    'asset-direct-id': {
                        hash: 'hash-direct',
                        encKey: 'key-direct'
                    }
                },
                folders: {}
            }
        });
        mockGetMessage.mockImplementation(async (id: string) => {
            if (id === 'msg-greeting') {
                return {
                    activeSwipeId: 'swipe-1',
                    swipes: {
                        'swipe-1': { content: 'Hello there' }
                    }
                };
            }

            if (id === 'msg-last') {
                return {
                    activeSwipeId: 'swipe-1',
                    swipes: {
                        'swipe-1': { content: 'See you' }
                    }
                };
            }

            return null;
        });
        mockGetChatVariable.mockImplementation(async (_chatId: string, key: string) => {
            if (key === 'aff') return '60';
            if (key === 'charlist') return '["hello","world"]';
            if (key === 'flag') return '1';
            if (key === 'mood') return 'very happy';
            return null;
        });
        mockGetGlobalVariable.mockImplementation(async (key: string) => {
            if (key === 'toggle_romance') return '1';
            return null;
        });
        mockSetChatVariable.mockResolvedValue(undefined);
        mockInvokeHandler.mockResolvedValue('Plugin Kei');
    });

    it('parses text and simple macro nodes', () => {
        expect(parseTemplate('hello {{char}}')).toEqual([
            { type: 'text', value: 'hello ' },
            { type: 'macro', name: 'char', args: [], raw: '{{char}}' }
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
                            args: [[{ type: 'text', value: 'flag' }]],
                            raw: '{{getvar::flag}}'
                        },
                        { type: 'text', value: '==1' }
                    ]
                ],
                raw: '{{? {{getvar::flag}}==1}}'
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
        await expect(
            interpretTemplate(parseTemplate('{{any::0::false::yes}}'), {}, macros)
        ).resolves.toBe('1');
        await expect(
            interpretTemplate(parseTemplate('{{any::0::false}}'), {}, macros)
        ).resolves.toBe('0');
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
            role: 'assistant' as const
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
                    '{{isbot}}'
                ].join('|'),
                ctx
            )
        ).resolves.toBe('chat-1|char-1|persona-1|msg-1|12|char-1|Kei|Kei|assistant|0|1');
    });

    it('treats dryRun setvar as read-only', async () => {
        const dryRunMacros = createDryRunMacros();
        await expect(
            runTemplate('{{setvar::mood::happy}}', { chatId: 'chat-1' }, dryRunMacros)
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

    it('falls back through macro stacks when a higher priority macro throws', async () => {
        const localMacros = new Map([
            [
                'char',
                {
                    run: () => {
                        throw new Error('not handled');
                    }
                }
            ]
        ]);

        await expect(runTemplate('{{char}}', { characterId: 'char-1' }, localMacros)).resolves.toBe(
            'Kei'
        );
    });

    it('returns ERROR when all macro handlers with a name fail', async () => {
        const localMacros = new Map([
            [
                'fail',
                {
                    run: () => {
                        throw new Error('boom');
                    }
                }
            ]
        ]);

        await expect(runTemplate('{{fail}}', {}, localMacros)).resolves.toBe('ERROR');
    });

    it('interprets if, elif, and else branches', async () => {
        const macros = await collectTemplateMacros({});
        const template = parseTemplate(
            '{{#if::0}}no{{:elif::{{? 2>1}}}}yes{{:else}}fallback{{/if}}'
        );

        await expect(interpretTemplate(template, {}, macros)).resolves.toBe('yes');
    });

    it('interprets if conditions with the expression evaluator', async () => {
        await expect(
            runTemplate(
                '{{#if {{gettoggle::romance}} and {{getvar::aff}} >= 50}}yes{{:else}}no{{/if}}',
                { chatId: 'chat-1' }
            )
        ).resolves.toBe('yes');
    });

    it('treats nested macros as expression value atoms', async () => {
        await expect(
            runTemplate('{{#if {{getvar::mood}} == "very happy"}}yes{{:else}}no{{/if}}', {
                chatId: 'chat-1'
            })
        ).resolves.toBe('yes');
        await expect(
            runTemplate('{{? {{getvar::aff}} - 10 }}', { chatId: 'chat-1' })
        ).resolves.toBe('50');
    });

    it('normalizes only block boundary newlines', async () => {
        await expect(runTemplate('{{#if 1}}\n  hello\n\n{{/if}}', {})).resolves.toBe('  hello\n');
    });

    it('exposes last message macros', async () => {
        await expect(
            runTemplate('{{lastmessageid}}|{{lastmessageindex}}', { chatId: 'chat-1' })
        ).resolves.toBe('msg-last|6');
    });

    it('exposes greeting and message boundary macros', async () => {
        await expect(
            runTemplate(
                '{{firstmessageid}}|{{firstmessage}}|{{greetingmessage}}|{{lastmessage}}|{{isfirstmessage}}|{{islastmessage}}',
                { chatId: 'chat-1', messageId: 'msg-greeting' }
            )
        ).resolves.toBe('msg-greeting|Hello there|Hello there|See you|1|0');

        await expect(
            runTemplate('{{isfirstmessage}}|{{islastmessage}}', {
                chatId: 'chat-1',
                messageId: 'msg-last'
            })
        ).resolves.toBe('0|1');
    });

    it('renders pure blocks as raw text', async () => {
        await expect(
            runTemplate('{{#pure}}{{char}}{{/pure}}', { characterId: 'char-1' })
        ).resolves.toBe('{{char}}');
        await expect(
            runTemplate('{{#pure}}\n{{char}}\n{{/pure}}', { characterId: 'char-1' })
        ).resolves.toBe('{{char}}');
    });

    it('escapes braces inside escape blocks', async () => {
        await expect(runTemplate('{{#escape}}{{char}}{{/escape}}', {})).resolves.toBe(
            '\\{\\{char\\}\\}'
        );
        await expect(runTemplate('{{#escape}}\n{{char}}\n{{/escape}}', {})).resolves.toBe(
            '\\{\\{char\\}\\}'
        );
    });

    it('iterates JSON arrays with scoped slot macros', async () => {
        await expect(runTemplate('{{#each [1,2,3] as n}}{{slot::n}},{{/each}}', {})).resolves.toBe(
            '1,2,3,'
        );
        await expect(
            runTemplate('{{#each {{getvar::charlist}} as c}}{{slot::c}}{{/each}}', {
                chatId: 'chat-1'
            })
        ).resolves.toBe('helloworld');
    });

    it('lets each scoped slots fall back to outer slot macros', async () => {
        const localMacros = new Map<string, Macro>([
            [
                'slot',
                {
                    run: ([name]: string[]) => {
                        if (name !== undefined) throw new Error('not handled');
                        return 'outer';
                    }
                }
            ]
        ]);

        await expect(
            runTemplate('{{#each [1] as n}}{{slot}}:{{slot::n}}{{/each}}', {}, localMacros)
        ).resolves.toBe('outer:1');
    });

    it('accepts anonymous block close tags for Risu compatibility', async () => {
        const macros = await collectTemplateMacros({});
        const template = parseTemplate('{{#if::1}}yes{{/}}');

        await expect(interpretTemplate(template, {}, macros)).resolves.toBe('yes');
    });

    it('renders img macros when asset macros are injected', async () => {
        const mockLocator: AssetReadLocator = {
            scopeType: 'user',
            scopeId: 'user-1',
            ownerTable: 'characters',
            ownerId: 'char-1',
            hash: 'asset-1',
            encKey: 'key-1'
        };
        const assetMap: AssetNameIndex = new Map([
            ['char-1', new Map([['avatar', [mockLocator]]])]
        ]);
        const cache: RawAssetUrlCache = new Map();
        const macros = createDisplayMacros(assetMap, ['char-1'], cache);
        await expect(runTemplate('{{img::avatar}}', {}, macros)).resolves.toBe(
            '<img data-keiai-asset="{&quot;scopeType&quot;:&quot;user&quot;,&quot;scopeId&quot;:&quot;user-1&quot;,&quot;ownerTable&quot;:&quot;characters&quot;,&quot;ownerId&quot;:&quot;char-1&quot;,&quot;hash&quot;:&quot;asset-1&quot;,&quot;encKey&quot;:&quot;key-1&quot;}" data-keiai-asset-name="avatar" alt="" loading="lazy" decoding="async" />'
        );
    });

    it('resolves asset names with Risu-compatible fuzzy matching', () => {
        expect(normalizeAssetName('Theme Song.m4p')).toBe('themesong');
        expect(normalizeAssetName('Intro Clip.m4v')).toBe('introclip');

        const mockLocatorSmile: AssetReadLocator = {
            scopeType: 'user',
            scopeId: 'user-1',
            ownerTable: 'characters',
            ownerId: 'char-1',
            hash: 'asset-smile',
            encKey: 'key-smile'
        };
        const mockLocatorBg: AssetReadLocator = {
            scopeType: 'user',
            scopeId: 'user-1',
            ownerTable: 'characters',
            ownerId: 'char-1',
            hash: 'asset-bg',
            encKey: 'key-bg'
        };

        const ownerMap = new Map<string, AssetReadLocator[]>([
            ['dohwasmileone', [mockLocatorSmile]],
            ['bg', [mockLocatorBg]]
        ]);
        const assetMap: AssetNameIndex = new Map([['char-1', ownerMap]]);

        expect(resolveAssetName(assetMap, ['char-1'], 'dohwa smile onee')).toBe(mockLocatorSmile);
        expect(ownerMap.get('dohwasmileonee')).toEqual([mockLocatorSmile]);
        expect(resolveAssetName(assetMap, ['char-1'], 'bq')).toBeNull();
    });

    it('renders inlay macros directly using asset ID', async () => {
        const assetMap: AssetNameIndex = new Map();
        const cache: RawAssetUrlCache = new Map();
        const macros = createDisplayMacros(assetMap, [], cache);
        await expect(
            runTemplate('{{inlay::asset-direct-id}}', { chatId: 'chat-1' }, macros)
        ).resolves.toBe(
            '<img data-keiai-asset="{&quot;scopeType&quot;:&quot;room&quot;,&quot;scopeId&quot;:&quot;room-1&quot;,&quot;ownerTable&quot;:&quot;chats&quot;,&quot;ownerId&quot;:&quot;chat-1&quot;,&quot;hash&quot;:&quot;hash-direct&quot;,&quot;encKey&quot;:&quot;key-direct&quot;}" data-keiai-inlay-id="asset-direct-id" alt="" loading="lazy" decoding="async" />'
        );
    });

    it('parses escape and pure block bodies as raw text', () => {
        expect(parseTemplate('{{#pure}}{{char}}{{/pure}}')).toEqual([
            {
                type: 'block',
                name: 'pure',
                args: [],
                branches: [[{ type: 'text', value: '{{char}}' }]]
            }
        ]);
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
