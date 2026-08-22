import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportCharacterPackage } from '$lib/porters/character';
import { exportModulePackage } from '$lib/porters/module';
import type { PorterProgress } from '$lib/porters/progress';
import { AssetService } from '$lib/services/asset';
import { CharacterService, type Character } from '$lib/services';
import { ModuleService, type Module } from '$lib/services';

vi.mock('$lib/services', () => ({
    CharacterService: {
        get: vi.fn()
    },
    ModuleService: {
        get: vi.fn()
    }
}));

vi.mock('$lib/services/session', () => ({
    getSessionScope: vi.fn(() => ({ scopeType: 'user', scopeId: 'user-1' }))
}));

vi.mock('$lib/services/asset', () => ({
    AssetService: {
        readBytes: vi.fn(),
        load: vi.fn()
    }
}));

const assetRef = (id: string, sortOrder: string) => ({
    id,
    name: id,
    sortOrder,
    hash: `hash-${id}`,
    encKey: `key-${id}`,
    mimeType: 'image/png'
});

describe('porter progress reporting', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(AssetService.readBytes).mockResolvedValue(new Uint8Array([1]));
    });

    it('counts avatar and list assets while exporting a character', async () => {
        const character: Character = {
            id: 'character-real',
            scopeType: 'user',
            scopeId: 'user-1',
            name: 'Character',
            description: '',
            characterNote: '',
            backgroundHTML: '',
            messageCSS: '',
            greetings: {},
            defaultVariables: {},
            lorebooks: { refs: {}, folders: {} },
            scripts: { refs: {}, folders: {} },
            charjs: { refs: {}, folders: {} },
            allowLowLevel: false,
            avatar: {
                name: 'Avatar',
                hash: 'hash-avatar',
                encKey: 'key-avatar',
                mimeType: 'image/png'
            },
            assets: {
                refs: {
                    'asset-one': assetRef('asset-one', 'a'),
                    'asset-two': assetRef('asset-two', 'b')
                },
                folders: {}
            }
        };
        vi.mocked(CharacterService.get).mockResolvedValue(character);

        const events: PorterProgress[] = [];
        await exportCharacterPackage('character-real', 'baked', (progress) =>
            events.push(progress)
        );

        expect(events).toEqual([
            { phase: 'preparing', completed: 0, total: 0 },
            { phase: 'processing-assets', completed: 0, total: 3 },
            { phase: 'processing-assets', completed: 1, total: 3 },
            { phase: 'processing-assets', completed: 2, total: 3 },
            { phase: 'processing-assets', completed: 3, total: 3 }
        ]);
    });

    it('reports an asset-less character export without a total', async () => {
        const character: Character = {
            id: 'character-bare',
            scopeType: 'user',
            scopeId: 'user-1',
            name: 'Character',
            description: '',
            characterNote: '',
            backgroundHTML: '',
            messageCSS: '',
            greetings: {},
            defaultVariables: {},
            lorebooks: { refs: {}, folders: {} },
            scripts: { refs: {}, folders: {} },
            charjs: { refs: {}, folders: {} },
            allowLowLevel: false,
            assets: { refs: {}, folders: {} }
        };
        vi.mocked(CharacterService.get).mockResolvedValue(character);

        const events: PorterProgress[] = [];
        await exportCharacterPackage('character-bare', 'light', (progress) =>
            events.push(progress)
        );

        expect(events).toEqual([
            { phase: 'preparing', completed: 0, total: 0 },
            { phase: 'processing-assets', completed: 0, total: 0 }
        ]);
    });

    it('counts list assets while exporting a module', async () => {
        const mod: Module = {
            id: 'module-real',
            name: 'Module',
            description: '',
            backgroundHTML: '',
            messageCSS: '',
            defaultVariables: {},
            toggles: { refs: {}, folders: {} },
            commands: { refs: {}, folders: {} },
            lorebooks: { refs: {}, folders: {} },
            scripts: { refs: {}, folders: {} },
            charjs: { refs: {}, folders: {} },
            allowLowLevel: false,
            assets: {
                refs: {
                    'asset-one': assetRef('asset-one', 'a'),
                    'asset-two': assetRef('asset-two', 'b')
                },
                folders: {}
            }
        };
        vi.mocked(ModuleService.get).mockResolvedValue(mod);

        const events: PorterProgress[] = [];
        await exportModulePackage('module-real', 'baked', (progress) => events.push(progress));

        expect(events).toEqual([
            { phase: 'preparing', completed: 0, total: 0 },
            { phase: 'processing-assets', completed: 0, total: 2 },
            { phase: 'processing-assets', completed: 1, total: 2 },
            { phase: 'processing-assets', completed: 2, total: 2 }
        ]);
    });
});
