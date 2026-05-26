import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    exportCharacterPackage,
    importCharacterPackage,
    readCharacterFile,
    writeCharacterFile,
    type KeiCharacterPackageV1
} from '$lib/porters/character';
import { classifyAsset } from '$lib/porters/types';
import { writeRisuModule } from '$lib/porters/risu/module';
import { unzip, zip } from '$lib/utils/zip';
import { AssetService } from '$lib/services/asset';
import {
    CharacterService,
    CharJSService,
    LorebookService,
    ScriptService,
    type Character,
    type CharJS,
    type Lorebook,
    type Script
} from '$lib/services';

vi.mock('$lib/services', () => ({
    CharacterService: {
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
    },
    LorebookService: {
        listByOwner: vi.fn(),
        create: vi.fn()
    },
    ScriptService: {
        listByOwner: vi.fn(),
        create: vi.fn()
    },
    CharJSService: {
        listByOwner: vi.fn(),
        create: vi.fn()
    }
}));

vi.mock('$lib/services/asset', () => ({
    AssetService: {
        getFields: vi.fn(),
        readBytes: vi.fn(),
        write: vi.fn(),
        delete: vi.fn()
    }
}));

describe('character porters', () => {
    const character: Character = {
        id: 'char-real',
        scopeType: 'user',
        scopeId: 'user-1',
        name: 'Kei',
        description: 'Character description',
        characterNote: 'Character note',
        backgroundHTML: '',
        messageCSS: '',
        greetings: {
            greet_1: { id: 'greet_1', content: 'Hello', sortOrder: 'a' }
        },
        defaultVariables: { mood: 'calm' },
        allowLowLevel: false,
        avatarAssetId: 'asset-avatar',
        modules: {
            refs: { module_real: { id: 'module_real', enabled: true, sortOrder: 'a' } },
            folders: {}
        },
        lorebooks: {
            refs: { lorebook_real: { id: 'lorebook_real', sortOrder: 'a' } },
            folders: {}
        },
        scripts: {
            refs: { script_real: { id: 'script_real', sortOrder: 'a' } },
            folders: {}
        },
        charjs: {
            refs: { charjs_real: { id: 'charjs_real', sortOrder: 'a' } },
            folders: {}
        },
        assets: {
            refs: {
                'asset-avatar': {
                    id: 'asset-avatar',
                    name: 'Avatar',
                    sortOrder: 'a'
                },
                'asset-extra': { id: 'asset-extra', name: 'Extra', sortOrder: 'b' }
            },
            folders: {}
        }
    };

    const lorebook: Lorebook = {
        id: 'lorebook_real',
        ownerId: 'char-real',
        scopeType: 'user',
        scopeId: 'user-1',
        name: 'Lore',
        key: 'key',
        secondKey: '',
        content: 'content',
        depth: 1,
        order: 100,
        alwaysActive: false,
        disabled: false,
        role: 'system',
        useRegex: false,
        useMultipleKeys: false,
        probability: 100,
        recursive: false,
        noRecursiveSearch: false
    };

    const script: Script = {
        id: 'script_real',
        ownerId: 'char-real',
        scopeType: 'user',
        scopeId: 'user-1',
        type: 'regex',
        name: 'Script',
        regex: 'a',
        replacement: 'b',
        phase: 'display',
        advanced: false,
        flag: 'g',
        order: 100,
        repeat: 1,
        enabled: true
    };

    const charjs: CharJS = {
        id: 'charjs_real',
        ownerId: 'char-real',
        scopeType: 'user',
        scopeId: 'user-1',
        name: 'CharJS',
        code: 'return input;',
        enabled: true
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('classifies asset payloads', () => {
        expect(
            classifyAsset({ id: 'asset', data: new Uint8Array([1]), hash: 'hash', encKey: 'key' })
        ).toBe('baked');
        expect(classifyAsset({ id: 'asset', hash: 'hash', encKey: 'key' })).toBe('light');
        expect(classifyAsset({ id: 'asset', hash: 'hash' })).toBe('broken');
    });

    it('exports a character package with portable ids and asset payloads', async () => {
        vi.mocked(CharacterService.get).mockResolvedValue(character);
        vi.mocked(LorebookService.listByOwner).mockResolvedValue([lorebook]);
        vi.mocked(ScriptService.listByOwner).mockResolvedValue([script]);
        vi.mocked(CharJSService.listByOwner).mockResolvedValue([charjs]);
        vi.mocked(AssetService.getFields).mockImplementation(async (id) => ({
            kind: 'resource',
            status: id === 'asset-avatar' ? 'remote' : 'local',
            hash: `${id}-hash`,
            encKey: `${id}-key`
        }));
        vi.mocked(AssetService.readBytes).mockResolvedValue(new Uint8Array([1, 2, 3]));

        const pkg = await exportCharacterPackage('char-real', 'light');

        expect(pkg.kind).toBe('keiai.character');
        expect(pkg.character.greetings.greet_1?.id).toBe('greet_1');
        expect(pkg.character.avatarAssetId).toBe('asset_0');
        expect(pkg.character.lorebooks.refs.lorebook_0?.id).toBe('lorebook_0');
        expect(pkg.character.scripts.refs.script_0?.id).toBe('script_0');
        expect(pkg.character.charjs.refs.charjs_0?.id).toBe('charjs_0');
        expect(pkg.character.assets.refs.asset_1?.name).toBe('Extra');
        expect(pkg.lorebooks[0]?.id).toBe('lorebook_0');
        expect(pkg.scripts[0]?.id).toBe('script_0');
        expect(pkg.charjs[0]?.id).toBe('charjs_0');
        expect(pkg.assets.find((asset) => asset.id === 'asset_0')?.data).toBeUndefined();
        expect(pkg.assets.find((asset) => asset.id === 'asset_1')?.data).toEqual(
            new Uint8Array([1, 2, 3])
        );
        expect('modules' in pkg.character).toBe(false);
    });

    it('writes CCv3 PNG, CharX, and KeiChar files from a package', async () => {
        vi.mocked(CharacterService.get).mockResolvedValue(character);
        vi.mocked(LorebookService.listByOwner).mockResolvedValue([lorebook]);
        vi.mocked(ScriptService.listByOwner).mockResolvedValue([script]);
        vi.mocked(CharJSService.listByOwner).mockResolvedValue([charjs]);
        vi.mocked(AssetService.getFields).mockImplementation(async (id) => ({
            kind: 'resource',
            status: 'local',
            hash: `${id}-hash`,
            encKey: `${id}-key`
        }));
        vi.mocked(AssetService.readBytes).mockResolvedValue(new Uint8Array([1, 2, 3]));

        const pkg = await exportCharacterPackage('char-real', 'baked');
        const png = await writeCharacterFile(pkg, { kind: 'ccv3', format: 'png' });
        const charx = await writeCharacterFile(pkg, { kind: 'ccv3', format: 'charx' });
        const keichar = await writeCharacterFile(pkg, { kind: 'keichar', assetMode: 'baked' });

        const charxEntries = await unzip(charx);
        const keicharEntries = await unzip(keichar);
        const pngRoundTrip = await readCharacterFile(new File([png.slice()], 'character.png'));
        const charxRoundTrip = await readCharacterFile(
            new File([charx.slice()], 'character.charx')
        );
        const charxCard = JSON.parse(new TextDecoder().decode(charxEntries['card.json'])) as {
            data: { character_book: { entries: Array<{ content: string }> } };
        };

        expect(png.slice(0, 8)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
        expect(charxEntries['card.json']).toBeTruthy();
        expect(charxEntries['module.risum']).toBeTruthy();
        expect(charxEntries['assets/x-risu-asset/images/Extra.bin']).toBeTruthy();
        expect(keicharEntries['package.json']).toBeTruthy();
        expect(keicharEntries['assets/asset_0.bin']).toBeTruthy();
        expect(pngRoundTrip.assets.find((asset) => asset.id === 'asset_0')?.data).toEqual(
            new Uint8Array([1, 2, 3])
        );
        expect(pngRoundTrip.character.avatarAssetId).toBe('asset_0');
        expect(charxRoundTrip.charjs[0]).toEqual(
            expect.objectContaining({ id: 'charjs_0', name: 'CharJS', code: 'return input;' })
        );
        expect(charxRoundTrip.character.charjs.refs.charjs_0?.id).toBe('charjs_0');
        expect(charxCard.data.character_book.entries[0]?.content).toContain('@@depth 1\n');
        expect(charxCard.data.character_book.entries[0]?.content).toContain('@@unrecursive\n');
    });

    it('uses generated ids for greetings imported from CCv3 cards', async () => {
        const file = new File(
            [
                JSON.stringify({
                    spec: 'chara_card_v3',
                    spec_version: '3.0',
                    data: {
                        name: 'Card',
                        description: '',
                        personality: '',
                        scenario: '',
                        first_mes: 'Hello',
                        alternate_greetings: ['Hi again'],
                        mes_example: '',
                        creator_notes: '',
                        system_prompt: '',
                        post_history_instructions: '',
                        tags: [],
                        creator: '',
                        character_version: '',
                        extensions: {},
                        group_only_greetings: []
                    }
                })
            ],
            'card.json',
            { type: 'application/json' }
        );

        const pkg = await readCharacterFile(file);
        const greetingIds = Object.keys(pkg.character.greetings);

        expect(greetingIds).toHaveLength(2);
        expect(greetingIds).not.toContain('greeting_0');
        expect(greetingIds.every((id) => /^[a-z0-9]{15}$/.test(id))).toBe(true);
        expect(pkg.character.greetings[greetingIds[0]]?.id).toBe(greetingIds[0]);
    });

    it('imports CCv3 cards without optional extension fields', async () => {
        const file = new File(
            [
                JSON.stringify({
                    spec: 'chara_card_v3',
                    spec_version: '3.0',
                    data: {
                        name: 'Card',
                        description: '',
                        personality: '',
                        scenario: '',
                        first_mes: '',
                        mes_example: '',
                        creator_notes: '',
                        system_prompt: '',
                        post_history_instructions: '',
                        creator: '',
                        character_version: ''
                    }
                })
            ],
            'card.json',
            { type: 'application/json' }
        );

        await expect(readCharacterFile(file)).resolves.toEqual(
            expect.objectContaining({ kind: 'keiai.character' })
        );
    });

    it('keeps Risu script order from the imported script list', async () => {
        const file = new File(
            [
                JSON.stringify({
                    spec: 'chara_card_v3',
                    spec_version: '3.0',
                    data: {
                        name: 'Card',
                        description: '',
                        personality: '',
                        scenario: '',
                        first_mes: '',
                        alternate_greetings: [],
                        mes_example: '',
                        creator_notes: '',
                        system_prompt: '',
                        post_history_instructions: '',
                        tags: [],
                        creator: '',
                        character_version: '',
                        extensions: {
                            risuai: {
                                customScripts: [
                                    { comment: 'First', in: 'a', out: 'b', type: 'editinput' },
                                    { comment: 'Second', in: 'c', out: 'd', type: 'disabled' }
                                ]
                            }
                        },
                        group_only_greetings: []
                    }
                })
            ],
            'card.json',
            { type: 'application/json' }
        );

        const pkg = await readCharacterFile(file);

        expect(pkg.scripts[0]).toEqual(
            expect.objectContaining({ name: 'First', order: 0, phase: 'input', enabled: true })
        );
        expect(pkg.scripts[1]).toEqual(
            expect.objectContaining({ name: 'Second', order: 1, phase: 'display', enabled: false })
        );
    });

    it('does not clear card scripts when a Risu CharX module has no scripts', async () => {
        const card = {
            spec: 'chara_card_v3',
            spec_version: '3.0',
            data: {
                name: 'Card',
                description: '',
                personality: '',
                scenario: '',
                first_mes: '',
                alternate_greetings: [],
                mes_example: '',
                creator_notes: '',
                system_prompt: '',
                post_history_instructions: '',
                tags: [],
                creator: '',
                character_version: '',
                extensions: {
                    risuai: {
                        customScripts: [{ comment: 'Card Script', in: 'a', out: 'b' }]
                    }
                },
                group_only_greetings: []
            }
        };
        const charx = zip({
            'card.json': new TextEncoder().encode(JSON.stringify(card)),
            'module.risum': writeRisuModule({
                lorebook: [{ key: 'module-key', comment: 'Module Lore', content: 'Module lore' }]
            })
        });

        const pkg = await readCharacterFile(new File([charx.slice()], 'module.charx'));

        expect(pkg.scripts[0]).toEqual(expect.objectContaining({ name: 'Card Script' }));
        expect(pkg.lorebooks[0]).toEqual(expect.objectContaining({ name: 'Module Lore' }));
    });

    it('converts Risu lorebook decorators into Kei lorebook fields', async () => {
        const file = new File(
            [
                JSON.stringify({
                    spec: 'chara_card_v3',
                    spec_version: '3.0',
                    data: {
                        name: 'Card',
                        description: '',
                        personality: '',
                        scenario: '',
                        first_mes: '',
                        alternate_greetings: [],
                        mes_example: '',
                        creator_notes: '',
                        system_prompt: '',
                        post_history_instructions: '',
                        character_book: {
                            extensions: {},
                            entries: [
                                {
                                    keys: ['key'],
                                    content:
                                        '@@depth 3\n@@role user\n@@scan_depth 7\n@@probability 25\n@@recursive\n@@no_recursive_search\nLore',
                                    extensions: {},
                                    enabled: true,
                                    insertion_order: 42,
                                    use_regex: true,
                                    name: 'Decorated'
                                }
                            ]
                        },
                        tags: [],
                        creator: '',
                        character_version: '',
                        extensions: {},
                        group_only_greetings: []
                    }
                })
            ],
            'card.json',
            { type: 'application/json' }
        );

        const pkg = await readCharacterFile(file);

        expect(pkg.lorebooks[0]).toEqual(
            expect.objectContaining({
                name: 'Decorated',
                content: 'Lore',
                depth: 3,
                role: 'user',
                scanDepth: 7,
                probability: 25,
                recursive: true,
                noRecursiveSearch: true,
                order: 42,
                useRegex: true
            })
        );
    });

    it('imports lorebooks from Risu CharX module files', async () => {
        const card = {
            spec: 'chara_card_v3',
            spec_version: '3.0',
            data: {
                name: 'Card',
                description: '',
                personality: '',
                scenario: '',
                first_mes: '',
                alternate_greetings: [],
                mes_example: '',
                creator_notes: '',
                system_prompt: '',
                post_history_instructions: '',
                tags: [],
                creator: '',
                character_version: '',
                extensions: {},
                group_only_greetings: []
            }
        };
        const charx = zip({
            'card.json': new TextEncoder().encode(JSON.stringify(card)),
            'module.risum': writeRisuModule({
                lorebook: [
                    {
                        key: 'module-key',
                        secondkey: 'other-key',
                        selective: true,
                        insertorder: 77,
                        comment: 'Module Lore',
                        content: '@@depth 2\nModule lore',
                        useRegex: true
                    }
                ]
            })
        });

        const pkg = await readCharacterFile(new File([charx.slice()], 'module.charx'));

        expect(pkg.lorebooks[0]).toEqual(
            expect.objectContaining({
                name: 'Module Lore',
                key: 'module-key',
                secondKey: 'other-key',
                useMultipleKeys: true,
                order: 77,
                content: 'Module lore',
                depth: 2,
                useRegex: true
            })
        );
    });

    it('rejects light assets unless explicitly allowed', async () => {
        const pkg = makePackage({
            assets: [{ id: 'asset_0', hash: 'hash', encKey: 'key' }]
        });

        await expect(importCharacterPackage(pkg, { allowLightAssets: false })).rejects.toThrow(
            'Light asset import is disabled'
        );
        expect(AssetService.write).not.toHaveBeenCalled();
    });

    it('validates all asset payloads before writing imported assets', async () => {
        const pkg = makePackage({
            assets: [
                { id: 'asset_0', data: new Uint8Array([1]), hash: 'hash', encKey: 'key' },
                { id: 'asset_1', hash: 'broken' }
            ]
        });

        await expect(importCharacterPackage(pkg, { allowLightAssets: true })).rejects.toThrow(
            'Broken asset payload'
        );
        expect(AssetService.write).not.toHaveBeenCalled();
    });

    it('imports package records and reconnects refs to created ids', async () => {
        const pkg = makePackage({
            assets: [
                { id: 'asset_0', data: new Uint8Array([1, 2, 3]), hash: 'hash', encKey: 'key' }
            ]
        });

        vi.mocked(AssetService.write).mockResolvedValue('asset-new');
        vi.mocked(CharacterService.create).mockResolvedValue({
            ...character,
            id: 'char-new',
            avatarAssetId: undefined,
            lorebooks: { refs: {}, folders: {} },
            scripts: { refs: {}, folders: {} },
            charjs: { refs: {}, folders: {} },
            assets: { refs: {}, folders: {} }
        });
        vi.mocked(LorebookService.create).mockResolvedValue({ ...lorebook, id: 'lorebook-new' });
        vi.mocked(ScriptService.create).mockResolvedValue({ ...script, id: 'script-new' });
        vi.mocked(CharJSService.create).mockResolvedValue({ ...charjs, id: 'charjs-new' });
        vi.mocked(CharacterService.update).mockResolvedValue({ ...character, id: 'char-new' });

        const characterId = await importCharacterPackage(pkg, { scopeType: 'room' });
        const update = vi.mocked(CharacterService.update).mock.calls[0]?.[1];

        expect(characterId).toBe('char-new');
        expect(AssetService.write).toHaveBeenCalledWith(expect.any(File), 'resource', {
            scopeType: 'room'
        });
        expect(CharacterService.create).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'Imported' }),
            'room'
        );
        expect(LorebookService.create).toHaveBeenCalledWith(
            'char-new',
            expect.objectContaining({ name: 'Lore' }),
            'room'
        );
        expect(update?.avatarAssetId).toBe('asset-new');
        expect(update?.lorebooks?.refs?.['lorebook-new']?.id).toBe('lorebook-new');
        expect(update?.scripts?.refs?.['script-new']?.id).toBe('script-new');
        expect(update?.charjs?.refs?.['charjs-new']?.id).toBe('charjs-new');
        expect(update?.assets?.refs?.['asset-new']?.name).toBe('Avatar');
    });

    it('retries write operations on failure up to maxAttempts', async () => {
        const pkg = makePackage({
            assets: [
                { id: 'asset_0', data: new Uint8Array([1, 2, 3]), hash: 'hash', encKey: 'key' }
            ]
        });

        let attempts = 0;
        vi.mocked(AssetService.write).mockImplementation(async () => {
            attempts++;
            if (attempts === 1) {
                throw new Error('Transient error');
            }
            return 'asset-new';
        });

        vi.mocked(CharacterService.create).mockResolvedValue({
            ...character,
            id: 'char-new',
            avatarAssetId: undefined,
            lorebooks: { refs: {}, folders: {} },
            scripts: { refs: {}, folders: {} },
            charjs: { refs: {}, folders: {} },
            assets: { refs: {}, folders: {} }
        });
        vi.mocked(LorebookService.create).mockResolvedValue({ ...lorebook, id: 'lorebook-new' });
        vi.mocked(ScriptService.create).mockResolvedValue({ ...script, id: 'script-new' });
        vi.mocked(CharJSService.create).mockResolvedValue({ ...charjs, id: 'charjs-new' });
        vi.mocked(CharacterService.update).mockResolvedValue({ ...character, id: 'char-new' });

        const characterId = await importCharacterPackage(pkg, { scopeType: 'room' });

        expect(characterId).toBe('char-new');
        expect(attempts).toBe(2);
    });

    it('rolls back created character and assets if database operations fail during import', async () => {
        const pkg = makePackage({
            assets: [
                { id: 'asset_0', data: new Uint8Array([1, 2, 3]), hash: 'hash', encKey: 'key' }
            ]
        });

        vi.mocked(AssetService.write).mockResolvedValue('asset-new');
        vi.mocked(CharacterService.create).mockResolvedValue({
            ...character,
            id: 'char-new',
            avatarAssetId: undefined,
            lorebooks: { refs: {}, folders: {} },
            scripts: { refs: {}, folders: {} },
            charjs: { refs: {}, folders: {} },
            assets: { refs: {}, folders: {} }
        });
        vi.mocked(LorebookService.create).mockRejectedValue(new Error('DB write failed'));
        vi.mocked(CharacterService.delete).mockResolvedValue(undefined as never);
        vi.mocked(AssetService.delete).mockResolvedValue(undefined as never);

        await expect(importCharacterPackage(pkg, { scopeType: 'room' })).rejects.toThrow(
            'DB write failed'
        );

        expect(CharacterService.delete).toHaveBeenCalledWith('char-new');
        expect(AssetService.delete).toHaveBeenCalledWith('asset-new');
    });
});

