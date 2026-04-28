import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetSyncEngine } from '$lib/services/sync/asset';
import type { AssetRecord, AssetRegistryRecord } from '$lib/adapters/asset';
import { AppError } from '$lib/types/errors';

vi.mock('$lib/adapters/pb', () => ({
    pb: {
        authStore: { isValid: true },
        collection: vi.fn(() => ({
            getList: vi.fn().mockResolvedValue({ items: [], page: 1, totalPages: 1 }),
            subscribe: vi.fn().mockResolvedValue(undefined),
            unsubscribe: vi.fn().mockResolvedValue(undefined)
        })),
        filter: vi.fn((value: string) => value),
        createBatch: vi.fn(() => ({
            collection: vi.fn(() => ({ upsert: vi.fn(), create: vi.fn() })),
            send: vi.fn().mockResolvedValue(undefined)
        }))
    }
}));

vi.mock('$lib/services/session', () => ({
    getActiveSession: vi.fn(),
    hasActiveSession: vi.fn()
}));

vi.mock('$lib/adapters/asset', () => ({
    appAsset: {
        getAsset: vi.fn(),
        putAsset: vi.fn(),
        getAssetsSince: vi.fn(),
        getRegistry: vi.fn(),
        getRegistryByStatus: vi.fn(),
        putRegistry: vi.fn(),
        deleteRegistry: vi.fn()
    }
}));

vi.mock('$lib/adapters/storage', () => ({
    appStorage: {
        read: vi.fn(),
        delete: vi.fn()
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
    encrypt: vi.fn(() => ({ ciphertext: new Uint8Array([1]), iv: new Uint8Array([2]) })),
    decrypt: vi.fn(),
    toBase64: vi.fn((buf: Uint8Array) => Buffer.from(buf).toString('base64')),
    fromBase64: vi.fn((str: string) => new Uint8Array(Buffer.from(str, 'base64')))
}));

vi.mock('$lib/services/asset/util', () => ({
    encryptConvergentAsset: vi.fn(),
    parseFields: vi.fn((record: AssetRecord) => record.data)
}));

vi.mock('$lib/services/asset/remote', () => ({
    uploadAsset: vi.fn()
}));

import { pb } from '$lib/adapters/pb';
import { appAsset } from '$lib/adapters/asset';
import { appStorage } from '$lib/adapters/storage';
import { getActiveSession, hasActiveSession } from '$lib/services/session';
import { encryptConvergentAsset } from '$lib/services/asset/util';
import { uploadAsset } from '$lib/services/asset/remote';

describe('AssetSyncEngine', () => {
    const mockUserId = 'user-123';
    let service: AssetSyncEngine;

    const createRegistryRecord = (): AssetRegistryRecord => ({
        id: 'asset-1',
        userId: mockUserId,
        createdAt: 1000,
        updatedAt: 1000,
        isDeleted: false,
        kind: 'resource',
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
            kind: 'resource',
            status: 'local',
            hash: 'old-hash',
            encKey: 'old-key'
        }
    });

    beforeEach(() => {
        vi.clearAllMocks();
        service = new AssetSyncEngine();

        vi.mocked(hasActiveSession).mockReturnValue(true);
        vi.mocked(getActiveSession).mockReturnValue({
            userId: mockUserId,
            masterKey: {} as CryptoKey,
            identityKeyPair: {} as CryptoKeyPair
        });
        (pb.authStore as { isValid: boolean }).isValid = true;

        vi.mocked(pb.collection).mockReturnValue({
            getList: vi.fn().mockResolvedValue({ items: [], page: 1, totalPages: 1 }),
            subscribe: vi.fn().mockResolvedValue(undefined),
            unsubscribe: vi.fn().mockResolvedValue(undefined)
        } as never);

        vi.mocked(appAsset.getAssetsSince).mockResolvedValue([]);
        vi.mocked(appAsset.getRegistryByStatus).mockResolvedValue([createRegistryRecord()]);
        vi.mocked(appAsset.getAsset).mockResolvedValue(createAssetRecord());
        vi.mocked(appAsset.putAsset).mockResolvedValue(undefined);
        vi.mocked(appAsset.putRegistry).mockResolvedValue(undefined);
        vi.mocked(appAsset.deleteRegistry).mockResolvedValue(undefined);
        vi.mocked(appStorage.read).mockResolvedValue(new Uint8Array([7, 8, 9]));
        vi.mocked(encryptConvergentAsset).mockResolvedValue({
            ciphertext: new Uint8Array([10, 11, 12]),
            hash: 'new-hash',
            encKey: 'new-key'
        });
        vi.mocked(uploadAsset).mockResolvedValue({
            status: 'stored',
            hash: 'new-hash'
        });
    });

    it('uploads local registry entries and marks the asset remote after upload succeeds', async () => {
        await service.trigger();

        expect(uploadAsset).toHaveBeenCalledWith('new-hash', new Uint8Array([10, 11, 12]));
        expect(appAsset.putAsset).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'asset-1',
                data: expect.objectContaining({
                    kind: 'resource',
                    status: 'remote',
                    hash: 'new-hash',
                    encKey: 'new-key'
                })
            })
        );
        expect(appAsset.putRegistry).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'asset-1',
                kind: 'resource',
                status: 'remote'
            })
        );
    });

    it('keeps asset local and enters quota_error when upload quota is exceeded', async () => {
        vi.mocked(uploadAsset).mockRejectedValue(
            new AppError('QUOTA_EXCEEDED', 'Asset quota exceeded.')
        );

        await service.trigger();

        await vi.waitFor(() => expect(service.getState().state).toBe('quota_error'));
        expect(appAsset.putAsset).not.toHaveBeenCalled();
    });

    it('drops stale local registry entries when the logical asset no longer exists', async () => {
        vi.mocked(appAsset.getAsset).mockResolvedValue(undefined);

        await service.trigger();

        expect(appAsset.deleteRegistry).toHaveBeenCalledWith('asset-1');
        expect(uploadAsset).not.toHaveBeenCalled();
    });
});
