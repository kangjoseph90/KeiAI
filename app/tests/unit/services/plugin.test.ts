/**
 * Plugin Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PluginService, type PluginFields } from '$lib/services/content/plugin';
import type { PluginRecord } from '$lib/adapters/db';
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
		getAll: vi.fn(),
		getRecord: vi.fn(),
		putRecord: vi.fn(),
		softDeleteRecord: vi.fn()
	}
}));

vi.mock('$lib/shared/id', () => ({
	generateId: vi.fn(() => 'test-plugin-id')
}));

import { encrypt, decrypt } from '$lib/crypto';
import { getActiveSession } from '$lib/services/session';
import { localDB } from '$lib/adapters/db';

describe('PluginService', () => {
	const mockUserId = 'user-123';
	const mockMasterKey = {} as CryptoKey;
	const mockEncryptedData = new Uint8Array([7, 8, 9]);
	const mockIV = new Uint8Array([10, 11, 12]);

	const defaultFields: PluginFields = {
		name: 'Test Plugin',
		description: 'Desc',
		version: '1.0.0',
		code: 'console.log("hello")',
		config: { key: 'val' },
		hooks: [{ event: 'onRender', handler: 'main' }]
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

		vi.mocked(decrypt).mockResolvedValue(JSON.stringify(defaultFields));
	});

	describe('list', () => {
		it('should return decrypted plugins', async () => {
			const mockRecords: PluginRecord[] = [
				{
					id: 'p-1',
					userId: mockUserId,
					createdAt: 100,
					updatedAt: 100,
					isDeleted: false,
					encryptedData: mockEncryptedData,
					encryptedDataIV: mockIV
				}
			];

			vi.mocked(localDB.getAll).mockResolvedValue(mockRecords);

			const result = await PluginService.list();

			expect(result).toHaveLength(1);
			expect(result[0].id).toBe('p-1');
			expect(result[0].name).toBe('Test Plugin');
			expect(result[0].hooks).toHaveLength(1);
		});
	});

	describe('get', () => {
		it('should return decrypted plugin', async () => {
			const mockRecord: PluginRecord = {
				id: 'p-1',
				userId: mockUserId,
				createdAt: 100,
				updatedAt: 100,
				isDeleted: false,
				encryptedData: mockEncryptedData,
				encryptedDataIV: mockIV
			};

			vi.mocked(localDB.getRecord).mockResolvedValue(mockRecord);

			const result = await PluginService.get('p-1');
			expect(result?.id).toBe('p-1');
			expect(result?.code).toBe('console.log("hello")');
		});
	});

	describe('create', () => {
		it('should create a new plugin', async () => {
			const result = await PluginService.create({ name: 'New Plugin' });

			expect(result.id).toBe('test-plugin-id');
			expect(localDB.putRecord).toHaveBeenCalled();
		});
	});

	describe('update', () => {
		it('should update and merge plugin fields', async () => {
			const mockRecord: PluginRecord = {
				id: 'p-1',
				userId: mockUserId,
				createdAt: 100,
				updatedAt: 100,
				isDeleted: false,
				encryptedData: mockEncryptedData,
				encryptedDataIV: mockIV
			};

			vi.mocked(localDB.getRecord).mockResolvedValue(mockRecord);

			const result = await PluginService.update('p-1', { version: '1.1.0' });

			expect(result.version).toBe('1.1.0');
			expect(result.name).toBe('Test Plugin');
			expect(localDB.putRecord).toHaveBeenCalled();
		});
	});

	describe('delete', () => {
		it('should soft delete a plugin', async () => {
			await PluginService.delete('p-1');

			expect(localDB.softDeleteRecord).toHaveBeenCalledWith('plugins', 'p-1');
		});
	});
});
