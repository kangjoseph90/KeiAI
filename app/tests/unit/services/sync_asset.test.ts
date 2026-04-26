import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AssetSyncEngine } from '$lib/services/sync/asset';
import type { AssetRecord, AssetRegistryRecord } from '$lib/adapters/asset';
import { AppError } from '$lib/types/errors';

// Mock Dependencies
vi.mock('$lib/adapters/pb', () => ({
    pb: {
        authStore: { isValid: true },
        collection: vi.fn(() => ({
            getList: vi.fn().mockResolvedValue({ items: [], page: 1, totalPages: 1 }),
            subscribe: vi.fn().mockResolvedValue(() => {}),
            unsubscribe: vi.fn().mockResolvedValue(() => {})
        })),
        filter: vi.fn((s) => s),
        createBatch: vi.fn(() => ({
            collection: vi.fn(() => ({ upsert: vi.fn(), create: vi.fn() })),
            send: vi.fn()
        }))
    }
}));

vi.mock('$lib/services/session', () => ({
    getActiveSession: vi.fn(),
    hasSyncSession: vi.fn(),
    getSyncSession: vi.fn()
}));

vi.mock('$lib/adapters/asset', () => ({
    appAsset: {
        getAsset: vi.fn(),
        getAllAssets: vi.fn(),
        putAsset: vi.fn(),
        softDeleteAsset: vi.fn(),
        getAssetsSince: vi.fn(),
        getRegistry: vi.fn(),
        getAllRegistry: vi.fn(),
        getRegistryByStatus: vi.fn(),
        getDeletedRegistry: vi.fn(),
        putRegistry: vi.fn(),
        softDeleteRegistry: vi.fn(),
        deleteRegistry: vi.fn()
    }
}));

vi.mock('$lib/adapters/storage', () => ({
    appStorage: {
        write: vi.fn(),
        read: vi.fn(),
        delete: vi.fn(),
        exists: vi.fn(),
        getRenderUrl: vi.fn(),
        revokeRenderUrl: vi.fn()
    }
}));

vi.mock('$lib/adapters/kv', () => ({
    appKV: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn(),
        remove: vi.fn()
    }
}));

vi.mock('$lib/crypto', () => ({
    encrypt: vi.fn(() => ({ ciphertext: new Uint8Array(), iv: new Uint8Array() })),
    decrypt: vi.fn(),
    toBase64: vi.fn((buf: Uint8Array) => Buffer.from(buf).toString('base64')),
    fromBase64: vi.fn((str: string) => new Uint8Array(Buffer.from(str, 'base64')))
}));

vi.mock('$lib/services/asset/util', () => ({
    encryptAsset: vi.fn(),
    parseFields: vi.fn((record: AssetRecord) => record.data)
}));

vi.mock('$lib/services/asset/remote', () => ({
    uploadAsset: vi.fn(),
    deleteRemoteAsset: vi.fn(),
    promoteAsset: vi.fn()
}));

import { pb } from '$lib/adapters/pb';
import { getActiveSession, hasSyncSession, getSyncSession } from '$lib/services/session';
import { appAsset } from '$lib/adapters/asset';
import { appStorage } from '$lib/adapters/storage';
import { decrypt } from '$lib/crypto';
import { encryptAsset } from '$lib/services/asset/util';
import { uploadAsset } from '$lib/services/asset/remote';

describe('AssetSyncEngine (Unit)', () => {
    const mockMasterKey = {} as CryptoKey;
    const mockUserId = 'user-123';
    let service: AssetSyncEngine;

    const createRegistryRecord = (): AssetRegistryRecord => ({
        id: 'asset-1',
        userId: mockUserId,
        createdAt: 1000,
        updatedAt: 1000,
        isDeleted: false,
        kind: 'private',
        status: 'local',
        accessedAt: 1000,
        size: 42
    });

    const createAssetRecord = (): AssetRecord => ({
        id: 'asset-1',
        userId: mockUserId,
        createdAt: 1000,
        updatedAt: 1000,
        isDeleted: false,
        data: {
            kind: 'private',
            status: 'local',
            hash: 'hash-123',
            encKey: 'enc-key'
        }
    });

    beforeEach(() => {
        vi.clearAllMocks();
        service = new AssetSyncEngine();

        vi.mocked(getActiveSession).mockReturnValue({
            userId: mockUserId,
            masterKey: mockMasterKey,
            isGuest: false,
            identityKeyPair: {} as CryptoKeyPair
        });
        vi.mocked(hasSyncSession).mockReturnValue(true);
        vi.mocked(getSyncSession).mockReturnValue({
            userId: mockUserId,
            masterKey: mockMasterKey
        });

        (pb.authStore as { isValid: boolean }).isValid = true;

        // Mock PB collection for pull phase
        vi.mocked(pb.collection).mockReturnValue({
            getList: vi.fn().mockResolvedValue({ items: [], page: 1, totalPages: 1 }),
            subscribe: vi.fn().mockResolvedValue(() => {}),
            unsubscribe: vi.fn().mockResolvedValue(() => {})
        } as never);

        // Default mocks for upload queue phase
        vi.mocked(appAsset.getRegistryByStatus).mockResolvedValue([createRegistryRecord()]);
        vi.mocked(appAsset.getDeletedRegistry).mockResolvedValue([]);
        vi.mocked(appAsset.getAsset).mockResolvedValue(createAssetRecord());
        vi.mocked(appStorage.read).mockResolvedValue(new Uint8Array([7, 8, 9]));
        vi.mocked(appAsset.putRegistry).mockResolvedValue(undefined);
        vi.mocked(appAsset.putAsset).mockResolvedValue(undefined);

        vi.mocked(decrypt).mockResolvedValue(
            JSON.stringify({
                kind: 'private',
                hash: 'hash-123',
                encKey: 'enc-key'
            })
        );
        vi.mocked(encryptAsset).mockResolvedValue(new Uint8Array([10, 11, 12]));
        vi.mocked(uploadAsset).mockResolvedValue({
            status: 'uploaded',
            hash: 'hash-123'
        });
    });

    it('should mark asset as remote and upload when status is local', async () => {
        await service.trigger();

        expect(uploadAsset).toHaveBeenCalled();
        expect(appAsset.putRegistry).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'asset-1',
                status: 'remote'
            })
        );
    });

    it('should stop on quota errors reported by PocketBase', async () => {
        vi.mocked(uploadAsset).mockRejectedValue(
            new AppError('QUOTA_EXCEEDED', 'Asset quota exceeded.')
        );

        await service.trigger();

        // Use waitFor just in case there's some microtask delay
        await vi.waitFor(() => expect(service.getState().state).toBe('quota_error'), {
            timeout: 1000,
            interval: 50
        });
    });

    it('should process sync for guest sessions when sync session is available', async () => {
        vi.mocked(getActiveSession).mockReturnValue({
            userId: mockUserId,
            masterKey: mockMasterKey,
            isGuest: true,
            identityKeyPair: {} as CryptoKeyPair
        });
        vi.mocked(getSyncSession).mockReturnValue({
            userId: mockUserId,
            masterKey: mockMasterKey
        });

        await service.trigger();

        expect(appAsset.getRegistryByStatus).toHaveBeenCalled();
    });
});
