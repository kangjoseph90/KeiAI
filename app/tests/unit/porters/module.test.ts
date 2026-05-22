import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    exportModuleToKei,
    importModuleFromKei,
    type KeiModulePackageV1
} from '$lib/porters/module';
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

describe('module porters', () => {
    const module_: Module = {
        id: 'module-real',
        name: 'Test Module',
        description: 'Module description',
        backgroundHTML: '',
        messageCSS: '',
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
                'asset-avatar': { id: 'asset-avatar', name: 'Avatar', sortOrder: 'a' },
                'asset-extra': { id: 'asset-extra', name: 'Extra', sortOrder: 'b' }
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
        advanced: false,
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
        vi.mocked(AssetService.getFields).mockImplementation(async (id) => ({
            kind: 'resource',
            status: id === 'asset-avatar' ? 'remote' : 'local',
            hash: `${id}-hash`,
            encKey: `${id}-key`
        }));
        vi.mocked(AssetService.readBytes).mockResolvedValue(new Uint8Array([1, 2, 3]));

        const pkg = await exportModuleToKei('module-real', { mode: 'light' });

        expect(pkg.kind).toBe('keiai.module');
        expect(pkg.module.name).toBe('Test Module');
        expect(pkg.module.allowLowLevel).toBe(true);
        expect(pkg.module.lorebooks.refs.lorebook_0?.id).toBe('lorebook_0');
        expect(pkg.module.scripts.refs.script_0?.id).toBe('script_0');
        expect(pkg.module.charjs.refs.charjs_0?.id).toBe('charjs_0');
        expect(pkg.module.assets.refs.asset_0?.name).toBe('Avatar');
        expect(pkg.module.assets.refs.asset_1?.name).toBe('Extra');
        expect(pkg.lorebooks[0]?.id).toBe('lorebook_0');
        expect(pkg.scripts[0]?.id).toBe('script_0');
        expect(pkg.charjs[0]?.id).toBe('charjs_0');
        expect(pkg.assets.find((a) => a.id === 'asset_0')?.data).toBeUndefined();
        expect(pkg.assets.find((a) => a.id === 'asset_1')?.data).toEqual(new Uint8Array([1, 2, 3]));
    });

    it('validates asset payloads before writing imported assets', async () => {
        const pkg = makePackage({
            assets: [
                { id: 'asset_0', data: new Uint8Array([1]), hash: 'hash', encKey: 'key' },
                { id: 'asset_1', hash: 'broken' }
            ]
        });

        await expect(importModuleFromKei(pkg, { allowLightAssets: true })).rejects.toThrow(
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
        vi.mocked(ModuleService.create).mockResolvedValue({
            ...module_,
            id: 'module-new',
            lorebooks: { refs: {}, folders: {} },
            scripts: { refs: {}, folders: {} },
            charjs: { refs: {}, folders: {} },
            assets: { refs: {}, folders: {} }
        });
        vi.mocked(LorebookService.create).mockResolvedValue({ ...lorebook, id: 'lorebook-new' });
        vi.mocked(ScriptService.create).mockResolvedValue({ ...script, id: 'script-new' });
        vi.mocked(CharJSService.create).mockResolvedValue({ ...charjs, id: 'charjs-new' });
        vi.mocked(ModuleService.update).mockResolvedValue({ ...module_, id: 'module-new' });

        const moduleId = await importModuleFromKei(pkg);
        const update = vi.mocked(ModuleService.update).mock.calls[0]?.[1];

        expect(moduleId).toBe('module-new');
        expect(AssetService.write).toHaveBeenCalledWith(expect.any(File), 'resource', {
            scopeType: 'user'
        });
        expect(ModuleService.create).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'Imported Module' })
        );
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
        expect(update?.assets?.refs?.['asset-new']?.name).toBe('Avatar');
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
