import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    exportPersonaToKei,
    importPersonaFromKei,
    type KeiPersonaPackageV1
} from '$lib/porters/persona';
import { AssetService } from '$lib/services/asset';
import { PersonaService, type Persona } from '$lib/services';

vi.mock('$lib/services', () => ({
    PersonaService: {
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn()
    }
}));

vi.mock('$lib/services/asset', () => ({
    AssetService: {
        getFields: vi.fn(),
        readBytes: vi.fn(),
        write: vi.fn()
    }
}));

describe('persona porters', () => {
    const persona: Persona = {
        id: 'persona-real',
        scopeType: 'user',
        scopeId: 'user-1',
        name: 'Persona',
        description: 'Persona description',
        avatarAssetId: 'asset-avatar',
        assets: {
            refs: {
                'asset-avatar': { id: 'asset-avatar', name: 'Avatar', sortOrder: 'a' },
                'asset-extra': { id: 'asset-extra', name: 'Extra', sortOrder: 'b' }
            },
            folders: {}
        }
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('exports a persona package with portable asset ids', async () => {
        vi.mocked(PersonaService.get).mockResolvedValue(persona);
        vi.mocked(AssetService.getFields).mockImplementation(async (id) => ({
            kind: 'resource',
            status: id === 'asset-avatar' ? 'remote' : 'local',
            hash: `${id}-hash`,
            encKey: `${id}-key`
        }));
        vi.mocked(AssetService.readBytes).mockResolvedValue(new Uint8Array([1, 2, 3]));

        const pkg = await exportPersonaToKei('persona-real', { mode: 'light' });

        expect(pkg.kind).toBe('keiai.persona');
        expect(pkg.persona.avatarAssetId).toBe('asset_0');
        expect(pkg.persona.assets.refs.asset_1?.name).toBe('Extra');
        expect(pkg.assets.find((asset) => asset.id === 'asset_0')?.data).toBeUndefined();
        expect(pkg.assets.find((asset) => asset.id === 'asset_1')?.data).toEqual(
            new Uint8Array([1, 2, 3])
        );
    });

    it('validates asset payloads before writing imported assets', async () => {
        const pkg = makePackage({
            assets: [
                { id: 'asset_0', data: new Uint8Array([1]), hash: 'hash', encKey: 'key' },
                { id: 'asset_1', hash: 'broken' }
            ]
        });

        await expect(importPersonaFromKei(pkg, { allowLightAssets: true })).rejects.toThrow(
            'Broken asset payload'
        );
        expect(AssetService.write).not.toHaveBeenCalled();
    });

    it('imports a persona package and reconnects asset refs', async () => {
        const pkg = makePackage({
            assets: [
                { id: 'asset_0', data: new Uint8Array([1, 2, 3]), hash: 'hash', encKey: 'key' }
            ]
        });

        vi.mocked(AssetService.write).mockResolvedValue('asset-new');
        vi.mocked(PersonaService.create).mockResolvedValue({
            ...persona,
            id: 'persona-new',
            avatarAssetId: undefined,
            assets: { refs: {}, folders: {} }
        });
        vi.mocked(PersonaService.update).mockResolvedValue({ ...persona, id: 'persona-new' });

        const personaId = await importPersonaFromKei(pkg, { scopeType: 'room' });
        const update = vi.mocked(PersonaService.update).mock.calls[0]?.[1];

        expect(personaId).toBe('persona-new');
        expect(AssetService.write).toHaveBeenCalledWith(expect.any(File), 'resource', {
            scopeType: 'room'
        });
        expect(PersonaService.create).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'Imported Persona' }),
            'room'
        );
        expect(update?.avatarAssetId).toBe('asset-new');
        expect(update?.assets?.refs?.['asset-new']?.name).toBe('Avatar');
    });
});

function makePackage(overrides: Partial<KeiPersonaPackageV1> = {}): KeiPersonaPackageV1 {
    return {
        version: 1,
        kind: 'keiai.persona',
        persona: {
            name: 'Imported Persona',
            description: 'Imported description',
            avatarAssetId: 'asset_0',
            assets: {
                refs: { asset_0: { id: 'asset_0', name: 'Avatar', sortOrder: 'a' } },
                folders: {}
            }
        },
        assets: [],
        ...overrides
    };
}
