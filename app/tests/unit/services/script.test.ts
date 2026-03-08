/**
 * Script Service Tests
 *
 * Tests the ScriptService handling script CRUD operations
 * with encryption and sync integration.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScriptService } from '$lib/services/content/script';
import type { BaseRecord } from '$lib/adapters/db/types';
import { AppError } from '$lib/shared/errors';

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

vi.mock('$lib/services/sync', () => ({
	DataSyncService: {
		pushRecord: vi.fn(),
		pushById: vi.fn()
	}
}));

vi.mock('$lib/services/content/guards', () => ({
	assertOwnedResourceParentExists: vi.fn(),
	assertScriptOwnedBy: vi.fn()
}));

vi.mock('$lib/shared/id', () => ({
	generateId: vi.fn(() => 'test-id')
}));

import { encrypt, decrypt } from '$lib/crypto';
import { getActiveSession } from '$lib/services/session';
import { localDB } from '$lib/adapters/db';
import { DataSyncService } from '$lib/services/sync';
import { assertOwnedResourceParentExists, assertScriptOwnedBy } from '$lib/services/content/guards';

describe('ScriptService', () => {
	const mockUserId = 'user-123';
	const mockMasterKey = {} as unknown as CryptoKey;
	const mockEncryptedData = new Uint8Array([1, 2, 3]);
	const mockIV = new Uint8Array([4, 5, 6]);

	const defaultScriptParams = {
		name: 'Test Script',
		regex: '.*',
		replacement: 'test',
		placement: 'display',
		enabled: true
	};

	beforeEach(() => {
		vi.clearAllMocks();

		vi.mocked(getActiveSession).mockReturnValue({
			userId: mockUserId,
			masterKey: mockMasterKey,
			isGuest: false
		});

		vi.mocked(encrypt).mockResolvedValue({
			ciphertext: mockEncryptedData,
			iv: mockIV
		});

		vi.mocked(decrypt).mockResolvedValue(JSON.stringify(defaultScriptParams));

		vi.mocked(assertOwnedResourceParentExists).mockResolvedValue(undefined);
		vi.mocked(assertScriptOwnedBy).mockResolvedValue(undefined);
	});

	describe('listByOwner', () => {
		it('should return decrypted scripts for an owner', async () => {
			const mockRecords = [
				{
					id: 's-1',
					ownerId: 'owner-1',
					encryptedData: mockEncryptedData,
					encryptedDataIV: mockIV
				} as unknown as BaseRecord
			];

			vi.mocked(localDB.getByIndex).mockResolvedValue(mockRecords);

			const result = await ScriptService.listByOwner('owner-1');

			expect(result).toHaveLength(1);
			expect(result[0].id).toBe('s-1');
			expect(result[0].name).toBe('Test Script');
			expect(result[0].replacement).toBe('test');
		});

		it('should handle decryption errors', async () => {
			const mockRecords = [
				{
					id: 's-1',
					ownerId: 'owner-1',
					encryptedData: mockEncryptedData,
					encryptedDataIV: mockIV
				} as unknown as BaseRecord
			];

			vi.mocked(localDB.getByIndex).mockResolvedValue(mockRecords);
			vi.mocked(decrypt).mockRejectedValue(new Error('Decrypt error'));

			await expect(ScriptService.listByOwner('owner-1')).rejects.toThrow(AppError);
		});
	});

	describe('get', () => {
		it('should return decrypted script detail', async () => {
			const mockRecord = {
				id: 's-1',
				ownerId: 'owner-1',
				isDeleted: false,
				encryptedData: mockEncryptedData,
				encryptedDataIV: mockIV
			} as unknown as BaseRecord;

			vi.mocked(localDB.getRecord).mockResolvedValue(mockRecord);

			const result = await ScriptService.get('s-1');

			expect(result).toBeDefined();
			expect(result?.id).toBe('s-1');
			expect(result?.name).toBe('Test Script');
		});

		it('should return null if record is missing or deleted', async () => {
			vi.mocked(localDB.getRecord).mockResolvedValue(undefined as unknown as BaseRecord);
			expect(await ScriptService.get('non-existent')).toBeNull();

			vi.mocked(localDB.getRecord).mockResolvedValue({
				id: 'deleted',
				isDeleted: true
			} as unknown as BaseRecord);
			expect(await ScriptService.get('deleted')).toBeNull();
		});
	});

	describe('create', () => {
		it('should create a new script with merged defaults', async () => {
			const result = await ScriptService.create('owner-1', { name: 'Custom Name' });

			expect(result.id).toBe('test-id');
			expect(result.ownerId).toBe('owner-1');
			expect(result.name).toBe('Custom Name');
			expect(result.placement).toBe('display'); // From defaults

			expect(assertOwnedResourceParentExists).toHaveBeenCalledWith('owner-1');
			expect(localDB.putRecord).toHaveBeenCalledWith(
				'scripts',
				expect.objectContaining({
					id: 'test-id',
					ownerId: 'owner-1',
					encryptedData: mockEncryptedData
				})
			);
			expect(DataSyncService.pushRecord).toHaveBeenCalledWith('scripts', expect.any(Object), true);
		});
	});

	describe('update', () => {
		it('should update and decrypt-merge existing fields', async () => {
			const mockRecord = {
				id: 's-1',
				ownerId: 'owner-1',
				isDeleted: false,
				encryptedData: mockEncryptedData,
				encryptedDataIV: mockIV
			} as unknown as BaseRecord;

			vi.mocked(localDB.getRecord).mockResolvedValue(mockRecord);

			const result = await ScriptService.update('s-1', { placement: 'output' });

			expect(result.placement).toBe('output');
			expect(result.name).toBe('Test Script'); // Preserved from existing

			expect(localDB.putRecord).toHaveBeenCalledWith('scripts', expect.any(Object));
			expect(DataSyncService.pushRecord).toHaveBeenCalledWith('scripts', expect.any(Object));
		});

		it('should throw if not found', async () => {
			vi.mocked(localDB.getRecord).mockResolvedValue(undefined as unknown as BaseRecord);

			await expect(ScriptService.update('missing', { name: 'new' })).rejects.toThrow(
				'Script not found: missing'
			);
		});

		it('should assert ownership if expectedOwnerId provided', async () => {
			const mockRecord = {
				id: 's-1',
				ownerId: 'owner-1',
				isDeleted: false,
				encryptedData: mockEncryptedData,
				encryptedDataIV: mockIV
			} as unknown as BaseRecord;
			vi.mocked(localDB.getRecord).mockResolvedValue(mockRecord);

			await ScriptService.update('s-1', { name: 'new' }, 'owner-1');

			expect(assertScriptOwnedBy).toHaveBeenCalledWith('owner-1', 's-1');
		});
	});

	describe('delete', () => {
		it('should soft delete and trigger sync', async () => {
			await ScriptService.delete('s-1');

			expect(localDB.softDeleteRecord).toHaveBeenCalledWith('scripts', 's-1');
			expect(DataSyncService.pushById).toHaveBeenCalledWith('scripts', 's-1');
		});

		it('should assert ownership if provided', async () => {
			await ScriptService.delete('s-1', 'owner-1');

			expect(assertScriptOwnedBy).toHaveBeenCalledWith('owner-1', 's-1');
		});
	});
});
