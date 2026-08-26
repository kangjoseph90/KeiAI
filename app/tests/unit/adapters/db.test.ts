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
    DataRecord,
    TableName,
    ChatRecord,
    MessageRecord,
    CharacterRecord,
    SettingsRecord,
    ToolCallRecord
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

const userScope = { scopeType: 'user' as const, scopeId: 'user-123' };

// Helper to create a test record (with data field)
function createTestRecord(
    overrides: Partial<DataRecord> & Record<string, unknown> = {}
): DataRecord {
    const now = Date.now();
    return {
        id: `test-${now}`,
        scopeType: userScope.scopeType,
        scopeId: userScope.scopeId,
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
            const retrieved = await localDB.getRecord<DataRecord>('settings', 'test-1');

            expect(retrieved).toBeDefined();
            expect(retrieved?.id).toBe('test-1');
            expect(retrieved?.scopeId).toBe('user-123');
        });

        it('should return undefined for non-existent record', async () => {
            const result = await localDB.getRecord<DataRecord>('settings', 'non-existent');
            expect(result).toBeUndefined();
        });

        it('should update existing record on subsequent put', async () => {
            const record = createTestRecord({ id: 'test-2', updatedAt: 1000 });
            await localDB.putRecord('settings', record);

            const updated = createTestRecord({ id: 'test-2', updatedAt: 2000 });
            await localDB.putRecord('settings', updated);

            const retrieved = await localDB.getRecord<DataRecord>('settings', 'test-2');
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

            const r1 = await localDB.getRecord<DataRecord>('settings', 'bulk-1');
            const r2 = await localDB.getRecord<DataRecord>('settings', 'bulk-2');
            const r3 = await localDB.getRecord<DataRecord>('settings', 'bulk-3');

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

            const result = await localDB.getRecord<DataRecord>('settings', 'delete-me');
            expect(result).toBeUndefined();
        });
    });

    describe('deleteByIndex', () => {
        it('should delete records by index value', async () => {
            const records = [
                createTestRecord({ id: 'del-1', roomId: 'room-to-delete' }),
                createTestRecord({ id: 'del-2', roomId: 'room-to-delete' }),
                createTestRecord({ id: 'del-3', roomId: 'keep-room' })
            ] as ChatRecord[];

            await localDB.putRecords('chats', records);
            await localDB.deleteByIndex('chats', 'roomId', 'room-to-delete');

            const r1 = await localDB.getRecord<DataRecord>('chats', 'del-1');
            const r2 = await localDB.getRecord<DataRecord>('chats', 'del-2');
            const r3 = await localDB.getRecord<DataRecord>('chats', 'del-3');

            expect(r1).toBeUndefined();
            expect(r2).toBeUndefined();
            expect(r3).toBeDefined();
        });
    });

    describe('softDeleteRecord', () => {
        it('should mark record as deleted without removing it', async () => {
            const record = createTestRecord({
                id: 'soft-del',
                isDeleted: false,
                assetEntries: { hash: 'local' },
                data: { name: 'Keep out' }
            });
            await localDB.putRecord('settings', record);

            await localDB.softDeleteRecord('settings', 'soft-del');

            const result = await localDB.getRecord<DataRecord>('settings', 'soft-del');
            expect(result).toBeDefined();
            expect(result?.isDeleted).toBe(true);
            expect(result?.assetEntries).toBeUndefined();
            expect(result?.data).toEqual({});
        });

        it('should update updatedAt on soft delete', async () => {
            const originalTime = Date.now() - 10000;
            const record = createTestRecord({ id: 'soft-del-time', updatedAt: originalTime });
            await localDB.putRecord('settings', record);

            await localDB.softDeleteRecord('settings', 'soft-del-time');

            const result = await localDB.getRecord<DataRecord>('settings', 'soft-del-time');
            expect(result?.updatedAt).toBeGreaterThan(originalTime);
        });

        it('should not touch an already deleted record', async () => {
            const originalTime = Date.now() - 10000;
            const record = createTestRecord({
                id: 'soft-del-idempotent',
                isDeleted: true,
                updatedAt: originalTime
            });
            await localDB.putRecord('settings', record);

            await localDB.softDeleteRecord('settings', 'soft-del-idempotent');

            const result = await localDB.getRecord<DataRecord>('settings', 'soft-del-idempotent');
            expect(result?.isDeleted).toBe(true);
            expect(result?.updatedAt).toBe(originalTime);
        });
    });

    describe('softDeleteByIndex', () => {
        it('should mark multiple records as deleted by index', async () => {
            const records = [
                createTestRecord({
                    id: 'soft-1',
                    roomId: 'target-room',
                    isDeleted: false,
                    assetEntries: { hash1: 'local' },
                    data: { name: 'Soft 1' }
                }),
                createTestRecord({
                    id: 'soft-2',
                    roomId: 'target-room',
                    isDeleted: false,
                    assetEntries: { hash2: 'remote' },
                    data: { name: 'Soft 2' }
                })
            ] as ChatRecord[];

            await localDB.putRecords('chats', records);
            await localDB.softDeleteByIndex('chats', 'roomId', 'target-room');

            const r1 = await localDB.getRecord<DataRecord>('chats', 'soft-1');
            const r2 = await localDB.getRecord<DataRecord>('chats', 'soft-2');

            expect(r1?.isDeleted).toBe(true);
            expect(r2?.isDeleted).toBe(true);
            expect(r1?.assetEntries).toBeUndefined();
            expect(r2?.assetEntries).toBeUndefined();
            expect(r1?.data).toEqual({});
            expect(r2?.data).toEqual({});
        });

        it('should not touch records already deleted by index', async () => {
            const originalTime = Date.now() - 10000;
            const records = [
                createTestRecord({
                    id: 'soft-index-live',
                    roomId: 'idempotent-room',
                    isDeleted: false
                }),
                createTestRecord({
                    id: 'soft-index-deleted',
                    roomId: 'idempotent-room',
                    isDeleted: true,
                    updatedAt: originalTime
                })
            ] as ChatRecord[];

            await localDB.putRecords('chats', records);
            await localDB.softDeleteByIndex('chats', 'roomId', 'idempotent-room');

            const live = await localDB.getRecord<DataRecord>('chats', 'soft-index-live');
            const deleted = await localDB.getRecord<DataRecord>('chats', 'soft-index-deleted');

            expect(live?.isDeleted).toBe(true);
            expect(deleted?.isDeleted).toBe(true);
            expect(deleted?.updatedAt).toBe(originalTime);
        });
    });

    describe('getAll', () => {
        it('should get all records for a user', async () => {
            const testScope = { scopeType: 'user' as const, scopeId: `test-user-${Date.now()}` };
            const records = [
                createTestRecord({ id: 'all-1', scopeId: testScope.scopeId }),
                createTestRecord({ id: 'all-2', scopeId: testScope.scopeId }),
                createTestRecord({ id: 'all-3', scopeId: 'other-user' })
            ];

            await localDB.putRecords('settings', records);

            const results = await localDB.getAll<DataRecord>('settings', testScope);

            expect(results).toHaveLength(2);
            expect(results.map((r) => r.id)).toContain('all-1');
            expect(results.map((r) => r.id)).toContain('all-2');
        });

        it('should exclude deleted records', async () => {
            const testScope = { scopeType: 'user' as const, scopeId: `test-user-${Date.now()}` };
            const records = [
                createTestRecord({ id: 'active', scopeId: testScope.scopeId, isDeleted: false }),
                createTestRecord({ id: 'deleted', scopeId: testScope.scopeId, isDeleted: true })
            ];

            await localDB.putRecords('settings', records);

            const results = await localDB.getAll<DataRecord>('settings', testScope);

            expect(results).toHaveLength(1);
            expect(results[0].id).toBe('active');
        });

        it('should sort by updatedAt descending', async () => {
            const testScope = { scopeType: 'user' as const, scopeId: `test-user-${Date.now()}` };
            const records = [
                createTestRecord({ id: 'old', scopeId: testScope.scopeId, updatedAt: 1000 }),
                createTestRecord({ id: 'new', scopeId: testScope.scopeId, updatedAt: 2000 }),
                createTestRecord({ id: 'newest', scopeId: testScope.scopeId, updatedAt: 3000 })
            ];

            await localDB.putRecords('settings', records);

            const results = await localDB.getAll<DataRecord>('settings', testScope);

            expect(results[0].id).toBe('newest');
            expect(results[1].id).toBe('new');
            expect(results[2].id).toBe('old');
        });
    });

    describe('getByIndex', () => {
        it('should get records by index value with limit', async () => {
            const records = [
                createTestRecord({ id: 'idx-1', roomId: 'room-abc' }),
                createTestRecord({ id: 'idx-2', roomId: 'room-abc' }),
                createTestRecord({ id: 'idx-3', roomId: 'room-xyz' })
            ];

            await localDB.putRecords('chats', records as ChatRecord[]);

            const results = await localDB.getByIndex<ChatRecord>('chats', 'roomId', 'room-abc', 10);

            expect(results).toHaveLength(2);
            expect(results[0].id).toBe('idx-1');
            expect(results[1].id).toBe('idx-2');
        });

        it('should exclude deleted records', async () => {
            const records = [
                createTestRecord({ id: 'idx-active', roomId: 'room-123', isDeleted: false }),
                createTestRecord({ id: 'idx-deleted', roomId: 'room-123', isDeleted: true })
            ];

            await localDB.putRecords('chats', records as ChatRecord[]);

            const results = await localDB.getByIndex<ChatRecord>('chats', 'roomId', 'room-123');

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

    describe('key-only reads', () => {
        it('reads ordered identities without returning message data', async () => {
            const records = [
                createTestRecord({
                    id: 'identity-1',
                    chatId: 'chat-identity',
                    sortOrder: 'a0',
                    activeSwipeId: 'swipe-1',
                    data: { activeSwipeId: 'swipe-1', parts: ['large body'] }
                }),
                createTestRecord({
                    id: 'identity-2',
                    chatId: 'chat-identity',
                    sortOrder: 'a1',
                    activeSwipeId: 'swipe-2',
                    data: { activeSwipeId: 'swipe-2', parts: ['another large body'] }
                })
            ];
            await localDB.putRecords('messages', records as MessageRecord[]);

            const identities = await localDB.getKeys(
                'messages',
                '[chatId+sortOrder+activeSwipeId+scopeType+scopeId]',
                ['chat-identity', ''],
                ['chat-identity', '\uffff']
            );

            expect(identities).toEqual([
                {
                    primaryKey: 'identity-1',
                    indexKey: ['chat-identity', 'a0', 'swipe-1', 'user', 'user-123'],
                    scopeType: 'user',
                    scopeId: 'user-123'
                },
                {
                    primaryKey: 'identity-2',
                    indexKey: ['chat-identity', 'a1', 'swipe-2', 'user', 'user-123'],
                    scopeType: 'user',
                    scopeId: 'user-123'
                }
            ]);
            expect(identities[0]).not.toHaveProperty('data');
        });

        it('uses the projection supplied by the message record', async () => {
            const record = createTestRecord({
                id: 'identity-update',
                chatId: 'chat-identity-update',
                sortOrder: 'a0',
                activeSwipeId: 'swipe-1',
                data: { activeSwipeId: 'swipe-1', parts: ['before'] }
            }) as MessageRecord;
            await localDB.putRecord('messages', record);

            const readKeys = () =>
                localDB.getKeys(
                    'messages',
                    '[chatId+sortOrder+activeSwipeId+scopeType+scopeId]',
                    ['chat-identity-update', ''],
                    ['chat-identity-update', '\uffff']
                );

            await expect(readKeys()).resolves.toEqual([
                {
                    primaryKey: record.id,
                    indexKey: ['chat-identity-update', 'a0', 'swipe-1', 'user', 'user-123'],
                    scopeType: 'user',
                    scopeId: 'user-123'
                }
            ]);

            await localDB.putRecord('messages', {
                ...record,
                activeSwipeId: 'swipe-1',
                data: { activeSwipeId: 'swipe-1', parts: ['content-only edit'] }
            });
            await expect(readKeys()).resolves.toEqual([
                {
                    primaryKey: record.id,
                    indexKey: ['chat-identity-update', 'a0', 'swipe-1', 'user', 'user-123'],
                    scopeType: 'user',
                    scopeId: 'user-123'
                }
            ]);

            await localDB.putRecord('messages', {
                ...record,
                activeSwipeId: 'swipe-2',
                data: { activeSwipeId: 'swipe-2', parts: ['after'] }
            });

            await expect(readKeys()).resolves.toEqual([
                {
                    primaryKey: record.id,
                    indexKey: ['chat-identity-update', 'a0', 'swipe-2', 'user', 'user-123'],
                    scopeType: 'user',
                    scopeId: 'user-123'
                }
            ]);
        });
    });

    describe('getUnsyncedChanges', () => {
        it('should get records inside the requested timestamp window', async () => {
            const testScope = { scopeType: 'user' as const, scopeId: `test-user-${Date.now()}` };
            const now = Date.now();
            const old = now - 10000;
            const recent = now - 1000;

            const records = [
                createTestRecord({ id: 'old-rec', scopeId: testScope.scopeId, updatedAt: old }),
                createTestRecord({
                    id: 'recent-rec',
                    scopeId: testScope.scopeId,
                    updatedAt: recent
                })
            ];

            await localDB.putRecords('settings', records);

            const results = await localDB.getUnsyncedChanges<DataRecord>(
                'settings',
                testScope,
                now - 5000,
                now
            );

            expect(results).toHaveLength(1);
            expect(results[0].id).toBe('recent-rec');
        });

        it('should include records at the upper bound', async () => {
            const testScope = { scopeType: 'user' as const, scopeId: `test-user-${Date.now()}` };
            const now = Date.now();
            const record = createTestRecord({
                id: 'edge-rec',
                scopeId: testScope.scopeId,
                updatedAt: now - 5000
            });

            await localDB.putRecords('settings', [record]);

            const results = await localDB.getUnsyncedChanges<DataRecord>(
                'settings',
                testScope,
                now - 5001,
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

            const result = await localDB.getRecord<DataRecord>('settings', 'txn-commit');
            expect(result?.id).toBe('txn-commit');
        });

        it('should support multi-table transactions', async () => {
            const charRecord = createTestRecord({ id: 'txn-char-1' });
            const chatRecord = createTestRecord({ id: 'txn-chat-1', roomId: 'txn-room-1' });

            await localDB.transaction(['characters', 'chats'], 'rw', async () => {
                await localDB.putRecord('characters', charRecord);
                await localDB.putRecord('chats', chatRecord as unknown as ChatRecord);
            });

            const char = await localDB.getRecord<DataRecord>('characters', 'txn-char-1');
            const chat = await localDB.getRecord<DataRecord>('chats', 'txn-chat-1');

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

            const result = await localDB.getRecord<DataRecord>('settings', 'rollback-test');
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
        it('should store and retrieve chat records with roomId', async () => {
            const record = createTestRecord({ id: 'chat-1', roomId: 'room-1' });

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

        it('should scope queries for tool_calls by chatId', async () => {
            const records = [
                createTestRecord({
                    id: 'tool-1',
                    chatId: 'chat-1',
                    assetEntries: { hash1: 'local' },
                    data: { status: 'pending' }
                }),
                createTestRecord({
                    id: 'tool-2',
                    chatId: 'chat-2',
                    data: { status: 'pending' }
                })
            ] as ToolCallRecord[];

            await localDB.putRecords('tool_calls', records);

            const chatOneTools = await localDB.getByIndex<ToolCallRecord>(
                'tool_calls',
                'chatId',
                'chat-1'
            );

            expect(chatOneTools.map((record) => record.id)).toEqual(['tool-1']);
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

            const settings = await localDB.getRecord<DataRecord>('settings', 'same-id');
            const personas = await localDB.getRecord<DataRecord>('personas', 'same-id');

            expect(settings?.updatedAt).toBe(1000);
            expect(personas?.updatedAt).toBe(9999);
        });
    });

    describe('getScopeIdsByType', () => {
        it('should return unique scopeIds for a given scopeType', async () => {
            const records = [
                createTestRecord({ id: 'rec-1', scopeType: 'user', scopeId: 'user-a' }),
                createTestRecord({ id: 'rec-2', scopeType: 'user', scopeId: 'user-b' }),
                createTestRecord({ id: 'rec-3', scopeType: 'user', scopeId: 'user-a' }), // Same scopeId
                createTestRecord({ id: 'rec-4', scopeType: 'room', scopeId: 'room-a' })
            ];
            await localDB.putRecords('characters', records);

            const userIds = await localDB.getScopeIdsByType('characters', 'user');
            expect(userIds).toHaveLength(2);
            expect(userIds).toContain('user-a');
            expect(userIds).toContain('user-b');
            expect(userIds).not.toContain('room-a');
        });
    });

    describe('deleteByScope', () => {
        it('should delete all records for a given scope', async () => {
            const scopeA = { scopeType: 'user' as const, scopeId: 'user-a' };
            const scopeB = { scopeType: 'user' as const, scopeId: 'user-b' };

            const records = [
                createTestRecord({ id: 'rec-1', ...scopeA }),
                createTestRecord({ id: 'rec-2', ...scopeA }),
                createTestRecord({ id: 'rec-3', ...scopeB })
            ];
            await localDB.putRecords('characters', records);

            const count = await localDB.deleteByScope('characters', scopeA);
            expect(count).toBe(2);

            const rec1 = await localDB.getRecord('characters', 'rec-1');
            const rec2 = await localDB.getRecord('characters', 'rec-2');
            const rec3 = await localDB.getRecord('characters', 'rec-3');

            expect(rec1).toBeUndefined();
            expect(rec2).toBeUndefined();
            expect(rec3).toBeDefined();
        });
    });
});
