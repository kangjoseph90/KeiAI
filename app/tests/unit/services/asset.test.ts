import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetService, type AssetReadLocator } from '$lib/services/asset';
import type { AssetLocator, AssetOwner, AssetRegistryRecord } from '$lib/adapters/asset';

vi.mock('$lib/services/user', () => ({
    UserService: {}
}));

vi.mock('$lib/services/session', () => ({
    getActiveSession: vi.fn(),
    getSessionScope: vi.fn((scopeType: 'user' | 'room') => {
        if (scopeType === 'user') return { scopeType: 'user', scopeId: 'user-123' };
        return { scopeType: 'room', scopeId: 'room-123' };
    }),
    canAccessScope: vi.fn((record: { scopeType: string; scopeId: string }) => {
        return (
            (record.scopeType === 'user' && record.scopeId === 'user-123') ||
            (record.scopeType === 'room' && record.scopeId === 'room-123')
        );
    })
}));

vi.mock('$lib/adapters/db', () => ({
    localDB: {
        getRecord: vi.fn().mockResolvedValue({
            id: 'char-123',
            scopeType: 'user',
            scopeId: 'user-123',
            assetEntries: {}
        }),
        putRecord: vi.fn().mockResolvedValue(undefined)
    }
}));

vi.mock('$lib/adapters/asset', () => ({
    appAsset: {
        flush: vi.fn(),
        putLocalAsset: vi.fn(),
        putRemoteAsset: vi.fn(),
        getAsset: vi.fn(),
        deleteAsset: vi.fn(),
        deleteOwnerAssets: vi.fn(),
        deleteScopeAssets: vi.fn(),
        getAllLocalAssets: vi.fn(),
        getAllRemoteAssets: vi.fn(),
        readAssetBytes: vi.fn(),
        getRenderUrl: vi.fn(),
        revokeRenderUrl: vi.fn(),
        touchAsset: vi.fn(),
        markAssetRemote: vi.fn(),
        markAssetLocal: vi.fn(),
        markAssetsRemote: vi.fn(),
        markAssetsLocal: vi.fn(),
        transaction: vi.fn((cb) => cb())
    },
    assetRegistryId: vi.fn(
        (loc) => `${loc.scopeType}:${loc.scopeId}:${loc.ownerTable}:${loc.ownerId}:${loc.hash}`
    )
}));

vi.mock('$lib/crypto', () => ({
    sha256: vi.fn()
}));

vi.mock('$lib/services/asset/util', () => ({
    encryptConvergentAsset: vi.fn(),
    decryptConvergentAsset: vi.fn(),
    fileToPlaintext: vi
        .fn()
        .mockResolvedValue({ bytes: new Uint8Array([7, 8, 9, 10]), mimeType: 'image/png' })
}));

vi.mock('$lib/services/asset/remote', () => ({
    fetchAssetCiphertext: vi.fn()
}));

import { getActiveSession } from '$lib/services/session';
import { appAsset } from '$lib/adapters/asset';
import { sha256 } from '$lib/crypto';
import {
    decryptConvergentAsset,
    encryptConvergentAsset,
    fileToPlaintext
} from '$lib/services/asset/util';
import { fetchAssetCiphertext } from '$lib/services/asset/remote';

