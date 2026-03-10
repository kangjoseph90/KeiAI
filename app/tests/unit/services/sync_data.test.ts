import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataSyncService } from '$lib/services/sync/data';
import { pb } from '$lib/adapters/pb';
import { localDB, TABLES } from '$lib/adapters/db';
import { appKV } from '$lib/adapters/kv';
import { getActiveSession } from '$lib/services/session';
import { toBase64, fromBase64 } from '$lib/crypto';
import type { BaseRecord } from '$lib/adapters/db';

// Mock Collection Mock
const mockCollection = {
	subscribe: vi.fn(),
	unsubscribe: vi.fn(),
	getList: vi.fn(),
	create: vi.fn(),
	update: vi.fn()
};

const mockBatchCollection = {
	upsert: vi.fn(),
	create: vi.fn(),
	delete: vi.fn()
};

const mockBatch = {
	collection: vi.fn(() => mockBatchCollection),
	send: vi.fn()
};

// Mock Dependencies
vi.mock('$lib/adapters/pb', () => ({
	pb: {
		authStore: { isValid: true },
		collection: vi.fn(() => mockCollection),
		filter: vi.fn((s) => s),
		createBatch: vi.fn(() => mockBatch)
	}
}));

vi.mock('$lib/adapters/db', () => ({
	SYNC_TABLES: ['characterSummaries', 'chatSummaries'],
	TABLES: ['characterSummaries', 'chatSummaries'],
	localDB: {
		getRecord: vi.fn(),
		putRecord: vi.fn(),
		getUnsyncedChanges: vi.fn(),
		subscribeWriteEvents: vi.fn(() => () => {})
	}
}));

vi.mock('$lib/adapters/kv', () => ({
	appKV: {
		get: vi.fn(),
		set: vi.fn(),
		remove: vi.fn()
	}
}));

vi.mock('$lib/services/session', () => ({
	getActiveSession: vi.fn()
}));

vi.mock('$lib/crypto', () => ({
	toBase64: vi.fn((b) => 'base64-' + b),
	fromBase64: vi.fn((s) => s.replace('base64-', ''))
}));

describe('DataSyncService', () => {
	const mockUserId = 'user-123';

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getActiveSession).mockReturnValue({
			userId: mockUserId,
			isGuest: false,
			masterKey: {} as CryptoKey
		});
		(pb.authStore as unknown as { isValid: boolean }).isValid = true;
	});

	describe('Realtime Subscription', () => {
		it('should subscribe to all sync tables', async () => {
			await DataSyncService.subscribeRealtime();
			expect(mockCollection.subscribe).toHaveBeenCalledTimes(TABLES.length);
		});

		it('should handle unsubscribe', async () => {
			// Force state using type assertion for private member
			(DataSyncService as unknown as { subscribed: boolean }).subscribed = true;
			await DataSyncService.unsubscribeRealtime();
			expect(mockCollection.unsubscribe).toHaveBeenCalled();
			expect(DataSyncService.isSubscribed).toBe(false);
		});
	});

	describe('Pull Logic (syncAll)', () => {
		it('should pull changes and handle LWW conflict', async () => {
			const tableName = 'characterSummaries';
			vi.mocked(appKV.get).mockResolvedValue('1000');

			const serverRecord = {
				id: 'rec-1',
				updatedAt: 2000,
				updated: '2023-01-01',
				encryptedData: 'base64-data'
			};

			vi.mocked(mockCollection.getList).mockResolvedValue({
				items: [serverRecord],
				page: 1,
				totalPages: 1
			} as unknown as { items: unknown[]; page: number; totalPages: number });

			// Case 1: Remote is newer
			vi.mocked(localDB.getRecord).mockResolvedValue({
				id: 'rec-1',
				updatedAt: 1500
			} as BaseRecord);

			await DataSyncService.syncAll();

			expect(localDB.putRecord).toHaveBeenCalledWith(
				tableName,
				expect.objectContaining({
					id: 'rec-1',
					updatedAt: 2000
				}),
				expect.objectContaining({ origin: 'sync' })
			);
		});

		it('should push correction if local is newer', async () => {
			const tableName = 'characterSummaries' as const;
			vi.mocked(appKV.get).mockResolvedValue('1000');
			const serverRecord = { id: 'rec-1', updatedAt: 1100, updated: '2023-01-01' };
			const localRecord = { id: 'rec-1', updatedAt: 1200, userId: mockUserId };

			vi.mocked(mockCollection.getList).mockResolvedValue({
				items: [serverRecord],
				page: 1,
				totalPages: 1
			} as unknown as { items: unknown[]; page: number; totalPages: number });
			vi.mocked(localDB.getRecord).mockResolvedValue(localRecord as BaseRecord);

			await DataSyncService.syncAll();

			expect(mockBatchCollection.upsert).toHaveBeenCalledWith(
				expect.objectContaining({ id: 'rec-1' })
			);
			expect(mockBatch.send).toHaveBeenCalled();
		});
	});

	describe('Push Logic', () => {
		it('pushRecord should use create if isNew is true', async () => {
			const record = { id: 'new-1', userId: mockUserId } as BaseRecord;
			await DataSyncService.pushRecord('characterSummaries', record, true);
			expect(mockBatchCollection.create).toHaveBeenCalled();
			expect(mockBatch.send).toHaveBeenCalled();
		});

		it('pushRecord should use upsert if isNew is false', async () => {
			const record = { id: 'existing-1', userId: mockUserId } as BaseRecord;

			await DataSyncService.pushRecord('characterSummaries', record);

			expect(mockBatchCollection.upsert).toHaveBeenCalled();
			expect(mockBatch.send).toHaveBeenCalled();
		});
	});

	describe('pushRecentWrites', () => {
		it('should fetch unsynced changes and push them using upsert batch', async () => {
			const record = { id: 'offline-1' } as BaseRecord;
			vi.mocked(localDB.getUnsyncedChanges).mockResolvedValue([record]);

			await DataSyncService.pushRecentWrites(mockUserId, 5000);

			expect(localDB.getUnsyncedChanges).toHaveBeenCalled();
			expect(mockBatchCollection.upsert).toHaveBeenCalled();
			expect(mockBatch.send).toHaveBeenCalled();
		});
	});
});
