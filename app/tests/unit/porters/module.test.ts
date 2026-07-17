import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    exportModulePackage,
    importModulePackage,
    moduleFileExtension,
    readModuleFile,
    writeModuleFile,
    type KeiModulePackageV1
} from '$lib/porters/module';
import { unzip, zip } from '$lib/utils/zip';
import { AssetService } from '$lib/services/asset';
import {
    CharJSService,
    LorebookService,
    ModuleService,
    ScriptService,
    type CharJS,
    type Lorebook,
    type Module,
    type Script
} from '$lib/services';

vi.mock('$lib/services', () => ({
    ModuleService: {
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        createAsset: vi.fn()
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
        readBytes: vi.fn(),
        write: vi.fn()
    }
}));

vi.mock('$lib/services/session', () => ({
    getSessionScope: vi.fn(() => ({ scopeType: 'user', scopeId: 'user-1' }))
}));

describe('module porters', () => {
    const module_: Module = {
        id: 'module-real',
        name: 'Test Module',
        description: 'Module description',
        backgroundHTML: '',
        messageCSS: '',
        defaultVariables: { mood: 'quiet' },
        allowLowLevel: true,
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
                    sortOrder: 'a',
                    hash: 'asset-avatar-hash',
                    encKey: 'asset-avatar-key',
                    mimeType: 'image/png'
                },
                'asset-extra': {
                    id: 'asset-extra',
                    name: 'Extra',
                    sortOrder: 'b',
                    hash: 'asset-extra-hash',
                    encKey: 'asset-extra-key',
                    mimeType: 'image/png'
                }
            },
            folders: {}
        }
    };

    const lorebook: Lorebook = {
        id: 'lorebook_real',
        ownerId: 'module-real',
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
        ownerId: 'module-real',
        scopeType: 'user',
        scopeId: 'user-1',
        type: 'regex',
        name: 'Script',
        regex: 'a',
        replacement: 'b',
        phase: 'display',
        flag: 'g',
        order: 100,
        repeat: 1,
        enabled: true
    };

    const charjs: CharJS = {
        id: 'charjs_real',
        ownerId: 'module-real',
        scopeType: 'user',
        scopeId: 'user-1',
        name: 'CharJS',
        code: 'return input;',
        enabled: true
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('exports a module package with portable ids and asset payloads', async () => {
        vi.mocked(ModuleService.get).mockResolvedValue(module_);
        vi.mocked(LorebookService.listByOwner).mockResolvedValue([lorebook]);
        vi.mocked(ScriptService.listByOwner).mockResolvedValue([script]);
        vi.mocked(CharJSService.listByOwner).mockResolvedValue([charjs]);
        vi.mocked(AssetService.readBytes).mockResolvedValue(new Uint8Array([1, 2, 3]));

        const pkg = await exportModulePackage('module-real', 'baked');

        expect(pkg.kind).toBe('keiai.module');
        expect(pkg.module.name).toBe('Test Module');
        expect(pkg.module.allowLowLevel).toBe(true);
        expect(pkg.module.defaultVariables).toEqual({ mood: 'quiet' });
        expect(pkg.module.lorebooks.refs.lorebook_0?.id).toBe('lorebook_0');
        expect(pkg.module.scripts.refs.script_0?.id).toBe('script_0');
        expect(pkg.module.charjs.refs.charjs_0?.id).toBe('charjs_0');
        expect(pkg.module.assets.refs.asset_0?.name).toBe('Avatar');
        expect(pkg.module.assets.refs.asset_1?.name).toBe('Extra');
        expect(pkg.lorebooks[0]?.id).toBe('lorebook_0');
        expect(pkg.scripts[0]?.id).toBe('script_0');
        expect(pkg.charjs[0]?.id).toBe('charjs_0');
        expect(pkg.assets['asset_0']?.data).toEqual(new Uint8Array([1, 2, 3]));
        expect(pkg.assets['asset_1']?.data).toEqual(new Uint8Array([1, 2, 3]));
    });

    it('validates asset payloads before writing imported assets', async () => {
        const pkg = makePackage({
            assets: {
                asset_0: { data: new Uint8Array([1]), hash: 'hash', encKey: 'key' },
                asset_1: { hash: 'broken' }
            }
        });

        // importAssetPayloads runs after create, so create must succeed
        vi.mocked(ModuleService.create).mockResolvedValue({
            ...module_,
            id: 'module-new',
            lorebooks: { refs: {}, folders: {} },
            scripts: { refs: {}, folders: {} },
            charjs: { refs: {}, folders: {} },
            assets: { refs: {}, folders: {} }
        });
        vi.mocked(ModuleService.delete).mockResolvedValue(undefined as never);

        await expect(importModulePackage(pkg, { allowLightAssets: true })).rejects.toThrow(
            'Broken asset payload'
        );
    });

    it('imports package records and reconnects refs to created ids', async () => {
        const pkg = makePackage({
            assets: {
                asset_0: { data: new Uint8Array([1, 2, 3]), hash: 'hash', encKey: 'key' }
            }
        });

        vi.mocked(ModuleService.create).mockResolvedValue({
            ...module_,
            id: 'module-new',
            lorebooks: { refs: {}, folders: {} },
            scripts: { refs: {}, folders: {} },
            charjs: { refs: {}, folders: {} },
            assets: { refs: {}, folders: {} }
        });
        vi.mocked(ModuleService.createAsset).mockResolvedValue({
            ...module_,
            id: 'module-new',
            assets: {
                refs: {
                    'asset-new': {
                        id: 'asset-new',
                        name: 'Avatar',
                        sortOrder: 'a',
                        hash: 'hash',
                        encKey: 'key',
                        mimeType: 'image/png'
                    }
                },
                folders: {}
            }
        });
        vi.mocked(LorebookService.create).mockResolvedValue({ ...lorebook, id: 'lorebook-new' });
        vi.mocked(ScriptService.create).mockResolvedValue({ ...script, id: 'script-new' });
        vi.mocked(CharJSService.create).mockResolvedValue({ ...charjs, id: 'charjs-new' });
        vi.mocked(ModuleService.update).mockResolvedValue({ ...module_, id: 'module-new' });
        vi.mocked(ModuleService.get).mockResolvedValue({
            ...module_,
            id: 'module-new',
            assets: {
                refs: {
                    'asset-new': {
                        id: 'asset-new',
                        name: 'Avatar',
                        sortOrder: 'a',
                        hash: 'hash',
                        encKey: 'key',
                        mimeType: 'image/png'
                    }
                },
                folders: {}
            }
        });

        const moduleId = await importModulePackage(pkg);
        const update = vi.mocked(ModuleService.update).mock.calls[0]?.[1];

        expect(moduleId).toBe('module-new');
        expect(ModuleService.create).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'Imported Module',
                defaultVariables: {}
            })
        );
        expect(ModuleService.createAsset).toHaveBeenCalledWith('module-new', expect.any(File), 'a');
        expect(LorebookService.create).toHaveBeenCalledWith(
            'module-new',
            expect.objectContaining({ name: 'Lore' })
        );
        expect(ScriptService.create).toHaveBeenCalledWith(
            'module-new',
            expect.objectContaining({ name: 'Script' })
        );
        expect(CharJSService.create).toHaveBeenCalledWith(
            'module-new',
            expect.objectContaining({ name: 'CharJS' })
        );
        expect(update?.lorebooks?.refs?.['lorebook-new']?.id).toBe('lorebook-new');
        expect(update?.scripts?.refs?.['script-new']?.id).toBe('script-new');
        expect(update?.charjs?.refs?.['charjs-new']?.id).toBe('charjs-new');
    });
});

