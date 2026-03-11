import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AssetService } from '$lib/services/asset';
import type { AssetRecord, AssetRegistryRecord } from '$lib/adapters/asset';
import { AppError } from '$lib/shared/errors';

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

vi.mock('$lib/adapters/http', () => ({
	appHttp: {
		fetch: vi.fn()
	}
}));

vi.mock('$lib/crypto', () => ({
	encrypt: vi.fn(),
	decrypt: vi.fn(),
	sha256: vi.fn()
}));

vi.mock('$lib/shared/id', () => ({
	generateId: vi.fn(() => 'asset-123')
}));

vi.mock('$lib/services/asset/util', () => ({
	preprocessImage: vi.fn(),
	deriveAssetKey: vi.fn(),
	decryptAsset: vi.fn(),
	getRemoteURL: vi.fn((hash: string) => `https://cdn.keiai.ai/assets/${hash}`),
	isValidImageHeader: vi.fn()
}));

vi.mock('$lib/services/asset/remote', () => ({
	fetchAssetFromCDN: vi.fn()
}));

import { getActiveSession } from '$lib/services/session';
import { appAsset } from '$lib/adapters/asset';
import { appStorage } from '$lib/adapters/storage';
import { encrypt, decrypt, sha256 } from '$lib/crypto';
import {
	preprocessImage,
	deriveAssetKey,
	decryptAsset,
	getRemoteURL,
	isValidImageHeader
} from '$lib/services/asset/util';
import { fetchAssetFromCDN } from '$lib/services/asset/remote';