function makePackage(overrides: Partial<KeiCharacterPackageV1> = {}): KeiCharacterPackageV1 {
    return {
        version: 1,
        kind: 'keiai.character',
        character: {
            name: 'Imported',
            description: 'Description',
            characterNote: 'Note',
            backgroundHTML: '',
            messageCSS: '',
            greetings: {
                greet_1: { id: 'greet_1', content: 'Hi', sortOrder: 'a' }
            },
            defaultVariables: {},
            allowLowLevel: false,
            avatarAssetId: 'asset_0',
            lorebooks: {
                refs: { lorebook_0: { id: 'lorebook_0', sortOrder: 'a' } },
                folders: {}
            },
            scripts: {
                refs: { script_0: { id: 'script_0', sortOrder: 'a' } },
                folders: {}
            },
            charjs: {
                refs: { charjs_0: { id: 'charjs_0', sortOrder: 'a' } },
                folders: {}
            },
            assets: {
                refs: { asset_0: { id: 'asset_0', name: 'Avatar', sortOrder: 'a' } },
                folders: {}
            }
        },
        lorebooks: [
            {
                id: 'lorebook_0',
                name: 'Lore',
                key: 'key',
                secondKey: '',
                content: 'content',
                depth: 1,
                order: 100,
                alwaysActive: false,
                disabled: false,
                role: 'system',
                useRegex: false,
                useMultipleKeys: false,
                probability: 100,
                recursive: false,
                noRecursiveSearch: false
            }
        ],
        scripts: [
            {
                id: 'script_0',
                type: 'regex',
                name: 'Script',
                regex: 'a',
                replacement: 'b',
                phase: 'display',
                advanced: false,
                flag: 'g',
                order: 100,
                repeat: 1,
                enabled: true
            }
        ],
        charjs: [{ id: 'charjs_0', name: 'CharJS', code: 'return input;', enabled: true }],
        assets: [],
        ...overrides
    };
}
