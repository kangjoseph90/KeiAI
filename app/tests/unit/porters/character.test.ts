import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    classifyAsset,
    exportCharacterToKei,
    importCharacterFromKei,
    type KeiCharacterPackageV1
} from '$lib/porters/character';
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
        update: vi.fn()
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
        write: vi.fn()
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
        greetings: {
            greet_1: { id: 'greet_1', content: 'Hello', createdAt: 10 }
        },
        defaultVariables: { mood: 'calm' },
        allowLowLevel: false,
        avatarAssetId: 'asset-avatar',
        modules: {
            refs: { module_real: { id: 'module_real', enabled: true, sortOrder: 'a' } },
            folders: {}
        },
        lorebooks: {
            refs: { lorebook_real: { id: 'lorebook_real', enabled: true, sortOrder: 'a' } },
            folders: {}
        },
        scripts: {
            refs: { script_real: { id: 'script_real', enabled: true, sortOrder: 'a' } },
            folders: {}
        },
        charjs: {
            refs: { charjs_real: { id: 'charjs_real', enabled: true, sortOrder: 'a' } },
            folders: {}
        },
        assets: {
            refs: {
                'asset-avatar': {
                    id: 'asset-avatar',
                    name: 'Avatar',
                    enabled: true,
                    sortOrder: 'a'
                },
                'asset-extra': { id: 'asset-extra', name: 'Extra', enabled: true, sortOrder: 'b' }
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

        const pkg = await exportCharacterToKei('char-real', { mode: 'light' });

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

    it('rejects light assets unless explicitly allowed', async () => {
        const pkg = makePackage({
            assets: [{ id: 'asset_0', hash: 'hash', encKey: 'key' }]
        });

        await expect(importCharacterFromKei(pkg, { allowLightAssets: false })).rejects.toThrow(
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

        await expect(importCharacterFromKei(pkg, { allowLightAssets: true })).rejects.toThrow(
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

        const characterId = await importCharacterFromKei(pkg, { scopeType: 'room' });
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
        expect(update?.lorebooks?.refs['lorebook-new']?.id).toBe('lorebook-new');
        expect(update?.scripts?.refs['script-new']?.id).toBe('script-new');
        expect(update?.charjs?.refs['charjs-new']?.id).toBe('charjs-new');
        expect(update?.assets?.refs['asset-new']?.name).toBe('Avatar');
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
            greetings: {
                greet_1: { id: 'greet_1', content: 'Hi', createdAt: 1 }
            },
            defaultVariables: {},
            allowLowLevel: false,
            avatarAssetId: 'asset_0',
            lorebooks: {
                refs: { lorebook_0: { id: 'lorebook_0', enabled: true, sortOrder: 'a' } },
                folders: {}
            },
            scripts: {
                refs: { script_0: { id: 'script_0', enabled: true, sortOrder: 'a' } },
                folders: {}
            },
            charjs: {
                refs: { charjs_0: { id: 'charjs_0', enabled: true, sortOrder: 'a' } },
                folders: {}
            },
            assets: {
                refs: { asset_0: { id: 'asset_0', name: 'Avatar', enabled: true, sortOrder: 'a' } },
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
