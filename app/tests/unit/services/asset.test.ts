/**
 * Asset Service Tests
 *
 * Tests the AssetService which bridges database metadata and binary storage.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AssetService, type AssetFields } from '$lib/services/content/asset';
import { getActiveSession } from '$lib/services/session';
import { localDB, type AssetRecord, type CacheRegistryRecord } from '$lib/adapters/db';
import { appStorage } from '$lib/adapters/storage';
import { encrypt, decrypt } from '$lib/crypto';
import { AppError } from '$lib/shared/errors';

// Mock all dependencies
vi.mock('$lib/crypto', () => ({
	encrypt: vi.fn(),
	decrypt: vi.fn()
}));

vi.mock('$lib/services/session', () => ({
	getActiveSession: vi.fn()
}));

vi.mock('$lib/adapters/db', () => ({
	localDB: {
		getRecord: vi.fn(),
		putRecord: vi.fn(),
		deleteRecord: vi.fn(),
		softDeleteRecord: vi.fn(),
		getAll: vi.fn()
	}
}));

vi.mock('$lib/adapters/storage', () => ({
	appStorage: {
		exists: vi.fn(),
		write: vi.fn(),
		delete: vi.fn(),
		getRenderUrl: vi.fn(),
		revokeRenderUrl: vi.fn()
	}
}));

vi.mock('$lib/shared/id', () => ({
	generateId: vi.fn(() => 'asset-123')
}));

describe('AssetService', () => {
	const mockUserId = 'user-123';
	const mockMasterKey = {} as CryptoKey;
	const mockNow = 1710000000000;

	const mockFields: AssetFields = {
		kind: 'private',
		mimeType: 'image/png'
	};

	const mockRecord: AssetRecord = {
		id: 'asset-123',
		userId: mockUserId,
		createdAt: mockNow,
		updatedAt: mockNow,
		isDeleted: false,
		encryptedData: new Uint8Array([1]),
		encryptedDataIV: new Uint8Array([2])
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(mockNow);

		vi.mocked(getActiveSession).mockReturnValue({
			userId: mockUserId,
			masterKey: mockMasterKey,
			isGuest: false
		});

		vi.mocked(encrypt).mockResolvedValue({
			ciphertext: mockRecord.encryptedData,
			iv: mockRecord.encryptedDataIV
		});

		vi.mocked(decrypt).mockResolvedValue(JSON.stringify(mockFields));
	});

	describe('getAssetUrl', () => {
		it('should return local URL if file exists', async () => {
			vi.mocked(appStorage.exists).mockResolvedValue(true);
			vi.mocked(appStorage.getRenderUrl).mockResolvedValue('local://url');

			const result = await AssetService.getAssetUrl('asset-123');

			expect(result).toBe('local://url');
			expect(appStorage.getRenderUrl).toHaveBeenCalledWith('asset-123');
		});

		it('should return CDN URL for public assets if missing locally', async () => {
			vi.mocked(appStorage.exists).mockResolvedValue(false);
			vi.mocked(localDB.getRecord).mockResolvedValue(mockRecord);
			vi.mocked(decrypt).mockResolvedValue(
				JSON.stringify({
					kind: 'public',
					mimeType: 'image/png',
					remoteUrl: 'https://cdn.com/img.png'
				})
			);

			const result = await AssetService.getAssetUrl('asset-123');

			expect(result).toBe('https://cdn.com/img.png');
		});

		it('should return null if record is missing or deleted', async () => {
			vi.mocked(appStorage.exists).mockResolvedValue(false);
			vi.mocked(localDB.getRecord).mockResolvedValue(undefined);

			expect(await AssetService.getAssetUrl('none')).toBeNull();
		});
	});

	describe('createAsset', () => {
		it('should write binary to storage and record to DB', async () => {
			const data = new Uint8Array([1, 2, 3]);
			const id = await AssetService.createAsset(data, 'private', 'image/png');

			expect(id).toBe('asset-123');
			expect(appStorage.write).toHaveBeenCalledWith('asset-123', data);
			expect(localDB.putRecord).toHaveBeenCalledWith(
				'assets',
				expect.objectContaining({
					id: 'asset-123',
					userId: mockUserId
				})
			);
		});

		it('should throw AppError on DB failure', async () => {
			vi.mocked(localDB.putRecord).mockRejectedValue(new Error('DB Error'));
			await expect(AssetService.createAsset(new Uint8Array(), 'private', 'img')).rejects.toThrow(
				AppError
			);
		});
	});

	describe('deleteAsset', () => {
		it('should delete from storage and soft-delete from DB', async () => {
			await AssetService.deleteAsset('asset-123');

			expect(localDB.deleteRecord).toHaveBeenCalledWith('cacheRegistry', 'asset-123');
			expect(appStorage.delete).toHaveBeenCalledWith('asset-123');
			expect(localDB.softDeleteRecord).toHaveBeenCalledWith('assets', 'asset-123');
		});
	});

	describe('evictCacheIfNeeded', () => {
		it('should evict oldest files if limit exceeded', async () => {
			const registry: CacheRegistryRecord[] = [
				{
					id: 'old',
					userId: mockUserId,
					createdAt: 0,
					updatedAt: 0,
					isDeleted: false,
					lastAccessedAt: 100,
					size: 300 * 1024 * 1024
				},
				{
					id: 'new',
					userId: mockUserId,
					createdAt: 0,
					updatedAt: 0,
					isDeleted: false,
					lastAccessedAt: 200,
					size: 300 * 1024 * 1024
				}
			];
			vi.mocked(localDB.getAll).mockResolvedValue(registry);

			await AssetService.evictCacheIfNeeded();

			// Total is 600MB, high watermark is 500MB, target is to get below 400MB.
			// Must delete at least 200MB. 'old' is 300MB.
			expect(appStorage.delete).toHaveBeenCalledWith('old');
			expect(localDB.deleteRecord).toHaveBeenCalledWith('cacheRegistry', 'old');
			expect(appStorage.delete).not.toHaveBeenCalledWith('new');
		});
	});
});
