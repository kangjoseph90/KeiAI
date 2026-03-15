/**
 * Persona Service Tests
 *
 * Tests the PersonaService which manages persona creation, updates, and deletion.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PersonaService, type PersonaFields } from '$lib/services/content/persona';
import { getActiveSession } from '$lib/services/session';
import { localDB, type PersonaRecord } from '$lib/adapters/db';
import { encrypt, decrypt } from '$lib/crypto';
import { AppError } from '$lib/types/errors';
import { encryptedWriteQueue } from '$lib/services/content/write_queue';

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
		getAll: vi.fn(),
		getRecord: vi.fn(),
		putRecord: vi.fn(),
		softDeleteRecord: vi.fn()
	}
}));

vi.mock('$lib/utils/id', () => ({
	generateId: vi.fn(() => 'persona-123')
}));

describe('PersonaService', () => {
	const mockUserId = 'user-123';
	const mockMasterKey = {} as CryptoKey;
	const mockNow = 1710000000000;

	const basePersonaFields: PersonaFields = {
		name: 'Test Persona',
		description: 'Test Description'
	};

	const mockRecord: PersonaRecord = {
		id: 'persona-123',
		userId: mockUserId,
		createdAt: mockNow,
		updatedAt: mockNow,
		isDeleted: false,
		encryptedData: new Uint8Array([1, 2, 3]),
		encryptedDataIV: new Uint8Array([4, 5, 6])
	};

	beforeEach(() => {
		vi.resetAllMocks(); // Use reset instead of clear for cleaner state
		vi.useFakeTimers();
		vi.setSystemTime(mockNow);
		encryptedWriteQueue.drop('personas', 'persona-123');

		// Default session mock
		vi.mocked(getActiveSession).mockReturnValue({
			userId: mockUserId,
			masterKey: mockMasterKey,
			isGuest: false,
			identityKeyPair: {} as CryptoKeyPair
		});

		// Default crypto mocks
		vi.mocked(encrypt).mockResolvedValue({
			ciphertext: mockRecord.encryptedData,
			iv: mockRecord.encryptedDataIV
		});
		vi.mocked(decrypt).mockResolvedValue(JSON.stringify(basePersonaFields));
	});

	describe('list', () => {
		it('should list and decrypt all personas for the active user', async () => {
			vi.mocked(localDB.getAll).mockResolvedValue([mockRecord]);

			const result = await PersonaService.list();

			expect(result).toHaveLength(1);
			expect(result[0]).toEqual({
				id: 'persona-123',
				...basePersonaFields
			});
		});
	});

	describe('get', () => {
		it('should return a persona by id', async () => {
			vi.mocked(localDB.getRecord).mockResolvedValue(mockRecord);
			const result = await PersonaService.get('persona-123');
			expect(result?.name).toBe(basePersonaFields.name);
		});

		it('should return null if missing', async () => {
			vi.mocked(localDB.getRecord).mockResolvedValue(undefined);
			expect(await PersonaService.get('none')).toBeNull();
		});
	});

	describe('create', () => {
		it('should create a persona', async () => {
			const result = await PersonaService.create({ name: 'New' });
			expect(result.name).toBe('New');
			expect(localDB.putRecord).toHaveBeenCalled();
		});
	});

	describe('update', () => {
		it('should update fields', async () => {
			vi.mocked(localDB.getRecord).mockResolvedValue(mockRecord);
			const result = await PersonaService.update('persona-123', { name: 'Updated' });
			expect(result.name).toBe('Updated');

			await vi.runAllTimersAsync();
			expect(localDB.putRecord).toHaveBeenCalled();
		});

		it('should throw AppError when decrypt fails', async () => {
			vi.mocked(localDB.getRecord).mockResolvedValue({ ...mockRecord });
			vi.mocked(decrypt).mockRejectedValueOnce(new Error('Decrypt Error'));

			await expect(PersonaService.update('persona-123', { name: 'Fail' })).rejects.toThrow(
				AppError
			);
		});
	});

	describe('delete', () => {
		it('should soft delete', async () => {
			await PersonaService.delete('persona-123');
			expect(localDB.softDeleteRecord).toHaveBeenCalledWith('personas', 'persona-123');
		});
	});
});
