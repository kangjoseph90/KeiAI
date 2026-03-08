/**
 * Data Sync Service Tests
 *
 * Tests the DataSyncService which handles E2EE data synchronization.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataSyncService } from '$lib/services/sync/data';
import { getActiveSession } from '$lib/services/session';
import { localDB } from '$lib/adapters/db';
import { pb } from '$lib/adapters/pb';
import { appKV } from '$lib/adapters/kv';
import { toBase64 } from '$lib/crypto';

// Types for mocking
interface MockCollection {
	subscribe: ReturnType<typeof vi.fn>;
	unsubscribe: ReturnType<typeof vi.fn>;
	create: ReturnType<typeof vi.fn>;
	update: ReturnType<typeof vi.fn>;
	getList: ReturnType<typeof vi.fn>;
}

// Mock dependencies
vi.mock('$lib/services/session', () => ({
	getActiveSession: vi.fn()
}));

vi.mock('$lib/adapters/db', () => ({
	localDB: {
		getRecord: vi.fn(),
		putRecord: vi.fn(),
		getUnsyncedChanges: vi.fn()
	},
	SYNC_TABLES: ['characterSummaries', 'chatSummaries']
}));

vi.mock('$lib/adapters/pb', () => {
	const mockCollection: MockCollection = {
		subscribe: vi.fn(),
		unsubscribe: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		getList: vi.fn()
	};
	return {
		pb: {
			authStore: { isValid: true },
			collection: vi.fn(() => mockCollection),
			filter: vi.fn((f) => f)
		}
	};
});

vi.mock('$lib/adapters/kv', () => ({
	appKV: {
		get: vi.fn(),
		set: vi.fn(),
		remove: vi.fn()
	}
}));

vi.mock('$lib/crypto', () => ({
	toBase64: vi.fn((u: Uint8Array) => Buffer.from(u).toString('base64')),
	fromBase64: vi.fn((s: string) => new Uint8Array(Buffer.from(s, 'base64')))
}));

describe('DataSyncService', () => {
	const mockUserId = 'user-123';
	const mockRecord = {
		id: 'rec-1',
		userId: mockUserId,
		createdAt: 1000,
		updatedAt: 1000,
		encryptedData: new Uint8Array([1, 2, 3]),
		encryptedDataIV: new Uint8Array([4, 5, 6]),
		isDeleted: false
	};

	let mockCollection: MockCollection;

	beforeEach(() => {
		vi.resetAllMocks();
		mockCollection = vi.mocked(pb.collection)('any') as unknown as MockCollection;

		vi.mocked(getActiveSession).mockReturnValue({
			userId: mockUserId,
			masterKey: {} as CryptoKey,
			isGuest: false
		});
	});

	describe('pushRecord', () => {
		it('should create record on server if isNew is true', async () => {
			await DataSyncService.pushRecord('characterSummaries', mockRecord, true);

			expect(mockCollection.create).toHaveBeenCalledWith(
				expect.objectContaining({
					id: 'rec-1',
					encryptedData: expect.any(String)
				})
			);
			expect(toBase64).toHaveBeenCalled();
		});

		it('should update existing record on server', async () => {
			await DataSyncService.pushRecord('chatSummaries', mockRecord, false);

			expect(mockCollection.update).toHaveBeenCalledWith('rec-1', expect.anything());
		});

		it('should handle 404 by creating the record', async () => {
			mockCollection.update.mockRejectedValue({ status: 404 });
			await DataSyncService.pushRecord('chatSummaries', mockRecord, false);

			expect(mockCollection.create).toHaveBeenCalled();
		});
	});

	describe('resetCursors', () => {
		it('should remove all sync cursors for the user', async () => {
			await DataSyncService.resetCursors(mockUserId);
			expect(appKV.remove).toHaveBeenCalledTimes(2); // SYNC_TABLES.length
		});
	});

	describe('pushById', () => {
		it('should fetch and push record', async () => {
			vi.mocked(localDB.getRecord).mockResolvedValue(mockRecord);
			await DataSyncService.pushById('characterSummaries', 'rec-1');
			expect(pb.collection).toHaveBeenCalledWith('characterSummaries');
			expect(mockCollection.update).toHaveBeenCalled();
		});
	});
});
