import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetService } from '$lib/services/asset';
import type { AssetRecord, AssetRegistryRecord } from '$lib/adapters/asset';

vi.mock('$lib/services/user', () => ({
    UserService: {},
    getActiveSession: vi.fn(),
    hasActiveSession: vi.fn()
}));

vi.mock('$lib/adapters/asset', () => ({
    appAsset: {
        getAsset: vi.fn(),
        putAsset: vi.fn(),
        softDeleteAsset: vi.fn(),
        getRegistry: vi.fn(),
        putRegistry: vi.fn(),
        deleteRegistry: vi.fn(),
        getRegistryByStatus: vi.fn()
    }
}));

vi.mock('$lib/adapters/storage', () => ({
    appStorage: {
        write: vi.fn(),
        read: vi.fn(),
        delete: vi.fn(),
        exists: vi.fn(),
        getRenderUrl: vi.fn(),
        revokeRenderUrl: vi.fn(),
        getSize: vi.fn()
    }
}));

vi.mock('$lib/crypto', () => ({
    sha256: vi.fn()
}));

vi.mock('$lib/utils/id', () => ({
    generateId: vi.fn(() => 'asset-123')
}));

vi.mock('$lib/services/asset/util', () => ({
    preprocessImage: vi.fn(),
    encryptConvergentAsset: vi.fn(),
    decryptConvergentAsset: vi.fn(),
    isValidImageHeader: vi.fn(),
    parseFields: vi.fn((record: AssetRecord) => record.data)
}));

vi.mock('$lib/services/asset/remote', () => ({
    fetchAssetCiphertext: vi.fn()
}));

vi.mock('$lib/services/sync/asset', () => ({
    AssetSyncService: {
        pushById: vi.fn(),
        start: vi.fn()
    }
}));

import { getActiveSession } from '$lib/services/user';
import { appAsset } from '$lib/adapters/asset';
import { appStorage } from '$lib/adapters/storage';
import { sha256 } from '$lib/crypto';
import {
    decryptConvergentAsset,
    encryptConvergentAsset,
    isValidImageHeader,
    preprocessImage
} from '$lib/services/asset/util';
import { fetchAssetCiphertext } from '$lib/services/asset/remote';

describe('AssetService', () => {
    const mockUserId = 'user-123';
    const mockBytes = new Uint8Array([7, 8, 9, 10]);
    const mockCiphertext = new Uint8Array([1, 2, 3]);

    const mockRecord: AssetRecord = {
        id: 'asset-123',
        userId: mockUserId,
        createdAt: 1000,
        updatedAt: 1000,
        isDeleted: false,
        data: {
            kind: 'resource',
            status: 'remote',
            hash: 'hash-123',
            encKey: 'enc-key'
        }
    };

    const mockRegistry: AssetRegistryRecord = {
        id: 'asset-123',
        userId: mockUserId,
        createdAt: 1000,
        updatedAt: 1000,
        isDeleted: false,
        kind: 'resource',
        status: 'remote',
        size: 100,
        accessedAt: 1000
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getActiveSession).mockReturnValue({
            userId: mockUserId,
            masterKey: {} as CryptoKey,
            identityKeyPair: {} as CryptoKeyPair
        });

        vi.mocked(appAsset.getAsset).mockResolvedValue(undefined);
        vi.mocked(appAsset.putAsset).mockResolvedValue(undefined);
        vi.mocked(appAsset.softDeleteAsset).mockResolvedValue(undefined);
        vi.mocked(appAsset.getRegistry).mockResolvedValue(undefined);
        vi.mocked(appAsset.putRegistry).mockResolvedValue(undefined);
        vi.mocked(appAsset.deleteRegistry).mockResolvedValue(undefined);
        vi.mocked(appAsset.getRegistryByStatus).mockResolvedValue([]);

        vi.mocked(appStorage.write).mockResolvedValue(undefined);
        vi.mocked(appStorage.delete).mockResolvedValue(undefined);
        vi.mocked(appStorage.exists).mockResolvedValue(false);
        vi.mocked(appStorage.getRenderUrl).mockResolvedValue('blob:asset-123');
        vi.mocked(appStorage.revokeRenderUrl).mockResolvedValue(undefined);
        vi.mocked(appStorage.getSize).mockResolvedValue(100);

        vi.mocked(preprocessImage).mockResolvedValue({
            blob: new Blob([mockBytes], { type: 'image/webp' }),
            width: 100,
            height: 100
        });
        vi.mocked(encryptConvergentAsset).mockResolvedValue({
            ciphertext: mockCiphertext,
            hash: 'hash-123',
            encKey: 'enc-key'
        });
        vi.mocked(fetchAssetCiphertext).mockResolvedValue(mockCiphertext);
        vi.mocked(sha256).mockResolvedValue('hash-123');
        vi.mocked(decryptConvergentAsset).mockResolvedValue(mockBytes);
        vi.mocked(isValidImageHeader).mockReturnValue(true);
    });

    it('creates local asset metadata, plaintext storage, and registry cache index', async () => {
        const file = new File([mockBytes], 'avatar.png', { type: 'image/png' });

        const id = await AssetService.write(file, 'resource');

        expect(id).toBe('asset-123');
        expect(appStorage.write).toHaveBeenCalledWith('assets/asset-123', mockBytes);
        expect(appAsset.putAsset).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'asset-123',
                userId: mockUserId,
                data: expect.objectContaining({
                    kind: 'resource',
                    status: 'local',
                    hash: 'hash-123',
                    encKey: 'enc-key'
                })
            })
        );
        expect(appAsset.putRegistry).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'asset-123',
                kind: 'resource',
                status: 'local',
                size: mockBytes.length
            })
        );
    });

    it('creates lightweight remote metadata without writing local storage', async () => {
        const id = await AssetService.write(null, 'resource', 'hash-123', 'enc-key');

        expect(id).toBe('asset-123');
        expect(appStorage.write).not.toHaveBeenCalled();
        expect(appAsset.putAsset).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ status: 'remote' })
            })
        );
    });

    it('deletes logical asset and local cache registry entry', async () => {
        await AssetService.delete('asset-123');

        expect(appAsset.softDeleteAsset).toHaveBeenCalledWith('asset-123');
        expect(appStorage.delete).toHaveBeenCalledWith('assets/asset-123');
        expect(appAsset.deleteRegistry).toHaveBeenCalledWith('asset-123');
    });

    it('returns cached render URL and refreshes registry index when local bytes exist', async () => {
        vi.mocked(appAsset.getAsset).mockResolvedValue(mockRecord);
        vi.mocked(appAsset.getRegistry).mockResolvedValue(mockRegistry);
        vi.mocked(appStorage.exists).mockResolvedValue(true);

        const url = await AssetService.read('asset-123');

        expect(url).toBe('blob:asset-123');
        expect(appAsset.putRegistry).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'asset-123',
                kind: 'resource',
                status: 'remote'
            })
        );
    });

    it('downloads, verifies, decrypts, and caches remote ciphertext', async () => {
        vi.mocked(appAsset.getAsset).mockResolvedValue(mockRecord);

        const url = await AssetService.read('asset-123');

        expect(url).toBe('blob:asset-123');
        expect(fetchAssetCiphertext).toHaveBeenCalledWith('hash-123');
        expect(sha256).toHaveBeenCalledWith(mockCiphertext);
        expect(decryptConvergentAsset).toHaveBeenCalledWith(mockCiphertext, 'enc-key');
        expect(appStorage.write).toHaveBeenCalledWith('assets/asset-123', mockBytes);
    });
});
