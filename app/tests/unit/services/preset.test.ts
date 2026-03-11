/**
 * Preset Service Tests
 *
 * Tests the PresetService which manages generation parameter presets.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	PresetService,
	type PresetSummaryFields,
	type PresetDataFields
} from '$lib/services/content/preset';
import { getActiveSession } from '$lib/services/session';
import { localDB, type PresetSummaryRecord, type PresetDataRecord } from '$lib/adapters/db';
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
		getAll: vi.fn(),
		getRecord: vi.fn(),
		putRecord: vi.fn(),
		softDeleteRecord: vi.fn(),
		transaction: vi.fn((_tables: string[], _mode: string, cb: () => Promise<void>) => cb())
	}
}));

vi.mock('$lib/shared/id', () => ({
	generateId: vi.fn(() => 'preset-123')
}));

describe('PresetService', () => {
	const mockUserId = 'user-123';
	const mockMasterKey = {} as CryptoKey;
	const mockNow = 1710000000000;

	const mockSummaryFields: PresetSummaryFields = {
		name: 'Test Preset',
		description: 'Test Description'
	};

	const mockDataFields: PresetDataFields = {
		model: 'test-model',
		templateOrder: [],
		authorsNote: '',
		authorsNoteDepth: 4,
		jailbreakPrompt: '',
		jailbreakEnabled: false,
		temperature: 0.9,
		topP: 1,
		topK: 0,
		frequencyPenalty: 0,
		presencePenalty: 0,
		maxTokens: 600,
		maxContextTokens: 4096,
		memoryTokensRatio: 0.2
	};

	const mockSummaryRecord: PresetSummaryRecord = {
		id: 'preset-123',
		userId: mockUserId,
		createdAt: mockNow,
		updatedAt: mockNow,
		isDeleted: false,
		encryptedData: new Uint8Array([1]),
		encryptedDataIV: new Uint8Array([2])
	};

	const mockDataRecord: PresetDataRecord = {
		id: 'preset-123',
		userId: mockUserId,
		createdAt: mockNow,
		updatedAt: mockNow,
		isDeleted: false,
		encryptedData: new Uint8Array([3]),
		encryptedDataIV: new Uint8Array([4])
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(mockNow);

		vi.mocked(getActiveSession).mockReturnValue({
			userId: mockUserId,
			masterKey: mockMasterKey,
			isGuest: false,
			identityKeyPair: {} as CryptoKeyPair
		});

		vi.mocked(encrypt).mockResolvedValue({
			ciphertext: new Uint8Array([0]),
			iv: new Uint8Array([0])
		});

		vi.mocked(decrypt).mockImplementation((_key, options) => {
			if (options.ciphertext === mockSummaryRecord.encryptedData) {
				return Promise.resolve(JSON.stringify(mockSummaryFields));
			}
			return Promise.resolve(JSON.stringify(mockDataFields));
		});
	});

	describe('list', () => {
		it('should list all preset summaries', async () => {
			vi.mocked(localDB.getAll).mockResolvedValue([mockSummaryRecord]);

			const result = await PresetService.list();

			expect(result).toHaveLength(1);
			expect(result[0].name).toBe(mockSummaryFields.name);
			expect(localDB.getAll).toHaveBeenCalledWith('presetSummaries', mockUserId);
		});
	});

	describe('getDetail', () => {
		it('should return full preset detail', async () => {
			vi.mocked(localDB.getRecord).mockImplementation((table, _id) => {
				if (table === 'presetSummaries') return Promise.resolve(mockSummaryRecord);
				if (table === 'presetData') return Promise.resolve(mockDataRecord);
				return Promise.resolve(undefined);
			});

			const result = await PresetService.getDetail('preset-123');

			expect(result).not.toBeNull();
			expect(result?.id).toBe('preset-123');
			expect(result?.name).toBe(mockSummaryFields.name);
			expect(result?.data.model).toBe(mockDataFields.model);
		});

		it('should return null if either record is missing', async () => {
			vi.mocked(localDB.getRecord).mockResolvedValue(undefined);
			expect(await PresetService.getDetail('none')).toBeNull();
		});
	});

	describe('create', () => {
		it('should create summary and data records', async () => {
			const result = await PresetService.create(mockSummaryFields, mockDataFields);

			expect(result.id).toBe('preset-123');
			expect(localDB.transaction).toHaveBeenCalled();
			expect(localDB.putRecord).toHaveBeenCalledTimes(2);
		});
	});

	describe('update', () => {
		it('should update both summary and data correctly', async () => {
			vi.mocked(localDB.getRecord).mockImplementation((table, _id) => {
				if (table === 'presetSummaries') return Promise.resolve(mockSummaryRecord);
				if (table === 'presetData') return Promise.resolve(mockDataRecord);
				return Promise.resolve(undefined);
			});

			const result = await PresetService.update(
				'preset-123',
				{ name: 'New Name' },
				{ temperature: 0.5 }
			);

			expect(result.name).toBe('New Name');
			expect(result.data.temperature).toBe(0.5);
			expect(localDB.putRecord).toHaveBeenCalledTimes(2);
		});

		it('should throw if records not found', async () => {
			vi.mocked(localDB.getRecord).mockResolvedValue(undefined);
			await expect(PresetService.update('none')).rejects.toThrow(AppError);
		});
	});

	describe('delete', () => {
		it('should soft delete both records', async () => {
			await PresetService.delete('preset-123');
			expect(localDB.softDeleteRecord).toHaveBeenCalledTimes(2);
		});
	});
});
