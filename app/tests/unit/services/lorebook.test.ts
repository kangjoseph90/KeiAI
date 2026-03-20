/**
 * Lorebook Service Tests
 *
 * Tests the LorebookService handling lorebook CRUD operations
 * with encryption and local DB writes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LorebookService } from '$lib/services/content/lorebook';
import type { BaseRecord } from '$lib/adapters/db/types';
import { AppError } from '$lib/types/errors';

// Mock dependencies
vi.mock('$lib/crypto', () => ({
	encrypt: vi.fn(),
	decrypt: vi.fn()
}));

vi.mock('$lib/services/session', () => ({
	getActiveSession: vi.fn()
}));

vi.mock('$lib/adapters/db', () => ({
	localDB: {
		getByIndex: vi.fn(),
		getRecord: vi.fn(),
		putRecord: vi.fn(),
		softDeleteRecord: vi.fn()
	}
}));

vi.mock('$lib/utils/id', () => ({
	generateId: vi.fn(() => 'test-id')
}));

import { encrypt, decrypt } from '$lib/crypto';
import { getActiveSession } from '$lib/services/session';
import { localDB } from '$lib/adapters/db';

describe('LorebookService', () => {
	const mockUserId = 'user-123';
	const mockMasterKey = {} as unknown as CryptoKey;
	const mockEncryptedData = new Uint8Array([1, 2, 3]);
	const mockIV = new Uint8Array([4, 5, 6]);

	const defaultLorebookParams = {
		name: 'Test Lore',
		keys: ['key1', 'key2'],
		content: 'Content',
		insertionDepth: 2,
		enabled: true
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
			ciphertext: mockEncryptedData,
			iv: mockIV
		});

		vi.mocked(decrypt).mockResolvedValue(JSON.stringify(defaultLorebookParams));
	});

	describe('listByOwner', () => {
		it('should return decrypted lorebooks for an owner', async () => {
			const mockRecords = [
				{
					id: 'lb-1',
					ownerId: 'owner-1',
					encryptedData: mockEncryptedData,
					encryptedDataIV: mockIV
				} as unknown as BaseRecord
			];

			vi.mocked(localDB.getByIndex).mockResolvedValue(mockRecords);

			const result = await LorebookService.listByOwner('owner-1');

			expect(result).toHaveLength(1);
			expect(result[0].id).toBe('lb-1');
			expect(result[0].name).toBe('Test Lore');
			expect(result[0].keys).toEqual(['key1', 'key2']);
		});

		it('should handle decryption errors', async () => {
			const mockRecords = [
				{
					id: 'lb-1',
					ownerId: 'owner-1',
					encryptedData: mockEncryptedData,
					encryptedDataIV: mockIV
				} as unknown as BaseRecord
			];

			vi.mocked(localDB.getByIndex).mockResolvedValue(mockRecords);
			vi.mocked(decrypt).mockRejectedValue(new Error('Decrypt error'));

			await expect(LorebookService.listByOwner('owner-1')).rejects.toThrow(AppError);
		});
	});

	describe('get', () => {
		it('should return decrypted lorebook detail', async () => {
			const mockRecord = {
				id: 'lb-1',
				ownerId: 'owner-1',
				isDeleted: false,
				encryptedData: mockEncryptedData,
				encryptedDataIV: mockIV
			} as unknown as BaseRecord;

			vi.mocked(localDB.getRecord).mockResolvedValue(mockRecord);

			const result = await LorebookService.get('lb-1');

			expect(result).toBeDefined();
			expect(result?.id).toBe('lb-1');
			expect(result?.name).toBe('Test Lore');
		});

		it('should return null if record is missing or deleted', async () => {
			vi.mocked(localDB.getRecord).mockResolvedValue(undefined as unknown as BaseRecord);
			expect(await LorebookService.get('non-existent')).toBeNull();

			vi.mocked(localDB.getRecord).mockResolvedValue({
				id: 'deleted',
				isDeleted: true
			} as unknown as BaseRecord);
			expect(await LorebookService.get('deleted')).toBeNull();
		});
	});

	describe('create', () => {
		it('should create a new lorebook with merged defaults', async () => {
			const result = await LorebookService.create('owner-1', { name: 'Custom Name' });

			expect(result.id).toBe('test-id');
			expect(result.ownerId).toBe('owner-1');
			expect(result.name).toBe('Custom Name');
			expect(result.insertionDepth).toBe(0); // From defaults

			expect(localDB.putRecord).toHaveBeenCalledWith(
				'lorebooks',
				expect.objectContaining({
					id: 'test-id',
					ownerId: 'owner-1',
					encryptedData: mockEncryptedData
				})
			);
		});
	});

	describe('update', () => {
		it('should update and decrypt-merge existing fields', async () => {
			const mockRecord = {
				id: 'lb-1',
				ownerId: 'owner-1',
				isDeleted: false,
				encryptedData: mockEncryptedData,
				encryptedDataIV: mockIV
			} as unknown as BaseRecord;

			vi.mocked(localDB.getRecord).mockResolvedValue(mockRecord);

			const result = await LorebookService.update('lb-1', { name: 'Updated name' });

			expect(result.name).toBe('Updated name');
			expect(result.content).toBe('Content'); // Preserved from existing

			expect(localDB.putRecord).not.toHaveBeenCalled();
		});

		it('should throw if not found', async () => {
			vi.mocked(localDB.getRecord).mockResolvedValue(undefined as unknown as BaseRecord);

			await expect(LorebookService.update('missing', { name: 'new' })).rejects.toThrow(
				'Lorebook not found: missing'
			);
		});
	});

	describe('delete', () => {
		it('should soft delete the lorebook', async () => {
			await LorebookService.delete('lb-1');

			expect(localDB.softDeleteRecord).toHaveBeenCalledWith('lorebooks', 'lb-1');
		});
	});
});
