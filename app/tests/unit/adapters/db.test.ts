/**
 * DB Adapter Tests: web.ts (Dexie)
 *
 * Tests the WebDatabaseAdapter implementation using fake-indexeddb.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fakeIndexedDB, { IDBKeyRange as FDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
    IDatabaseAdapter,
    DataRecord,
    DataScope,
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
import { TauriDatabaseAdapter } from '$lib/adapters/db/tauri';
import { WebMultiAdapter, multiDB } from '$lib/adapters/multi/web';
import { TauriMultiAdapter } from '$lib/adapters/multi/tauri';
import { clock } from '$lib/utils/clock';

const sqlite = vi.hoisted(() => ({
    db: null as import('node:sqlite').DatabaseSync | null,
    path: '',
    beforeExecute: null as ((query: string) => Promise<void>) | null
}));
let sqliteDirectory: string | undefined;

vi.mock('@tauri-apps/plugin-sql', () => ({
    default: {
        load: async () => {
            const { DatabaseSync } = await import('node:sqlite');
            const connection = () => (sqlite.db ??= new DatabaseSync(sqlite.path));
            return {
                execute: async (
                    query: string,
                    values: import('node:sqlite').SQLInputValue[] = []
                ) => {
                    await sqlite.beforeExecute?.(query);
                    const db = connection();
                    if (!values.length) {
                        db.exec(query);
                        return { rowsAffected: 0 };
                    }
                    return {
                        rowsAffected: Number(
                            db
                                .prepare(query)
                                .run(
                                    Object.fromEntries(
                                        values.map((value, i) => [`$${i + 1}`, value])
                                    )
                                ).changes
                        )
                    };
                },
                select: async (query: string, values: import('node:sqlite').SQLInputValue[] = []) =>
                    connection()
                        .prepare(query)
                        .all(Object.fromEntries(values.map((value, i) => [`$${i + 1}`, value])))
            };
        }
    }
}));

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
        sqliteDirectory = mkdtempSync(join(tmpdir(), 'keiai-revisions-'));
        sqlite.path = join(sqliteDirectory, 'local.db');
        // Create a fresh adapter instance for each test
        localDB = new WebDatabaseAdapter();
    });

    afterEach(async () => {
        sqlite.db?.close();
        sqlite.db = null;
        sqlite.path = '';
        sqlite.beforeExecute = null;
        if (sqliteDirectory) rmSync(sqliteDirectory, { recursive: true });
        sqliteDirectory = undefined;
        vi.restoreAllMocks();
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

    describe.each([
        ['Web', WebDatabaseAdapter],
        ['Tauri', TauriDatabaseAdapter]
    ] as const)('%s localUpdatedAt', (_platform, Adapter) => {
        beforeEach(() => {
            localDB = new Adapter();
        });

        it('selects canonical changes by local time even when updatedAt is below the cursor', async () => {
            const old = createTestRecord({ id: 'old', updatedAt: 9000 });
            await localDB.putRecord('settings', old);
            const cursor = await localDB.getLocalUpdatedAt();
            const remote = createTestRecord({ id: 'remote', updatedAt: 100, localUpdatedAt: 1 });
            await localDB.putRecords('settings', [remote], { origin: 'sync' });
            const stored = await localDB.getRecord('settings', remote.id);
            const upper = stored!.localUpdatedAt!;

            expect(stored?.updatedAt).toBe(100);
            expect(upper).toBeGreaterThan(cursor);
            expect(await localDB.getUnsyncedChanges('settings', userScope, cursor, upper)).toEqual([
                stored
            ]);
            expect(
                await localDB.getUnsyncedChanges(
                    'settings',
                    userScope,
                    upper,
                    await localDB.getLocalUpdatedAt()
                )
            ).toEqual([]);
        });

        it('preserves local time on duplicate saves and ignores incoming local time', async () => {
            const record = createTestRecord({
                id: 'duplicate',
                data: { a: 1, b: [2, 3], '\u00e9': 1, 'e\u0301': 2 }
            });
            await localDB.putRecord('settings', record);
            const first = await localDB.getRecord('settings', record.id);
            await localDB.putRecords(
                'settings',
                [
                    {
                        ...record,
                        localUpdatedAt: Number.MAX_SAFE_INTEGER,
                        data: { 'e\u0301': 2, '\u00e9': 1, b: [2, 3], a: 1 }
                    }
                ],
                { origin: 'sync' }
            );
            expect((await localDB.getRecord('settings', record.id))?.localUpdatedAt).toBe(
                first?.localUpdatedAt
            );

            await localDB.putRecord('settings', { ...record, data: { a: 2, b: [2, 3] } });
            expect(
                (await localDB.getRecord('settings', record.id))!.localUpdatedAt
            ).toBeGreaterThan(first!.localUpdatedAt!);
        });

        it('keeps the persisted cursor floor after restart and deletion of the last record', async () => {
            const time = vi.spyOn(clock, 'now').mockReturnValue(100000);
            await localDB.putRecord('settings', createTestRecord({ id: 'before-restart' }));
            const cursor = await localDB.getLocalUpdatedAt();
            await localDB.deleteRecord('settings', 'before-restart');
            if (_platform === 'Tauri') {
                sqlite.db!.close();
                sqlite.db = null;
            } else {
                (localDB as unknown as { db: Dexie }).db.close();
            }
            time.mockReturnValue(10);
            localDB = new Adapter();
            expect(await localDB.getLocalUpdatedAt()).toBe(cursor);
            await localDB.putRecord('characters', createTestRecord({ id: 'after-restart' }));
            const upper = await localDB.getLocalUpdatedAt();
            expect(upper).toBeGreaterThan(cursor);
            expect(
                await localDB.getUnsyncedChanges('characters', userScope, cursor, upper)
            ).toEqual([expect.objectContaining({ id: 'after-restart', localUpdatedAt: upper })]);
        });

        it('does not allocate extra revisions for concurrent or batched duplicates', async () => {
            const record = createTestRecord({ id: 'concurrent' });
            await Promise.all([
                localDB.putRecord('settings', record),
                new Adapter().putRecords('settings', [record, record], { origin: 'sync' })
            ]);
            expect(await localDB.getLocalUpdatedAt()).toBe(1);
            await localDB.putRecords('settings', [{ ...record, data: { changed: true } }, record]);
            expect(await localDB.getLocalUpdatedAt()).toBe(1);
        });

        it('rolls back the record and its revision together when a bulk statement fails', async () => {
            const before = await localDB.getLocalUpdatedAt();
            const valid = createTestRecord({ id: 'valid' });
            const invalid = { ...valid, id: undefined } as unknown as DataRecord;
            // SQLite text primary keys otherwise allow NULL; force a real constraint failure.
            if (_platform === 'Tauri')
                sqlite.db!.exec(
                    `CREATE TRIGGER reject_invalid BEFORE INSERT ON settings WHEN NEW.id IS NULL BEGIN SELECT RAISE(ABORT, 'invalid id'); END`
                );
            await expect(localDB.putRecords('settings', [valid, invalid])).rejects.toThrow();
            expect(await localDB.getRecord('settings', valid.id)).toBeUndefined();
            expect(await localDB.getLocalUpdatedAt()).toBe(before);
        });

        it.each(['index', 'compound'] as const)(
            'never skips a delayed %s delete when Push captures its upper bound',
            async (path) => {
                await localDB.putRecord(
                    'messages',
                    createTestRecord({ id: 'delayed', chatId: 'chat' })
                );
                const cursor = await localDB.getLocalUpdatedAt();
                const entered = Promise.withResolvers<void>();
                const release = Promise.withResolvers<void>();
                if (_platform === 'Tauri') {
                    sqlite.beforeExecute = async (query) => {
                        if (
                            !query.startsWith('UPDATE messages') &&
                            !query.startsWith('INSERT OR REPLACE INTO messages')
                        )
                            return;
                        sqlite.beforeExecute = null;
                        entered.resolve();
                        await release.promise;
                    };
                } else {
                    const table = (localDB as unknown as { db: Dexie }).db.table<
                        DataRecord,
                        string
                    >('messages');
                    const prototype = Object.getPrototypeOf(table) as typeof table;
                    const bulkPut = prototype.bulkPut;
                    vi.spyOn(prototype, 'bulkPut').mockImplementationOnce(function (
                        this: typeof table,
                        ...args
                    ) {
                        entered.resolve();
                        return Dexie.Promise.resolve(Dexie.waitFor(release.promise)).then(() =>
                            bulkPut.apply(this, args)
                        );
                    });
                }
                const deleting =
                    path === 'index'
                        ? localDB.softDeleteByIndex('messages', 'chatId', 'chat')
                        : localDB.softDeleteByCompoundIndex('messages', '[scopeType+scopeId]', [
                              'user',
                              userScope.scopeId
                          ]);
                await entered.promise;
                const scanning = localDB.getLocalUpdatedAt().then(async (upper) => ({
                    upper,
                    records: await localDB.getUnsyncedChanges('messages', userScope, cursor, upper)
                }));
                if (_platform === 'Tauri') await scanning; // SQL write has not started; Push can finish first.
                release.resolve();
                await deleting;
                const { upper, records } = await scanning;
                const stored = (await localDB.getRecord('messages', 'delayed'))!;
                const nextUpper = await localDB.getLocalUpdatedAt();
                expect(stored.isDeleted).toBe(true);
                expect(nextUpper).toBeGreaterThan(cursor);
                expect(stored.localUpdatedAt).toBe(nextUpper);
                if (stored.localUpdatedAt! <= upper) expect(records).toEqual([stored]);
                else
                    expect(
                        await localDB.getUnsyncedChanges('messages', userScope, upper, nextUpper)
                    ).toEqual([stored]);
            }
        );

        it.each(['single', 'index', 'compound'] as const)(
            'stamps %s soft deletes and preserves duplicate deletes',
            async (path) => {
                const record = createTestRecord({ id: 'delete', chatId: 'chat-1' });
                await localDB.putRecord('messages', record);
                const before = await localDB.getRecord('messages', record.id);
                const remove = () =>
                    path === 'single'
                        ? localDB.softDeleteRecord('messages', record.id)
                        : path === 'index'
                          ? localDB.softDeleteByIndex('messages', 'chatId', 'chat-1')
                          : localDB.softDeleteByCompoundIndex('messages', '[scopeType+scopeId]', [
                                'user',
                                userScope.scopeId
                            ]);
                await remove();
                const deleted = await localDB.getRecord('messages', record.id);
                expect(deleted!.localUpdatedAt).toBeGreaterThan(before!.localUpdatedAt!);
                await remove();
                expect((await localDB.getRecord('messages', record.id))?.localUpdatedAt).toBe(
                    deleted?.localUpdatedAt
                );
            }
        );
    });

    describe.each([
        ['Web', WebMultiAdapter],
        ['Tauri', TauriMultiAdapter]
    ] as const)('%s multi_meta localUpdatedAt', (_platform, Adapter) => {
        beforeEach(async () => {
            await multiDB.delete();
            await multiDB.open();
        });

        afterEach(async () => {
            await multiDB.delete();
        });

        it('selects room indexes and memberships by local changes and preserves duplicate receives', async () => {
            const adapter = new Adapter();
            const room = {
                id: 'room',
                ownerUserId: 'owner',
                visibility: 'private' as const,
                createdAt: 1,
                updatedAt: 10
            };
            const member = {
                id: 'member',
                roomId: room.id,
                userId: 'owner',
                status: 'accepted' as const,
                createdAt: 1,
                updatedAt: 10
            };
            const cursor = await adapter.getLocalUpdatedAt();
            await adapter.saveRoomIndexes([room], { origin: 'sync' });
            await adapter.saveMembers([member], { origin: 'sync' });
            const upper = await adapter.getLocalUpdatedAt();
            const storedRoom = await adapter.getRoomIndex(room.id);
            const storedMember = await adapter.getMember(member.id);
            expect(await adapter.getRoomIndexesBetween(cursor, upper)).toEqual([storedRoom]);
            expect(await adapter.getMembersBetween('owner', cursor, upper)).toEqual([storedMember]);
            expect(await adapter.getMembersByRoomsBetween([room.id], cursor, upper)).toEqual([
                storedMember
            ]);

            await adapter.saveRoomIndex(
                { ...room, localUpdatedAt: Number.MAX_SAFE_INTEGER },
                { origin: 'sync' }
            );
            await adapter.saveMember(
                { ...member, localUpdatedAt: Number.MAX_SAFE_INTEGER },
                { origin: 'sync' }
            );
            expect(await adapter.getRoomIndex(room.id)).toEqual(storedRoom);
            expect(await adapter.getMember(member.id)).toEqual(storedMember);
            expect(
                await adapter.getRoomIndexesBetween(upper, await adapter.getLocalUpdatedAt())
            ).toEqual([]);
            expect(
                await adapter.getMembersBetween('owner', upper, await adapter.getLocalUpdatedAt())
            ).toEqual([]);
        });
        it('keeps metadata revisions across adapters, purges, and concurrent duplicate receives', async () => {
            const room = {
                id: 'room',
                ownerUserId: 'owner',
                visibility: 'private' as const,
                createdAt: 1,
                updatedAt: 1
            };
            const adapter = new Adapter();
            await Promise.all([
                adapter.saveRoomIndex(room),
                new Adapter().saveRoomIndexes([room, room], { origin: 'sync' })
            ]);
            const cursor = await adapter.getLocalUpdatedAt();
            expect(cursor).toBe(1);
            await adapter.saveRoomIndexes([{ ...room, publicName: 'temporary' }, room]);
            expect(await adapter.getLocalUpdatedAt()).toBe(cursor);
            await adapter.purgeRoomLocal(room.id);
            const restarted = new Adapter();
            expect(await restarted.getLocalUpdatedAt()).toBe(cursor);
            await restarted.saveMembers([
                {
                    id: 'member',
                    roomId: room.id,
                    userId: 'owner',
                    status: 'accepted',
                    createdAt: 1,
                    updatedAt: 1
                }
            ]);
            const upper = await restarted.getLocalUpdatedAt();
            expect(upper).toBeGreaterThan(cursor);
            expect(await restarted.getMembersByRoomsBetween([room.id], cursor, upper)).toHaveLength(
                1
            );
        });
    });

    describe.each([
        ['Web', WebDatabaseAdapter],
        ['Tauri', TauriDatabaseAdapter]
    ] as const)('%s tombstone GC', (_platform, Adapter) => {
        const roomScope = { scopeType: 'room' as const, scopeId: 'room-1' };
        let wallTime: number;

        beforeEach(() => {
            localDB = new Adapter();
            wallTime = 1_000_000;
            vi.spyOn(Date, 'now').mockImplementation(() => wallTime);
        });

        const tombstone = (id: string, updatedAt = 10, scope: DataScope = userScope) =>
            createTestRecord({ id, ...scope, updatedAt, isDeleted: true, data: {} });

        it('keeps the receipt time on duplicates and restarts it for a newer tombstone version', async () => {
            await localDB.putRecord('settings', createTestRecord({ id: 'r' }));
            expect((await localDB.getRecord('settings', 'r'))?.tombstoneAt).toBeUndefined();

            const deleted = tombstone('r', 10);
            await localDB.putRecord('settings', deleted);
            wallTime = 2_000_000;
            await localDB.putRecords('settings', [{ ...deleted, tombstoneAt: 5 }], {
                origin: 'sync'
            });
            const duplicate = await localDB.getRecord('settings', 'r');
            expect(duplicate?.tombstoneAt).toBe(1_000_000);

            await localDB.putRecords('settings', [{ ...deleted, updatedAt: 20 }], {
                origin: 'sync'
            });
            const newer = await localDB.getRecord('settings', 'r');
            expect(newer).toMatchObject({ updatedAt: 20, tombstoneAt: 2_000_000 });
            expect(newer!.localUpdatedAt).toBeGreaterThan(duplicate!.localUpdatedAt!);
        });

        it('stamps tombstones created by soft deletes', async () => {
            await localDB.putRecord(
                'messages',
                createTestRecord({ id: 'm', chatId: 'chat-1', sortOrder: 'a0' })
            );
            await localDB.softDeleteByCompoundIndex('messages', '[scopeType+scopeId]', [
                'user',
                'user-123'
            ]);
            expect((await localDB.getRecord('messages', 'm'))?.tombstoneAt).toBe(1_000_000);
        });

        it('collects only expired tombstones at or below the bound and raises the watermark first', async () => {
            await localDB.putRecord('settings', tombstone('old'));
            await localDB.putRecord('characters', tombstone('old-2'));
            const oldPosition = await localDB.getLocalUpdatedAt();
            await localDB.putRecord('settings', tombstone('unpushed'));
            await localDB.putRecord('settings', tombstone('other-scope', 10, roomScope));
            wallTime = 1_500_000;
            await localDB.putRecord('settings', tombstone('fresh'));
            await localDB.putRecord('settings', createTestRecord({ id: 'live' }));

            const gcHigh = await localDB.collectTombstones(userScope, {
                receivedThrough: 1_000_000,
                throughLocalUpdatedAt: oldPosition
            });

            expect(gcHigh).toBe(oldPosition);
            expect(await localDB.getSyncGcHigh(userScope)).toBe(oldPosition);
            expect(await localDB.getSyncGcHigh(roomScope)).toBe(0);
            expect(await localDB.getRecord('settings', 'old')).toBeUndefined();
            expect(await localDB.getRecord('characters', 'old-2')).toBeUndefined();
            for (const id of ['unpushed', 'other-scope', 'fresh', 'live']) {
                expect(await localDB.getRecord('settings', id)).toBeDefined();
            }

            // A later collection never lowers the watermark.
            await expect(
                localDB.collectTombstones(userScope, {
                    receivedThrough: 0,
                    throughLocalUpdatedAt: 0
                })
            ).resolves.toBe(oldPosition);
        });

        it('records hard-deleted tombstones as forgotten, but not live records', async () => {
            await localDB.putRecord('chats', createTestRecord({ id: 'live', ...roomScope }));
            expect(await localDB.deleteByScope('chats', roomScope)).toBe(1);
            expect(await localDB.getSyncGcHigh(roomScope)).toBe(0);

            await localDB.putRecord('chats', tombstone('t1', 10, roomScope));
            const position = await localDB.getLocalUpdatedAt();
            await localDB.deleteByIndex('chats', 'scopeId', roomScope.scopeId);
            expect(await localDB.getRecord('chats', 't1')).toBeUndefined();
            expect(await localDB.getSyncGcHigh(roomScope)).toBe(position);

            await localDB.putRecord('settings', tombstone('t2'));
            const userPosition = await localDB.getLocalUpdatedAt();
            await localDB.deleteRecord('settings', 't2');
            expect(await localDB.getSyncGcHigh(userScope)).toBe(userPosition);
        });

        it('adds checkpoints once, after every revision read before, and prunes by age', async () => {
            await localDB.putRecord('settings', createTestRecord({ id: 'r' }));
            const before = await localDB.getLocalUpdatedAt();
            await localDB.addSyncCheckpoints(userScope, [
                { id: 'a', anchor: 0 },
                { id: 'b', anchor: 7 }
            ]);
            const held = await localDB.getSyncCheckpoints(userScope);
            expect(held).toHaveLength(2);
            expect(held.every(({ heldAt }) => heldAt > before)).toBe(true);
            expect(await localDB.getLocalUpdatedAt()).toBeGreaterThanOrEqual(held[0].heldAt);

            wallTime = 3_000_000;
            await localDB.addSyncCheckpoints(userScope, [
                { id: 'b', anchor: 99 },
                { id: 'c', anchor: 3 }
            ]);
            const after = await localDB.getSyncCheckpoints(userScope);
            expect(after.find(({ id }) => id === 'b')).toEqual(held.find(({ id }) => id === 'b'));
            expect(await localDB.getSyncCheckpoints(roomScope)).toEqual([]);

            await localDB.pruneSyncCheckpoints(userScope, 2_000_000);
            expect((await localDB.getSyncCheckpoints(userScope)).map(({ id }) => id)).toEqual([
                'c'
            ]);
        });

        it('keeps the watermark and checkpoints after restart', async () => {
            await localDB.putRecord('settings', tombstone('old'));
            const position = await localDB.getLocalUpdatedAt();
            await localDB.collectTombstones(userScope, {
                receivedThrough: 1_000_000,
                throughLocalUpdatedAt: position
            });
            await localDB.addSyncCheckpoints(userScope, [{ id: 'k', anchor: position }]);
            if (_platform === 'Tauri') {
                sqlite.db!.close();
                sqlite.db = null;
            } else {
                (localDB as unknown as { db: Dexie }).db.close();
            }
            localDB = new Adapter();
            expect(await localDB.getSyncGcHigh(userScope)).toBe(position);
            expect(await localDB.getSyncCheckpoints(userScope)).toEqual([
                expect.objectContaining({ id: 'k', anchor: position })
            ]);
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
