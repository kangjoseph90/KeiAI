import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetBinarySyncEngineImpl, AssetRecordSyncEngineImpl } from '$lib/services/sync/asset';
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

vi.mock('$lib/services/user', () => ({
    UserService: {}
}));

vi.mock('$lib/adapters/asset', () => ({
    appAsset: {
        getAsset: vi.fn(),
        putAsset: vi.fn(),
        getAssetsSince: vi.fn(),
        getRegistry: vi.fn(),
        getRegistryByStatus: vi.fn(),
        putRegistry: vi.fn(),
        deleteRegistry: vi.fn(),
        transaction: vi.fn(async (_tables, _mode, callback) => callback())
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

vi.mock('$lib/adapters/multi', () => ({
    appMulti: {
        getDeleteMarkers: vi.fn(() => Promise.resolve([])),
        saveDeleteMarker: vi.fn(),
        deleteDeleteMarker: vi.fn()
    }
}));

vi.mock('$lib/crypto', () => ({
    encrypt: vi.fn(() => ({ ciphertext: new Uint8Array([1]), iv: new Uint8Array([2]) })),
    decrypt: vi.fn(),
    importMasterKey: vi.fn(() => Promise.resolve({ type: 'room-key' } as unknown as CryptoKey)),
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
import { appMulti } from '$lib/adapters/multi';
import { appStorage } from '$lib/adapters/storage';
import { getActiveSession, hasActiveSession } from '$lib/services/session';
import { encryptConvergentAsset } from '$lib/services/asset/util';
import { uploadAsset } from '$lib/services/asset/remote';

describe('Asset sync', () => {
    const mockUserId = 'user-123';
    let binaryWorker: AssetBinarySyncEngineImpl;

    const createRegistryRecord = (): AssetRegistryRecord => ({
        id: 'asset-1',
        scopeType: 'user',
        scopeId: mockUserId,
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
        scopeType: 'user',
        scopeId: mockUserId,
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
        binaryWorker = new AssetBinarySyncEngineImpl();

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
        await binaryWorker.start();

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

        await binaryWorker.start();

        await vi.waitFor(() => expect(binaryWorker.getState().state).toBe('quota_error'));
        expect(appAsset.putAsset).not.toHaveBeenCalled();
    });

    it('drops stale local registry entries when the logical asset no longer exists', async () => {
        vi.mocked(appAsset.getAsset).mockResolvedValue(undefined);

        await binaryWorker.start();

        expect(appAsset.deleteRegistry).toHaveBeenCalledWith('asset-1');
        expect(uploadAsset).not.toHaveBeenCalled();
    });

    it('drops stale local registry entries when the cached blob is missing', async () => {
        vi.mocked(appStorage.read).mockResolvedValue(null);

        await binaryWorker.start();

        expect(appAsset.deleteRegistry).toHaveBeenCalledWith('asset-1');
        expect(uploadAsset).not.toHaveBeenCalled();
    });

    it('pushes room asset tombstones from delete markers and clears completed marker', async () => {
        vi.mocked(appAsset.getRegistryByStatus).mockResolvedValue([]);
        vi.mocked(appMulti.getDeleteMarkers).mockResolvedValue([
            {
                roomId: 'room-1',
                roomKey: 'room-key',
                dataDone: true,
                assetDone: false,
                createdAt: 1,
                updatedAt: 2,
                attempts: 0
            }
        ]);
        vi.mocked(appAsset.getAssetsSince)
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
                {
                    id: 'room-asset-1',
                    scopeType: 'room',
                    scopeId: 'room-1',
                    createdAt: 1,
                    updatedAt: 2,
                    isDeleted: true,
                    data: {
                        kind: 'resource',
                        status: 'remote',
                        hash: 'hash-1',
                        encKey: 'key-1'
                    }
                }
            ]);

        const recordSync = new AssetRecordSyncEngineImpl();
        await recordSync.trigger();

        const batch = vi.mocked(pb.createBatch).mock.results[0].value as {
            collection: ReturnType<typeof vi.fn>;
            send: ReturnType<typeof vi.fn>;
        };
        expect(batch.collection).toHaveBeenCalledWith('multi_room_assets');
        expect(appMulti.deleteDeleteMarker).toHaveBeenCalledWith('room-1');
    });
});