function makePackage(overrides: Partial<KeiModulePackageV1> = {}): KeiModulePackageV1 {
    return {
        version: 1,
        kind: 'keiai.module',
        module: {
            name: 'Imported Module',
            description: 'Description',
            backgroundHTML: '',
            messageCSS: '',
            defaultVariables: {},
            allowLowLevel: true,
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
                refs: {
                    asset_0: {
                        id: 'asset_0',
                        name: 'Avatar',
                        sortOrder: 'a',
                        hash: 'asset-avatar-hash',
                        encKey: 'asset-avatar-key',
                        mimeType: 'image/png'
                    }
                },
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
                flag: 'g',
                order: 100,
                repeat: 1,
                enabled: true
            }
        ],
        charjs: [{ id: 'charjs_0', name: 'CharJS', code: 'return input;', enabled: true }],
        assets: {},
        ...overrides
    };
}

describe('extensionless native module imports', () => {
    it('detects a Kei module archive by content', async () => {
        const bytes = writeModuleFile(makePackage(), {
            kind: 'keimodule',
            assetMode: 'baked'
        });

        await expect(
            readModuleFile(new File([bytes.slice()], 'content:42'))
        ).resolves.toMatchObject({
            kind: 'keiai.module',
            module: { name: 'Imported Module' }
        });
    });

    it('detects a module CharX archive by content', async () => {
        const bytes = writeModuleFile(makePackage(), { kind: 'risu', format: 'charx' });

        await expect(
            readModuleFile(new File([bytes.slice()], 'content:42'))
        ).resolves.toMatchObject({
            kind: 'keiai.module',
            module: { name: 'Imported Module', description: 'Description' }
        });
    });
});

describe('module CharX files', () => {
    it('round-trips the complete Kei module package through CharX', async () => {
        const pkg = makePackage({
            assets: { asset_0: { data: new Uint8Array([1, 2, 3]) } }
        });
        pkg.module.backgroundHTML = '<div>Background</div>';
        pkg.module.messageCSS = '.message { color: red; }';
        pkg.module.defaultVariables = { mood: 'quiet' };

        const bytes = writeModuleFile(pkg, { kind: 'risu', format: 'charx' });
        const entries = await unzip(bytes);
        const card = JSON.parse(new TextDecoder().decode(entries['card.json'])) as {
            data: { description: string; creator_notes: string };
        };
        const imported = await readModuleFile(new File([bytes.slice()], 'module.charx'));

        expect(moduleFileExtension({ kind: 'risu', format: 'charx' })).toBe('charx');
        expect(entries['module.risum']).toBeTruthy();
        expect(card.data.description).toBe('');
        expect(card.data.creator_notes).toBe('Description');
        expect(imported).toEqual(pkg);
    });

    it('imports Risu-style CharX without a KeiAI extension', async () => {
        const pkg = makePackage({
            assets: { asset_0: { data: new Uint8Array([1, 2, 3]) } }
        });
        const entries = await unzip(writeModuleFile(pkg, { kind: 'risu', format: 'charx' }));
        const card = JSON.parse(new TextDecoder().decode(entries['card.json'])) as {
            data: { extensions: Record<string, unknown> };
        };
        delete card.data.extensions.keiai;
        entries['card.json'] = new TextEncoder().encode(JSON.stringify(card));

        const imported = await readModuleFile(
            new File([zip(entries).slice()], 'risu-module.charx')
        );

        expect(imported.module.name).toBe('Imported Module');
        expect(imported.module.description).toBe('Description');
        expect(imported.module.allowLowLevel).toBe(true);
        expect(imported.lorebooks).toHaveLength(1);
        expect(imported.scripts).toHaveLength(1);
        expect(imported.assets.asset_0?.data).toEqual(new Uint8Array([1, 2, 3]));
        expect(imported.charjs).toEqual([]);
    });
});