describe('AssetService', () => {
    const mockUserId = 'user-123';
    const mockBytes = new Uint8Array([7, 8, 9, 10]);
    const mockCiphertext = new Uint8Array([1, 2, 3]);

    const mockRegistry: AssetRegistryRecord = {
        id: 'user:user-123:characters:char-123:hash-123',
        scopeType: 'user',
        scopeId: mockUserId,
        ownerTable: 'characters',
        ownerId: 'char-123',
        hash: 'hash-123',
        encKey: 'enc-key',
        status: 'remote',
        size: 100,
        accessedAt: 1000
    };

    beforeEach(() => {
        AssetService.clear();
        vi.clearAllMocks();
        vi.mocked(getActiveSession).mockReturnValue({
            userId: mockUserId,
            masterKey: {} as CryptoKey,
            identityKeyPair: {} as CryptoKeyPair
        });

        vi.mocked(appAsset.putLocalAsset).mockResolvedValue(mockRegistry);
        vi.mocked(appAsset.putRemoteAsset).mockResolvedValue(mockRegistry);
        vi.mocked(appAsset.getAsset).mockResolvedValue(undefined);
        vi.mocked(appAsset.getRenderUrl).mockResolvedValue(null);

        vi.mocked(encryptConvergentAsset).mockResolvedValue({
            ciphertext: mockCiphertext,
            hash: 'hash-123',
            encKey: 'enc-key'
        });
        vi.mocked(fetchAssetCiphertext).mockResolvedValue(mockCiphertext);
        vi.mocked(sha256).mockResolvedValue('hash-123');
        vi.mocked(decryptConvergentAsset).mockResolvedValue(mockBytes);
    });

    it('creates local asset metadata, plaintext storage, and registry cache index', async () => {
        const file = new File([mockBytes], 'avatar.png', { type: 'image/png' });
        const owner: AssetOwner = {
            scopeType: 'user',
            scopeId: mockUserId,
            ownerTable: 'characters',
            ownerId: 'char-123'
        };

        const fields = await AssetService.write(file, owner);

        expect(fields).toEqual({
            name: 'avatar.png',
            hash: 'hash-123',
            encKey: 'enc-key',
            mimeType: 'image/png'
        });
        expect(appAsset.putLocalAsset).toHaveBeenCalledWith(
            expect.objectContaining({
                scopeType: 'user',
                scopeId: mockUserId,
                ownerTable: 'characters',
                ownerId: 'char-123',
                hash: 'hash-123',
                encKey: 'enc-key',
                bytes: mockBytes
            })
        );
    });

    it('deletes logical asset and local cache registry entry', async () => {
        const locator: AssetLocator = {
            scopeType: 'user',
            scopeId: mockUserId,
            ownerTable: 'characters',
            ownerId: 'char-123',
            hash: 'hash-123'
        };
        await AssetService.delete(locator);

        expect(appAsset.deleteAsset).toHaveBeenCalledWith(locator);
    });

    it('returns cached render URL and refreshes registry index when local bytes exist', async () => {
        const locator: AssetReadLocator = {
            scopeType: 'user',
            scopeId: mockUserId,
            ownerTable: 'characters',
            ownerId: 'char-123',
            hash: 'hash-123',
            encKey: 'enc-key'
        };
        vi.mocked(appAsset.getRenderUrl).mockResolvedValue('blob:asset-123');

        const url = await AssetService.read(locator);

        expect(url).toBe('blob:asset-123');
        expect(appAsset.getRenderUrl).toHaveBeenCalledWith(locator);
    });

    it('revokes cached render URLs when service state is cleared', async () => {
        const locator: AssetReadLocator = {
            scopeType: 'user',
            scopeId: mockUserId,
            ownerTable: 'characters',
            ownerId: 'char-123',
            hash: 'hash-123',
            encKey: 'enc-key'
        };
        vi.mocked(appAsset.getRenderUrl).mockResolvedValue('blob:asset-123');

        await AssetService.read(locator);
        AssetService.clear();

        expect(appAsset.revokeRenderUrl).toHaveBeenCalledWith('blob:asset-123');
    });

    it('downloads, verifies, decrypts, and caches remote ciphertext', async () => {
        const locator: AssetReadLocator = {
            scopeType: 'user',
            scopeId: mockUserId,
            ownerTable: 'characters',
            ownerId: 'char-123',
            hash: 'hash-123',
            encKey: 'enc-key'
        };
        vi.mocked(appAsset.getRenderUrl)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce('blob:asset-123');

        const url = await AssetService.read(locator);

        expect(url).toBe('blob:asset-123');
        expect(fetchAssetCiphertext).toHaveBeenCalledWith('hash-123');
        expect(sha256).toHaveBeenCalledWith(mockCiphertext);
        expect(decryptConvergentAsset).toHaveBeenCalledWith(mockCiphertext, 'enc-key');
        expect(appAsset.putRemoteAsset).toHaveBeenCalledWith(
            expect.objectContaining({
                scopeType: 'user',
                scopeId: mockUserId,
                ownerTable: 'characters',
                ownerId: 'char-123',
                hash: 'hash-123',
                bytes: mockBytes
            })
        );
    });
});
