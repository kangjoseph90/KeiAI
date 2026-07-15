import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    exportPersonaPackage,
    importPersonaPackage,
    readPersonaFile,
    writePersonaFile,
    type KeiPersonaPackageV1
} from '$lib/porters/persona';
import { AssetService } from '$lib/services/asset';
import { PersonaService, type Persona } from '$lib/services';

vi.mock('$lib/services', () => ({
    PersonaService: {
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        updateAvatar: vi.fn(),
        createAsset: vi.fn()
    }
}));

vi.mock('$lib/services/asset', () => ({
    AssetService: {
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
        avatar: {
            name: 'Avatar',
            hash: 'asset-avatar-hash',
            encKey: 'asset-avatar-key',
            mimeType: 'image/png'
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

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('exports a persona package with portable asset ids', async () => {
        vi.mocked(PersonaService.get).mockResolvedValue(persona);
        vi.mocked(AssetService.readBytes).mockResolvedValue(new Uint8Array([1, 2, 3]));

        const pkg = await exportPersonaPackage('persona-real', 'baked');

        expect(pkg.kind).toBe('keiai.persona');
        expect(pkg.persona.avatar?.hash).toBe('asset-avatar-hash');
        expect(pkg.persona.assets.refs.asset_1?.name).toBe('Extra');
        expect(pkg.assets['asset_0']?.data).toEqual(new Uint8Array([1, 2, 3]));
        expect(pkg.assets['asset_1']?.data).toEqual(new Uint8Array([1, 2, 3]));
        expect(pkg.avatar?.data).toEqual(new Uint8Array([1, 2, 3]));
    });

    it('validates asset payloads before writing imported assets', async () => {
        const pkg = makePackage({
            assets: {
                asset_0: { data: new Uint8Array([1]), hash: 'hash', encKey: 'key' },
                asset_1: { hash: 'broken' }
            }
        });

        // importAssetPayloads runs after create, so create must succeed
        vi.mocked(PersonaService.create).mockResolvedValue({
            ...persona,
            id: 'persona-new',
            avatar: undefined,
            assets: { refs: {}, folders: {} }
        });
        vi.mocked(PersonaService.delete).mockResolvedValue(undefined as never);

        await expect(importPersonaPackage(pkg, { allowLightAssets: true })).rejects.toThrow(
            'Broken asset payload'
        );
    });

    it('imports a persona package and reconnects asset refs', async () => {
        const pkg = makePackage({
            avatar: { data: new Uint8Array([1, 2, 3]), hash: 'hash', encKey: 'key' },
            assets: {
                asset_0: { data: new Uint8Array([1, 2, 3]), hash: 'hash', encKey: 'key' }
            }
        });

        vi.mocked(PersonaService.create).mockResolvedValue({
            ...persona,
            id: 'persona-new',
            avatar: undefined,
            assets: { refs: {}, folders: {} }
        });
        vi.mocked(PersonaService.updateAvatar).mockResolvedValue({
            ...persona,
            id: 'persona-new',
            avatar: {
                name: 'Avatar',
                hash: 'hash',
                encKey: 'key',
                mimeType: 'application/octet-stream'
            }
        });
        vi.mocked(PersonaService.createAsset).mockResolvedValue({
            ...persona,
            id: 'persona-new',
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
        vi.mocked(PersonaService.get).mockResolvedValue({
            ...persona,
            id: 'persona-new',
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
        vi.mocked(PersonaService.update).mockResolvedValue({ ...persona, id: 'persona-new' });

        const personaId = await importPersonaPackage(pkg, { scopeType: 'room' });

        expect(personaId).toBe('persona-new');
        expect(PersonaService.create).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'Imported Persona' }),
            'room'
        );
        expect(PersonaService.updateAvatar).toHaveBeenCalledWith('persona-new', expect.any(File));
        expect(PersonaService.createAsset).toHaveBeenCalledWith(
            'persona-new',
            expect.any(File),
            'a'
        );
    });
});

function makePackage(overrides: Partial<KeiPersonaPackageV1> = {}): KeiPersonaPackageV1 {
    return {
        version: 1,
        kind: 'keiai.persona',
        persona: {
            name: 'Imported Persona',
            description: 'Imported description',
            avatar: {
                name: 'Avatar',
                hash: 'asset-avatar-hash',
                encKey: 'asset-avatar-key',
                mimeType: 'image/png'
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
        assets: {},
        avatar: undefined,
        ...overrides
    };
}

describe('extensionless native persona imports', () => {
    it('detects a Kei persona archive by content', async () => {
        const bytes = await writePersonaFile(makePackage(), {
            kind: 'keipersona',
            assetMode: 'baked'
        });

        await expect(
            readPersonaFile(new File([bytes.slice()], 'content:42'))
        ).resolves.toMatchObject({
            kind: 'keiai.persona',
            persona: { name: 'Imported Persona' }
        });
    });
});
