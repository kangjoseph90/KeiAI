/**
 * DB Adapter Tests: web.ts (Dexie)
 *
 * Tests the WebDatabaseAdapter implementation using fake-indexeddb.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fakeIndexedDB, { IDBKeyRange as FDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';
import type {
    IDatabaseAdapter,
    BaseRecord,
    DataRecord,
    TableName,
    ChatRecord,
    MessageRecord,
    CharacterRecord,
    SettingsRecord
} from '$lib/adapters/db';

// Mock Tauri to ensure WebDatabaseAdapter is used
vi.mock('@tauri-apps/api/core', () => ({
    isTauri: () => false
}));

// Configure Dexie to use fake-indexeddb
Dexie.dependencies.indexedDB = fakeIndexedDB as unknown as IDBFactory;
Dexie.dependencies.IDBKeyRange = FDBKeyRange as unknown as typeof IDBKeyRange;

// Now we can import WebDatabaseAdapter
import { WebDatabaseAdapter } from '$lib/adapters/db/web';

// Helper to create a test record (with data field)
function createTestRecord(
    overrides: Partial<DataRecord> & Record<string, unknown> = {}
): DataRecord {
    const now = Date.now();
    return {
        id: `test-${now}`,
        userId: 'user-123',
        createdAt: now,
        updatedAt: now,
        isDeleted: false,
        data: { name: 'Test' },
        ...overrides
    } as DataRecord;
}

describe('WebDatabaseAdapter (Dexie)', () => {
    let localDB: IDatabaseAdapter;

    beforeEach(async () => {
        // Delete any existing database
        await Dexie.delete('KeiLocalDB').catch(() => {});
        // Create a fresh adapter instance for each test
        localDB = new WebDatabaseAdapter();
    });

    afterEach(async () => {
        // Delete the database after each test
        await Dexie.delete('KeiLocalDB').catch(() => {});
    });

    describe('putRecord and getRecord', () => {
        it('should put and get a record', async () => {
            const record = createTestRecord({ id: 'test-1' });

            await localDB.putRecord('settings', record);
            const retrieved = await localDB.getRecord<BaseRecord>('settings', 'test-1');

            expect(retrieved).toBeDefined();
            expect(retrieved?.id).toBe('test-1');
            expect(retrieved?.userId).toBe('user-123');
        });

        it('should return undefined for non-existent record', async () => {
            const result = await localDB.getRecord<BaseRecord>('settings', 'non-existent');
            expect(result).toBeUndefined();
        });

        it('should update existing record on subsequent put', async () => {
            const record = createTestRecord({ id: 'test-2', updatedAt: 1000 });
            await localDB.putRecord('settings', record);

            const updated = createTestRecord({ id: 'test-2', updatedAt: 2000 });
            await localDB.putRecord('settings', updated);

            const retrieved = await localDB.getRecord<BaseRecord>('settings', 'test-2');
            expect(retrieved?.updatedAt).toBe(2000);
        });
    });

    describe('putRecords (bulk)', () => {
        it('should put multiple records at once', async () => {
            const records = [
                createTestRecord({ id: 'bulk-1' }),
                createTestRecord({ id: 'bulk-2' }),
                createTestRecord({ id: 'bulk-3' })
            ];

            await localDB.putRecords('settings', records);

            const r1 = await localDB.getRecord<BaseRecord>('settings', 'bulk-1');
            const r2 = await localDB.getRecord<BaseRecord>('settings', 'bulk-2');
            const r3 = await localDB.getRecord<BaseRecord>('settings', 'bulk-3');

            expect(r1?.id).toBe('bulk-1');
            expect(r2?.id).toBe('bulk-2');
            expect(r3?.id).toBe('bulk-3');
        });
    });

    describe('deleteRecord', () => {
        it('should delete a record', async () => {
            const record = createTestRecord({ id: 'delete-me' });
            await localDB.putRecord('settings', record);

            await localDB.deleteRecord('settings', 'delete-me');

            const result = await localDB.getRecord<BaseRecord>('settings', 'delete-me');
            expect(result).toBeUndefined();
        });
    });

    describe('deleteByIndex', () => {
        it('should delete records by index value', async () => {
            const records = [
                createTestRecord({ id: 'del-1', userId: 'user-to-delete' }),
                createTestRecord({ id: 'del-2', userId: 'user-to-delete' }),
                createTestRecord({ id: 'del-3', userId: 'keep-user' })
            ];

            await localDB.putRecords('settings', records);
            await localDB.deleteByIndex('settings', 'userId', 'user-to-delete');

            const r1 = await localDB.getRecord<BaseRecord>('settings', 'del-1');
            const r2 = await localDB.getRecord<BaseRecord>('settings', 'del-2');
            const r3 = await localDB.getRecord<BaseRecord>('settings', 'del-3');

            expect(r1).toBeUndefined();
            expect(r2).toBeUndefined();
            expect(r3).toBeDefined();
        });
    });

    describe('softDeleteRecord', () => {
        it('should mark record as deleted without removing it', async () => {
            const record = createTestRecord({ id: 'soft-del', isDeleted: false });
            await localDB.putRecord('settings', record);

            await localDB.softDeleteRecord('settings', 'soft-del');

            const result = await localDB.getRecord<BaseRecord>('settings', 'soft-del');
            expect(result).toBeDefined();
            expect(result?.isDeleted).toBe(true);
        });

        it('should update updatedAt on soft delete', async () => {
            const originalTime = Date.now() - 10000;
            const record = createTestRecord({ id: 'soft-del-time', updatedAt: originalTime });
            await localDB.putRecord('settings', record);

            await localDB.softDeleteRecord('settings', 'soft-del-time');

            const result = await localDB.getRecord<BaseRecord>('settings', 'soft-del-time');
            expect(result?.updatedAt).toBeGreaterThan(originalTime);
        });
    });

    describe('softDeleteByIndex', () => {
        it('should mark multiple records as deleted by index', async () => {
            const records = [
                createTestRecord({ id: 'soft-1', userId: 'target-user', isDeleted: false }),
                createTestRecord({ id: 'soft-2', userId: 'target-user', isDeleted: false })
            ];

            await localDB.putRecords('settings', records);
            await localDB.softDeleteByIndex('settings', 'userId', 'target-user');

            const r1 = await localDB.getRecord<BaseRecord>('settings', 'soft-1');
            const r2 = await localDB.getRecord<BaseRecord>('settings', 'soft-2');

            expect(r1?.isDeleted).toBe(true);
            expect(r2?.isDeleted).toBe(true);
        });
    });

    describe('getAll', () => {
        it('should get all records for a user', async () => {
            const testUserId = `test-user-${Date.now()}`;
            const records = [
                createTestRecord({ id: 'all-1', userId: testUserId }),
                createTestRecord({ id: 'all-2', userId: testUserId }),
                createTestRecord({ id: 'all-3', userId: 'other-user' })
            ];

            await localDB.putRecords('settings', records);

            const results = await localDB.getAll<BaseRecord>('settings', testUserId);

            expect(results).toHaveLength(2);
            expect(results.map((r) => r.id)).toContain('all-1');
            expect(results.map((r) => r.id)).toContain('all-2');
        });

        it('should exclude deleted records', async () => {
            const testUserId = `test-user-${Date.now()}`;
            const records = [
                createTestRecord({ id: 'active', userId: testUserId, isDeleted: false }),
                createTestRecord({ id: 'deleted', userId: testUserId, isDeleted: true })
            ];

            await localDB.putRecords('settings', records);

            const results = await localDB.getAll<BaseRecord>('settings', testUserId);

            expect(results).toHaveLength(1);
            expect(results[0].id).toBe('active');
        });

        it('should sort by updatedAt descending', async () => {
            const testUserId = `test-user-${Date.now()}`;
            const records = [
                createTestRecord({ id: 'old', userId: testUserId, updatedAt: 1000 }),
                createTestRecord({ id: 'new', userId: testUserId, updatedAt: 2000 }),
                createTestRecord({ id: 'newest', userId: testUserId, updatedAt: 3000 })
            ];

            await localDB.putRecords('settings', records);

            const results = await localDB.getAll<BaseRecord>('settings', testUserId);

            expect(results[0].id).toBe('newest');
            expect(results[1].id).toBe('new');
            expect(results[2].id).toBe('old');
        });
    });

    describe('getByIndex', () => {
        it('should get records by index value with limit', async () => {
            const records = [
                createTestRecord({ id: 'idx-1', characterId: 'char-abc' }),
                createTestRecord({ id: 'idx-2', characterId: 'char-abc' }),
                createTestRecord({ id: 'idx-3', characterId: 'char-xyz' })
            ];

            await localDB.putRecords('chats', records as ChatRecord[]);

            const results = await localDB.getByIndex<ChatRecord>(
                'chats',
                'characterId',
                'char-abc',
                10
            );

            expect(results).toHaveLength(2);
            expect(results[0].id).toBe('idx-1');
            expect(results[1].id).toBe('idx-2');
        });

        it('should exclude deleted records', async () => {
            const records = [
                createTestRecord({ id: 'idx-active', characterId: 'char-123', isDeleted: false }),
                createTestRecord({ id: 'idx-deleted', characterId: 'char-123', isDeleted: true })
            ];

            await localDB.putRecords('chats', records as ChatRecord[]);

            const results = await localDB.getByIndex<ChatRecord>(
                'chats',
                'characterId',
                'char-123'
            );

            expect(results).toHaveLength(1);
            expect(results[0].id).toBe('idx-active');
        });
    });

    describe('getRecordsBackward (pagination)', () => {
        it('should get records in reverse order within bounds', async () => {
            const now = Date.now();
            const records = [
                createTestRecord({
                    id: 'msg-1',
                    chatId: 'chat-1',
                    sortOrder: 'a0',
                    updatedAt: now - 3000
                }),
                createTestRecord({
                    id: 'msg-2',
                    chatId: 'chat-1',
                    sortOrder: 'a1',
                    updatedAt: now - 2000
                }),
                createTestRecord({
                    id: 'msg-3',
                    chatId: 'chat-1',
                    sortOrder: 'a2',
                    updatedAt: now - 1000
                }),
                createTestRecord({ id: 'msg-4', chatId: 'chat-1', sortOrder: 'a3', updatedAt: now })
            ];

            await localDB.putRecords('messages', records as MessageRecord[]);

            const results = await localDB.getRecordsBackward<MessageRecord>(
                'messages',
                '[chatId+sortOrder]',
                ['chat-1', 'a0'],
                ['chat-1', 'a3'],
                2
            );

            // between() with exclusive bounds: (a0, a3) = a1, a2
            // reverse + limit(2) = a2, a1
            expect(results).toHaveLength(2);
            expect(results[0].sortOrder).toBe('a2');
            expect(results[1].sortOrder).toBe('a1');
        });

        it('should respect limit parameter', async () => {
            const records = Array.from({ length: 10 }, (_, i) =>
                createTestRecord({
                    id: `msg-${i}`,
                    chatId: 'chat-limit',
                    sortOrder: String.fromCharCode(97 + i)
                })
            );

            await localDB.putRecords('messages', records as MessageRecord[]);

            const results = await localDB.getRecordsBackward<MessageRecord>(
                'messages',
                '[chatId+sortOrder]',
                ['chat-limit', ''],
                ['chat-limit', '\uffff'],
                3
            );

            expect(results.length).toBeLessThanOrEqual(3);
        });

        it('should respect offset parameter', async () => {
            const records = Array.from({ length: 5 }, (_, i) =>
                createTestRecord({
                    id: `msg-${i}`,
                    chatId: 'chat-offset-back',
                    sortOrder: String.fromCharCode(97 + i) // a, b, c, d, e
                })
            );

            await localDB.putRecords('messages', records as MessageRecord[]);

            const results = await localDB.getRecordsBackward<MessageRecord>(
                'messages',
                '[chatId+sortOrder]',
                ['chat-offset-back', ''],
                ['chat-offset-back', '\uffff'],
                2,
                1 // Skip 'e', get 'd', 'c'
            );

            expect(results).toHaveLength(2);
            expect(results[0].sortOrder).toBe('d');
            expect(results[1].sortOrder).toBe('c');
        });
    });

    describe('getRecordsForward (pagination)', () => {
        it('should get records in forward order within bounds', async () => {
            const now = Date.now();
            const records = [
                createTestRecord({
                    id: 'msg-1',
                    chatId: 'chat-1',
                    sortOrder: 'a0',
                    updatedAt: now - 3000
                }),
                createTestRecord({
                    id: 'msg-2',
                    chatId: 'chat-1',
                    sortOrder: 'a1',
                    updatedAt: now - 2000
                }),
                createTestRecord({
                    id: 'msg-3',
                    chatId: 'chat-1',
                    sortOrder: 'a2',
                    updatedAt: now - 1000
                })
            ];

            await localDB.putRecords('messages', records as MessageRecord[]);

            const results = await localDB.getRecordsForward<MessageRecord>(
                'messages',
                '[chatId+sortOrder]',
                ['chat-1', 'a0'],
                ['chat-1', 'a3'], // Use a3 as upper bound (exclusive) to include a0, a1, a2
                3
            );

            // between() with exclusive bounds: (a0, a3) = a1, a2
            // Wait, the lower bound is exclusive too, so a0 is excluded
            // We get a1, a2
            expect(results).toHaveLength(2);
            expect(results[0].sortOrder).toBe('a1');
            expect(results[1].sortOrder).toBe('a2');
        });

        it('should respect offset parameter', async () => {
            const records = Array.from({ length: 5 }, (_, i) =>
                createTestRecord({
                    id: `msg-${i}`,
                    chatId: 'chat-offset-forward',
                    sortOrder: String.fromCharCode(97 + i) // a, b, c, d, e
                })
            );

            await localDB.putRecords('messages', records as MessageRecord[]);

            const results = await localDB.getRecordsForward<MessageRecord>(
                'messages',
                '[chatId+sortOrder]',
                ['chat-offset-forward', ''],
                ['chat-offset-forward', '\uffff'],
                2,
                1 // Skip 'a', get 'b', 'c'
            );

            expect(results).toHaveLength(2);
            expect(results[0].sortOrder).toBe('b');
            expect(results[1].sortOrder).toBe('c');
        });
    });

    describe('getUnsyncedChanges', () => {
        it('should get records modified since timestamp', async () => {
            const testUserId = `test-user-${Date.now()}`;
            const now = Date.now();
            const old = now - 10000;
            const recent = now - 1000;

            const records = [
                createTestRecord({ id: 'old-rec', userId: testUserId, updatedAt: old }),
                createTestRecord({ id: 'recent-rec', userId: testUserId, updatedAt: recent })
            ];

            await localDB.putRecords('settings', records);

            const results = await localDB.getUnsyncedChanges<BaseRecord>(
                'settings',
                testUserId,
                now - 5000
            );

            expect(results).toHaveLength(1);
            expect(results[0].id).toBe('recent-rec');
        });

        it('should include records with updatedAt equal to threshold', async () => {
            const testUserId = `test-user-${Date.now()}`;
            const now = Date.now();
            const record = createTestRecord({
                id: 'edge-rec',
                userId: testUserId,
                updatedAt: now - 5000
            });

            await localDB.putRecords('settings', [record]);

            const results = await localDB.getUnsyncedChanges<BaseRecord>(
                'settings',
                testUserId,
                now - 5000
            );

            expect(results).toHaveLength(1);
        });
    });

    describe('transaction', () => {
        it('should execute callback within transaction', async () => {
            const record = createTestRecord({ id: 'txn-test' });

            let result = '';
            await localDB.transaction(['settings'], 'rw', async () => {
                await localDB.putRecord('settings', record);
                const retrieved = await localDB.getRecord('settings', 'txn-test');
                result = retrieved?.id || '';
            });

            expect(result).toBe('txn-test');
        });

        it('should commit changes on successful callback', async () => {
            const record = createTestRecord({ id: 'txn-commit' });

            await localDB.transaction(['settings'], 'rw', async () => {
                await localDB.putRecord('settings', record);
            });

            const result = await localDB.getRecord<BaseRecord>('settings', 'txn-commit');
            expect(result?.id).toBe('txn-commit');
        });

        it('should support multi-table transactions', async () => {
            const charRecord = createTestRecord({ id: 'txn-char-1' });
            const chatRecord = createTestRecord({ id: 'txn-chat-1', characterId: 'txn-char-1' });

            await localDB.transaction(['characters', 'chats'], 'rw', async () => {
                await localDB.putRecord('characters', charRecord);
                await localDB.putRecord('chats', chatRecord as unknown as ChatRecord);
            });

            const char = await localDB.getRecord<BaseRecord>('characters', 'txn-char-1');
            const chat = await localDB.getRecord<BaseRecord>('chats', 'txn-chat-1');

            expect(char).toBeDefined();
            expect(chat).toBeDefined();
        });

        it('should rollback on error', async () => {
            const beforeRecord = createTestRecord({ id: 'rollback-test', updatedAt: 100 });

            await localDB.putRecord('settings', beforeRecord);

            try {
                await localDB.transaction(['settings'], 'rw', async () => {
                    await localDB.putRecord(
                        'settings',
                        createTestRecord({ id: 'rollback-test', updatedAt: 200 })
                    );
                    throw new Error('Intentional error');
                });
            } catch {
                // Expected
            }

            const result = await localDB.getRecord<BaseRecord>('settings', 'rollback-test');
            expect(result?.updatedAt).toBe(100); // Should have original value
        });
    });

    describe('character table', () => {
        it('should store and retrieve character records', async () => {
            const record = createTestRecord({ id: 'char-1' });

            await localDB.putRecord('characters', record);

            const result = await localDB.getRecord('characters', 'char-1');

            expect(result).toBeDefined();
        });
    });

    describe('chat table', () => {
        it('should store and retrieve chat records with characterId', async () => {
            const record = createTestRecord({ id: 'chat-1', characterId: 'char-1' });

            await localDB.putRecord('chats', record as unknown as ChatRecord);

            const result = await localDB.getRecord('chats', 'chat-1');

            expect(result).toBeDefined();
        });
    });

    describe('message-specific functionality', () => {
        it('should support compound index queries for messages', async () => {
            const records = [
                createTestRecord({
                    id: 'msg-1',
                    chatId: 'chat-compound',
                    sortOrder: 'a0',
                    data: { content: 'message 1' }
                }),
                createTestRecord({
                    id: 'msg-2',
                    chatId: 'chat-compound',
                    sortOrder: 'a1',
                    data: { content: 'message 2' }
                })
            ];

            await localDB.putRecords('messages', records as MessageRecord[]);

            // Query using compound index
            const results = await localDB.getByIndex<MessageRecord>(
                'messages',
                'chatId',
                'chat-compound'
            );

            expect(results).toHaveLength(2);
        });
    });

    describe('data field handling', () => {
        it('should store and retrieve data field as a plain object', async () => {
            const data = { name: 'Test', description: 'Hello' };
            const record = createTestRecord({
                id: 'data-test',
                data
            });
            await localDB.putRecord('settings', record);
            const retrieved = await localDB.getRecord<DataRecord>('settings', 'data-test');

            expect(retrieved?.data).toEqual(data);
        });
    });

    describe('cross-table isolation', () => {
        it('should not leak data between different tables', async () => {
            const settingsRecord = createTestRecord({ id: 'same-id', updatedAt: 1000 });
            const personasRecord = createTestRecord({ id: 'same-id', updatedAt: 9999 });

            await localDB.putRecord('settings', settingsRecord);
            await localDB.putRecord('personas', personasRecord);

            const settings = await localDB.getRecord<BaseRecord>('settings', 'same-id');
            const personas = await localDB.getRecord<BaseRecord>('personas', 'same-id');

            expect(settings?.updatedAt).toBe(1000);
            expect(personas?.updatedAt).toBe(9999);
        });
    });
});
