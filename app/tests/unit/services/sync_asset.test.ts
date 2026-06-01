import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetSyncEngineImpl } from '$lib/services/sync/asset';
import type { AssetRegistryRecord } from '$lib/adapters/asset';
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
        getAllLocalAssets: vi.fn(),
        readAssetBytes: vi.fn(),
        markAssetRemote: vi.fn(),
        deleteAsset: vi.fn()
    },
    assetRegistryId: vi.fn(
        (loc) => `${loc.scopeType}:${loc.scopeId}:${loc.ownerTable}:${loc.ownerId}:${loc.hash}`
    )
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
    encryptConvergentAsset: vi.fn()
}));

vi.mock('$lib/services/asset/remote', () => ({
    uploadAsset: vi.fn()
}));

import { pb } from '$lib/adapters/pb';
import { appAsset } from '$lib/adapters/asset';
import { getActiveSession, hasActiveSession } from '$lib/services/session';
import { encryptConvergentAsset } from '$lib/services/asset/util';
import { uploadAsset } from '$lib/services/asset/remote';

describe('Asset sync', () => {
    const mockUserId = 'user-123';
    let engine: AssetSyncEngineImpl;

    const createRegistryRecord = (): AssetRegistryRecord => ({
        id: 'user:user-123:characters:char-123:old-hash',
        scopeType: 'user',
        scopeId: mockUserId,
        ownerTable: 'characters',
        ownerId: 'char-123',
        hash: 'old-hash',
        encKey: 'old-key',
        status: 'local',
        accessedAt: 1000,
        size: 42
    });

    beforeEach(() => {
        vi.clearAllMocks();
        engine = new AssetSyncEngineImpl();

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

        vi.mocked(appAsset.getAllLocalAssets).mockResolvedValue([createRegistryRecord()]);
        vi.mocked(appAsset.readAssetBytes).mockResolvedValue(new Uint8Array([7, 8, 9]));
        vi.mocked(encryptConvergentAsset).mockResolvedValue({
            ciphertext: new Uint8Array([10, 11, 12]),
            hash: 'old-hash',
            encKey: 'old-key'
        });
        vi.mocked(uploadAsset).mockResolvedValue({
            status: 'stored',
            hash: 'old-hash'
        });
        vi.mocked(appAsset.markAssetRemote).mockResolvedValue(undefined);
        vi.mocked(appAsset.deleteAsset).mockResolvedValue(undefined);
    });

    it('uploads local registry entries and marks the asset remote after upload succeeds', async () => {
        await engine.start();

        expect(uploadAsset).toHaveBeenCalledWith('old-hash', new Uint8Array([10, 11, 12]));
        expect(appAsset.markAssetRemote).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'user:user-123:characters:char-123:old-hash',
                hash: 'old-hash'
            })
        );
    });

    it('keeps asset local and enters quota_error when upload quota is exceeded', async () => {
        vi.mocked(uploadAsset).mockRejectedValue(
            new AppError('QUOTA_EXCEEDED', 'Asset quota exceeded.')
        );

        await engine.start();

        await vi.waitFor(() => expect(engine.getState().state).toBe('quota_error'));
        expect(appAsset.markAssetRemote).not.toHaveBeenCalled();
    });

    it('drops stale local registry entries when the cached blob is missing', async () => {
        vi.mocked(appAsset.readAssetBytes).mockResolvedValue(null);

        await engine.start();

        expect(appAsset.deleteAsset).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'user:user-123:characters:char-123:old-hash'
            })
        );
        expect(uploadAsset).not.toHaveBeenCalled();
    });
});
