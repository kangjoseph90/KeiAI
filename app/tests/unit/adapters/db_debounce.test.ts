/**
 * DB Adapter Tests: web.ts (Immediate Write Logic)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fakeIndexedDB, { IDBKeyRange as FDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';
import type { EncryptedRecord } from '$lib/adapters/db';

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

describe('WebDatabaseAdapter (Immediate writes)', () => {
	let localDB: WebDatabaseAdapter;

	beforeEach(async () => {
		await Dexie.delete('KeiLocalDB').catch(() => {});
		localDB = new WebDatabaseAdapter();
	});

	afterEach(async () => {
		await Dexie.delete('KeiLocalDB').catch(() => {});
	});

	it('should persist the latest value immediately on consecutive putRecord calls', async () => {
		const rec1 = createTestRecord('db-1', { updatedAt: 100 });
		const rec2 = createTestRecord('db-1', { updatedAt: 200 });

		await localDB.putRecord('settings', rec1);
		await localDB.putRecord('settings', rec2);

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const dexieRec = await (localDB as any).getTable('settings').get('db-1');
		expect(dexieRec).toBeDefined();
		expect(dexieRec?.updatedAt).toBe(200);
	});

	it('should keep flush() as a safe no-op for compatibility', async () => {
		const rec = createTestRecord('db-2');
		await localDB.putRecord('settings', rec);
		await localDB.flush();

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const dexieRec = await (localDB as any).getTable('settings').get('db-2');
		expect(dexieRec).toBeDefined();
	});

	it('should write immediately', async () => {
		const rec = createTestRecord('db-3');
		await localDB.putRecord('settings', rec);

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const dexieRec = await (localDB as any).getTable('settings').get('db-3');
		expect(dexieRec).toBeDefined();
	});

	it('should write inside a Dexie transaction', async () => {
		const rec = createTestRecord('db-4');

		await localDB.transaction(['settings'], 'rw', async () => {
			await localDB.putRecord('settings', rec);
		});

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const dexieRec = await (localDB as any).getTable('settings').get('db-4');
		expect(dexieRec).toBeDefined();
	});

	it('should delete records without resurrection behavior', async () => {
		const rec = createTestRecord('db-5');
		await localDB.putRecord('settings', rec);

		await localDB.deleteRecord('settings', 'db-5');

		const retrieved = await localDB.getRecord('settings', 'db-5');
		expect(retrieved).toBeUndefined();
	});

	it('should return indexed query results immediately after putRecord', async () => {
		const rec = createTestRecord('db-6', { userId: 'sync-user' });
		await localDB.putRecord('settings', rec);
		const changes = await localDB.getUnsyncedChanges('settings', 'sync-user', 0);

		expect(changes.length).toBe(1);
		expect(changes[0].id).toBe('db-6');
	});

	it('should isolate persisted objects from caller-side mutation', async () => {
		const rec = createTestRecord('db-7', { updatedAt: 100, userId: 'copy-user' });
		await localDB.putRecord('settings', rec);

		rec.updatedAt = 999;
		const changes = await localDB.getUnsyncedChanges('settings', 'copy-user', 0);
		expect(changes[0]?.updatedAt).toBe(100);
	});
});