describe('AssetService', () => {
	const mockMasterKey = {} as CryptoKey;
	const mockUserId = 'user-123';
	const mockCiphertext = new Uint8Array([1, 2, 3]);
	const mockIv = new Uint8Array([4, 5, 6]);
	const mockBytes = new Uint8Array([7, 8, 9, 10]);
	const mockRecord: AssetRecord = {
		id: 'asset-123',
		userId: mockUserId,
		createdAt: 1000,
		updatedAt: 1000,
		isDeleted: false,
		encryptedData: mockCiphertext,
		encryptedDataIV: mockIv
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getActiveSession).mockReturnValue({
			userId: mockUserId,
			masterKey: mockMasterKey,
			isGuest: false,
			identityKeyPair: {} as CryptoKeyPair
		});

		vi.mocked(encrypt).mockResolvedValue({
			ciphertext: mockCiphertext,
			iv: mockIv
		});
		vi.mocked(sha256).mockResolvedValue('hash-123');
		vi.mocked(deriveAssetKey).mockResolvedValue('enc-key');
		vi.mocked(preprocessImage).mockResolvedValue({
			blob: new Blob([mockBytes], { type: 'image/webp' }),
			width: 100,
			height: 100
		});

		// Adapter mocks
		vi.mocked(appAsset.getAsset).mockResolvedValue(undefined);
		vi.mocked(appAsset.putAsset).mockResolvedValue(undefined);
		vi.mocked(appAsset.softDeleteAsset).mockResolvedValue(undefined);
		vi.mocked(appAsset.getRegistry).mockResolvedValue(undefined);
		vi.mocked(appAsset.putRegistry).mockResolvedValue(undefined);
		vi.mocked(appAsset.softDeleteRegistry).mockResolvedValue(undefined);
		vi.mocked(appAsset.deleteRegistry).mockResolvedValue(undefined);

		vi.mocked(appStorage.write).mockResolvedValue(undefined);
		vi.mocked(appStorage.read).mockResolvedValue(mockBytes);
		vi.mocked(appStorage.delete).mockResolvedValue(undefined);
		vi.mocked(appStorage.exists).mockResolvedValue(false);
		vi.mocked(appStorage.getRenderUrl).mockResolvedValue('blob:asset-123');
		vi.mocked(appStorage.revokeRenderUrl).mockResolvedValue(undefined);

		vi.mocked(isValidImageHeader).mockReturnValue(true);
		vi.mocked(fetchAssetFromCDN).mockResolvedValue(null);

		// DEFAULT DECRYPT (can be overriden in tests)
		vi.mocked(decrypt).mockResolvedValue(
			JSON.stringify({
				kind: 'private',
				status: 'remote',
				hash: 'hash-123',
				encKey: 'enc-key'
			})
		);
		vi.mocked(fetchAssetFromCDN).mockResolvedValue(mockBytes);
	});

	describe('write', () => {
		it('should create local asset metadata and registry entry', async () => {
			const file = new File([mockBytes], 'avatar.png', { type: 'image/png' });

			const id = await AssetService.write(file, 'private');

			expect(id).toBe('asset-123');
			expect(appStorage.write).toHaveBeenCalledWith('assets/asset-123', expect.any(Uint8Array));
			expect(appAsset.putAsset).toHaveBeenCalledWith(
				expect.objectContaining({ id: 'asset-123', userId: mockUserId })
			);
			expect(appAsset.putRegistry).toHaveBeenCalledWith(
				expect.objectContaining({
					id: 'asset-123',
					userId: mockUserId,
					kind: 'private',
					status: 'local',
					size: mockBytes.length
				})
			);
		});
	});

	describe('delete', () => {
		it('should soft-delete locally and put into queue', async () => {
			vi.mocked(appAsset.getAsset).mockResolvedValue(mockRecord);
			vi.mocked(appAsset.getRegistry).mockResolvedValue({
				id: 'asset-123',
				userId: mockUserId,
				kind: 'private',
				status: 'local',
				size: 100,
				hash: 'hash-123',
				encKey: 'enc-key',
				accessedAt: 1000,
				createdAt: 1000,
				updatedAt: 1000,
				isDeleted: false
			} as AssetRegistryRecord);

			await AssetService.delete('asset-123');

			expect(appAsset.softDeleteAsset).toHaveBeenCalledWith('asset-123');
			expect(appStorage.delete).toHaveBeenCalledWith('assets/asset-123');
			// Since registry existed, it should soft-delete it
			expect(appAsset.softDeleteRegistry).toHaveBeenCalledWith('asset-123');
		});

		it('should create delete queue item if registry absent', async () => {
			vi.mocked(appAsset.getAsset).mockResolvedValue(mockRecord);
			// No registry entry present
			vi.mocked(appAsset.getRegistry).mockResolvedValue(undefined);

			await AssetService.delete('asset-123');

			expect(appAsset.softDeleteAsset).toHaveBeenCalledWith('asset-123');
			expect(appStorage.delete).toHaveBeenCalledWith('assets/asset-123');
			// It should synthesize a delete queue item from metadata
			expect(appAsset.putRegistry).toHaveBeenCalledWith(
				expect.objectContaining({
					id: 'asset-123',
					isDeleted: true
				})
			);
		});
	});

	describe('promote', () => {
		it('should update kind to public and status to local', async () => {
			// AssetService.read will be called inside promote, mock it to succeed
			vi.mocked(appStorage.exists).mockResolvedValue(true);
			vi.mocked(appAsset.getRegistry).mockResolvedValue({
				id: 'asset-123',
				userId: mockUserId,
				kind: 'private',
				status: 'local',
				size: 100,
				hash: 'hash-123',
				encKey: 'enc-key',
				accessedAt: 1000,
				createdAt: 1000,
				updatedAt: 1000,
				isDeleted: false
			} as AssetRegistryRecord);
			vi.mocked(appAsset.getAsset).mockResolvedValue(mockRecord);

			await AssetService.promote('asset-123');

			// Check that it decrypts, updates fields and re-encrypts
			expect(appAsset.putAsset).toHaveBeenCalled();
			expect(appAsset.putRegistry).toHaveBeenCalledWith(
				expect.objectContaining({
					kind: 'public',
					status: 'local'
				})
			);
		});
	});

	describe('read', () => {
		it('should return rendering URL if local blob exists', async () => {
			vi.mocked(appStorage.exists).mockResolvedValue(true);
			vi.mocked(appAsset.getRegistry).mockResolvedValue({
				id: 'asset-123',
				userId: mockUserId,
				kind: 'private',
				status: 'local',
				size: 100,
				hash: 'hash-123',
				encKey: 'enc-key',
				accessedAt: 1000,
				createdAt: 1000,
				updatedAt: 1000,
				isDeleted: false
			} as AssetRegistryRecord);

			const url = await AssetService.read('asset-123');

			expect(url).toBe('blob:asset-123');
			// touchRegistry
			expect(appAsset.putRegistry).toHaveBeenCalledWith(
				expect.objectContaining({ accessedAt: expect.any(Number) })
			);
		});

		it('should download and restore remote asset', async () => {
			vi.mocked(appAsset.getAsset).mockResolvedValue(mockRecord);
			vi.mocked(appStorage.exists).mockResolvedValue(false);
			vi.mocked(appAsset.getRegistry).mockResolvedValue(undefined);

			// isValidImageHeader is false for encrypted payload, true for decrypted
			vi.mocked(isValidImageHeader).mockReturnValueOnce(false).mockReturnValueOnce(true);
			vi.mocked(decryptAsset).mockResolvedValue(mockBytes);
			vi.mocked(fetchAssetFromCDN).mockResolvedValue(mockBytes);

			const url = await AssetService.read('asset-123');

			expect(url).toBe('blob:asset-123');
			expect(appStorage.write).toHaveBeenCalledWith('assets/asset-123', mockBytes);

			// setRegistry
			expect(appAsset.putRegistry).toHaveBeenCalledWith(
				expect.objectContaining({ status: 'remote', kind: 'private' })
			);
		});

		it('should heal metadata when CDN serves plaintext public bytes', async () => {
			vi.mocked(appAsset.getAsset).mockResolvedValue(mockRecord);
			vi.mocked(appStorage.exists).mockResolvedValue(false);
			vi.mocked(appAsset.getRegistry).mockResolvedValue(undefined);

			// Downloaded payload is already valid (public)
			vi.mocked(isValidImageHeader).mockReturnValue(true);
			vi.mocked(fetchAssetFromCDN).mockResolvedValue(mockBytes);

			await AssetService.read('asset-123');

			// Should heal: update metadata to public
			expect(appAsset.putAsset).toHaveBeenCalledWith(
				expect.objectContaining({ id: 'asset-123', updatedAt: expect.any(Number) })
			);

			// setRegistry will be called with kind: 'private' because it decrypts the ORIGINAL asset (mockRecord)
			expect(appAsset.putRegistry).toHaveBeenCalledWith(
				expect.objectContaining({ kind: 'private', status: 'remote' })
			);
		});

		it('should return null on invalid downloaded data', async () => {
			vi.mocked(appAsset.getAsset).mockResolvedValue(mockRecord);
			vi.mocked(appStorage.exists).mockResolvedValue(false);

			// Decrypt yields invalid image
			vi.mocked(isValidImageHeader).mockReturnValue(false);
			vi.mocked(decryptAsset).mockResolvedValue(new Uint8Array([99]));
			vi.mocked(fetchAssetFromCDN).mockResolvedValue(mockBytes);

			const url = await AssetService.read('asset-123');
			expect(url).toBeNull();
		});
	});
});
