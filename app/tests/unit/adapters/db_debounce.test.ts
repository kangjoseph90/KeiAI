/**
 * DB Adapter Tests: web.ts (Debouncing Logic)
 *
 * Tests the Write-Buffer and debouncing logic inside WebDatabaseAdapter.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fakeIndexedDB, { IDBKeyRange as FDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';
import type { BaseRecord, EncryptedRecord } from '$lib/adapters/db';

// Mock Tauri to ensure WebDatabaseAdapter is used
vi.mock('@tauri-apps/api/core', () => ({
	isTauri: () => false
}));

// Configure Dexie to use fake-indexeddb
Dexie.dependencies.indexedDB = fakeIndexedDB as unknown as IDBFactory;
Dexie.dependencies.IDBKeyRange = FDBKeyRange as unknown as typeof IDBKeyRange;

// Now we can import WebDatabaseAdapter
import { WebDatabaseAdapter } from '$lib/adapters/db/web';

function createTestRecord(id: string, overrides: Partial<EncryptedRecord> = {}): EncryptedRecord {
	const now = Date.now();
	return {
		id,
		userId: 'user-123',
		createdAt: now,
		updatedAt: now,
		isDeleted: false,
		encryptedData: new Uint8Array([1, 2, 3]),
		encryptedDataIV: new Uint8Array([1, 2, 3, 4, 5, 6, 7]),
		...overrides
	} as EncryptedRecord;
}

// Helper for real timers since fake timers break IndexedDB transactions
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('WebDatabaseAdapter (Debouncing)', () => {
	let localDB: WebDatabaseAdapter;

	beforeEach(async () => {
		await Dexie.delete('KeiLocalDB').catch(() => {});
		localDB = new WebDatabaseAdapter();
	});

	afterEach(async () => {
		await Dexie.delete('KeiLocalDB').catch(() => {});
	});

	it('should debounce consecutive putRecord calls without immediate IndexedDB write', async () => {
		const rec1 = createTestRecord('db-1', { updatedAt: 100 });
		const rec2 = createTestRecord('db-1', { updatedAt: 200 });

		// Both are put consecutively
		await localDB.putRecord('settings', rec1);
		await localDB.putRecord('settings', rec2);

		// Record should be available via getRecord (read-your-writes from buffer)
		const retrieved = await localDB.getRecord<BaseRecord>('settings', 'db-1');
		expect(retrieved?.updatedAt).toBe(200);

		// Manually check underlying dexie store (should not be there yet)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const dexieRec = await (localDB as any).getTable('settings').get('db-1');
		expect(dexieRec).toBeUndefined();

		// Fast forward time to trigger flush (DEBOUNCE_MS is 500)
		await sleep(600);

		// Now should be in dexie store
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const dexieRecAfter = await (localDB as any).getTable('settings').get('db-1');
		expect(dexieRecAfter).toBeDefined();
		expect(dexieRecAfter?.updatedAt).toBe(200);
	});

	it('should flush pending writes explicitly when requested', async () => {
		const rec = createTestRecord('db-2');
		await localDB.putRecord('settings', rec);

		// Buffer should have it, not DB yet
		await localDB.flush();

		// Should be in dexie store immediately
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const dexieRec = await (localDB as any).getTable('settings').get('db-2');
		expect(dexieRec).toBeDefined();
	});

	it('should write immediately if immediate option is provided', async () => {
		const rec = createTestRecord('db-3');
		await localDB.putRecord('settings', rec, { immediate: true });

		// Should be in dexie store immediately
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const dexieRec = await (localDB as any).getTable('settings').get('db-3');
		expect(dexieRec).toBeDefined();
	});

	it('should write immediately and bypass buffer inside a Dexie transaction', async () => {
		const rec = createTestRecord('db-4');

		await localDB.transaction(['settings'], 'rw', async () => {
			await localDB.putRecord('settings', rec);
		});

		// Inside transaction it bypassed debounce
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const dexieRec = await (localDB as any).getTable('settings').get('db-4');
		expect(dexieRec).toBeDefined();
	});

	it('should prune buffer upon manual deletion to prevent ghost resurrects', async () => {
		const rec = createTestRecord('db-5');
		await localDB.putRecord('settings', rec);
		
		await localDB.deleteRecord('settings', 'db-5');

		const retrieved = await localDB.getRecord('settings', 'db-5');
		expect(retrieved).toBeUndefined();
		
		await sleep(600); // Check if flush resurrects it
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const dexieRecAfter = await (localDB as any).getTable('settings').get('db-5');
		expect(dexieRecAfter).toBeUndefined();
	});
    
	it('should autoflush when doing an indexed query that might miss buffered data', async () => {
		const rec = createTestRecord('db-6', { userId: 'sync-user' });
		
		// This puts it into the buffer
		await localDB.putRecord('settings', rec);

		// getUnsyncedChanges does an indexed query on settings userId.
		// It should implicitly call flush() before checking, making it instantly available.
		const changes = await localDB.getUnsyncedChanges('settings', 'sync-user', 0);
		
		expect(changes.length).toBe(1);
		expect(changes[0].id).toBe('db-6');
	});

	it('should not leak mutated buffered objects backwards (deep copy check)', async () => {
		const rec = createTestRecord('db-7', { updatedAt: 100 });
		await localDB.putRecord('settings', rec);

		// Modify original object - should not affect buffer
		rec.updatedAt = 999;

		const retrieved = await localDB.getRecord<BaseRecord>('settings', 'db-7');
		expect(retrieved?.updatedAt).toBe(100);

		// Modify retrieved object - should not affect buffer
		if (retrieved) retrieved.updatedAt = 555;

		const retrievedAgain = await localDB.getRecord<BaseRecord>('settings', 'db-7');
		expect(retrievedAgain?.updatedAt).toBe(100);
	});
});
