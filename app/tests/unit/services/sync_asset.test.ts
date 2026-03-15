import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AssetSyncService } from '$lib/services/sync/asset';
import type { AssetRecord, AssetRegistryRecord } from '$lib/adapters/asset';
import { AppError } from '$lib/types/errors';

vi.mock('$lib/adapters/pb', () => ({
	pb: {
		authStore: { isValid: true },
		collection: vi.fn(() => ({
			getList: vi.fn().mockResolvedValue({ items: [], page: 1, totalPages: 1 }),
			subscribe: vi.fn(),
			unsubscribe: vi.fn()
		})),
		filter: vi.fn(),
		createBatch: vi.fn(() => ({
			collection: vi.fn(() => ({ upsert: vi.fn(), create: vi.fn() })),
			send: vi.fn()
		}))
	}
}));

vi.mock('$lib/services/session', () => ({
	getActiveSession: vi.fn()
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
	decrypt: vi.fn(),
	toBase64: vi.fn((buf: Uint8Array) => Buffer.from(buf).toString('base64')),
	fromBase64: vi.fn((str: string) => new Uint8Array(Buffer.from(str, 'base64')))
}));

vi.mock('$lib/services/asset/util', () => ({
	encryptAsset: vi.fn()
}));

vi.mock('$lib/services/asset/remote', () => ({
	uploadAsset: vi.fn(),
	deleteRemoteAsset: vi.fn(),
	promoteAsset: vi.fn()
}));

import { pb } from '$lib/adapters/pb';
import { getActiveSession } from '$lib/services/session';
import { appAsset } from '$lib/adapters/asset';
import { appStorage } from '$lib/adapters/storage';
import { decrypt } from '$lib/crypto';
import { encryptAsset } from '$lib/services/asset/util';
import { uploadAsset } from '$lib/services/asset/remote';

describe('AssetSyncService', () => {
	const mockMasterKey = {} as CryptoKey;
	const mockUserId = 'user-123';

	const createRegistryRecord = (): AssetRegistryRecord => ({
		id: 'asset-1',
		userId: mockUserId,
		createdAt: 1000,
		updatedAt: 1000,
		isDeleted: false,
		kind: 'private',
		status: 'local',
		hash: 'hash-123',
		encKey: 'enc-key',
		accessedAt: 1000,
		size: 42
	});

	const createAssetRecord = (): AssetRecord => ({
		id: 'asset-1',
		userId: mockUserId,
		createdAt: 1000,
		updatedAt: 1000,
		isDeleted: false,
		encryptedData: new Uint8Array([1, 2, 3]),
		encryptedDataIV: new Uint8Array([4, 5, 6])
	});

	beforeEach(() => {
		vi.clearAllMocks();
		AssetSyncService.stop();

		vi.mocked(getActiveSession).mockReturnValue({
			userId: mockUserId,
			masterKey: mockMasterKey,
			isGuest: false,
			identityKeyPair: {} as CryptoKeyPair
		});

		(pb.authStore as { isValid: boolean }).isValid = true;

		// Mock PB collection for pull phase (empty — no server records)
		vi.mocked(pb.collection).mockReturnValue({
			getList: vi.fn().mockResolvedValue({ items: [], page: 1, totalPages: 1 }),
			subscribe: vi.fn(),
			unsubscribe: vi.fn()
		} as never);

		// Default mocks for upload queue phase
		vi.mocked(appAsset.getAllRegistry).mockResolvedValue([createRegistryRecord()]);
		vi.mocked(appAsset.getDeletedRegistry).mockResolvedValue([]);
		vi.mocked(appAsset.getAsset).mockResolvedValue(createAssetRecord());
		vi.mocked(appStorage.read).mockResolvedValue(new Uint8Array([7, 8, 9]));
		vi.mocked(appAsset.putRegistry).mockResolvedValue(undefined);
		vi.mocked(appAsset.deleteRegistry).mockResolvedValue(undefined);

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
		await AssetSyncService.start();

		expect(uploadAsset).toHaveBeenCalledWith(
			'hash-123',
			'private',
			3, // encryptAsset mock returns [10, 11, 12] which has length 3
			expect.any(Uint8Array)
		);

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

		await AssetSyncService.start();

		expect(AssetSyncService.getState().state).toBe('quota_error');
	});

	it('should skip processing for guest sessions', async () => {
		vi.mocked(getActiveSession).mockReturnValue({
			userId: mockUserId,
			masterKey: mockMasterKey,
			isGuest: true,
			identityKeyPair: {} as CryptoKeyPair
		});

		await AssetSyncService.start();

		expect(appAsset.getAllRegistry).not.toHaveBeenCalled();
	});

	it('should skip processing when PocketBase auth is invalid', async () => {
		(pb.authStore as { isValid: boolean }).isValid = false;

		await AssetSyncService.start();

		expect(appAsset.getAllRegistry).not.toHaveBeenCalled();
	});
});
