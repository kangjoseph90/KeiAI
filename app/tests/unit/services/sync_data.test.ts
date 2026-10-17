import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import Dexie from 'dexie';
import fakeIndexedDB, { IDBKeyRange } from 'fake-indexeddb';
import { WebDatabaseAdapter } from '$lib/adapters/db/web';
import { clock } from '$lib/utils/clock';
import { encryptBytes, decryptBytes } from '$lib/crypto';
import { DataRecordSyncEngine, DataRecordSyncEngineImpl } from '$lib/services/sync/data';
import { pb } from '$lib/adapters/pb';
import { localDB } from '$lib/adapters/db';
import { syncCursorDB } from '$lib/adapters/sync';
import { getActiveSession, hasActiveSession } from '$lib/services/session';
import type { DataRecord } from '$lib/adapters/db';

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
    send: vi.fn().mockResolvedValue([])
};

// Mock Dependencies
vi.mock('$lib/adapters/pb', () => ({
    pb: {
        baseUrl: 'https://sync.example.test',
        authStore: { isValid: true },
        send: vi.fn(),
        collection: vi.fn(() => mockCollection),
        filter: vi.fn((s) => s),
        createBatch: vi.fn(() => mockBatch)
    }
}));

vi.mock('$lib/adapters/db', () => ({
    SYNC_TABLES: ['characters', 'chats'],
    TABLES: ['characters', 'chats'],
    localDB: {
        getRecord: vi.fn(),
        putRecord: vi.fn(),
        putRecords: vi.fn(),
        getLocalUpdatedAt: vi.fn().mockResolvedValue(2500),
        getUnsyncedChanges: vi.fn(),
        transaction: vi.fn(async (_tables, _mode, callback) => callback()),
        subscribeWriteEvents: vi.fn(() => () => {}),
        getSyncGcHigh: vi.fn(),
        collectTombstones: vi.fn(),
        getSyncCheckpoints: vi.fn(),
        addSyncCheckpoints: vi.fn(),
        pruneSyncCheckpoints: vi.fn(),
        getSyncScopeState: vi.fn(),
        setSyncScopeState: vi.fn(),
        hasScopeRecords: vi.fn(),
        resetSyncScope: vi.fn(),
        adoptSyncState: vi.fn()
    }
}));

/** Both replicas descend from this lineage unless a test says otherwise. */
const LINEAGE = 'lineage-1';

/** A server that has never garbage-collected: every merge is trivially safe. */
function serveSync(path: string, options?: { body?: Record<string, unknown> }): unknown {
    if (path === '/api/now') return { now: 3000 };
    if (path === '/api/sync/handshake') {
        return {
            gcHigh: 0,
            coverage: options?.body?.pullCursor ?? 0,
            known: [],
            lineage: LINEAGE,
            initializing: null,
            hasRecords: true
        };
    }
    if (path === '/api/sync/commit') return { checkpoints: [] };
    throw new Error(`Unexpected request ${path}`);
}

/** Push options carry the server-side coverage proof. */
const coverageHeader = {
    headers: { 'X-Kei-Sync-Coverage': expect.any(String), 'X-Kei-Sync-Lineage': LINEAGE }
};

vi.mock('$lib/adapters/sync', () => ({
    syncCursorDB: {
        get: vi.fn(),
        advance: vi.fn(),
        delete: vi.fn(),
        deleteByStream: vi.fn(),
        deleteByUser: vi.fn()
    }
}));

vi.mock('$lib/services/session', () => ({
    getActiveSession: vi.fn(),
    hasActiveSession: vi.fn(),
    getSessionScope: vi.fn((scopeType: 'user' | 'room') => {
        if (scopeType === 'user') return { scopeType: 'user', scopeId: 'user-123' };
        return { scopeType: 'room', scopeId: 'room-123' };
    })
}));

vi.mock('$lib/crypto', () => ({
    toBase64: vi.fn((b) => 'base64-' + b),
    fromBase64: vi.fn(() => new Uint8Array([1, 2, 3])),
    encryptBytes: vi.fn(() => ({ ciphertext: new Uint8Array(), iv: new Uint8Array() })),
    decryptBytes: vi.fn(() => Promise.resolve(deflateSync(strToU8('{}'))))
}));

vi.mock('$lib/utils/clock', async (importOriginal) => {
    const actual = await importOriginal<typeof import('$lib/utils/clock')>();
    vi.spyOn(actual.clock, 'now').mockReturnValue(2500);
    vi.spyOn(actual.clock, 'observe').mockImplementation(() => {});
    return actual;
});

Dexie.dependencies.indexedDB = fakeIndexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

describe('DataRecordSyncEngine', () => {
    const mockUserId = 'user-123';
    const mockRoomId = 'room-123';
    const makeRecord = (id: string, updatedAt = 1000): DataRecord => ({
        id,
        scopeType: 'user',
        scopeId: mockUserId,
        createdAt: 1000,
        updatedAt,
        isDeleted: false,
        data: {}
    });

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(clock.now).mockReturnValue(2500);
        vi.mocked(getActiveSession).mockReturnValue({
            userId: mockUserId,
            masterKey: {} as CryptoKey,
            identityKeyPair: {} as CryptoKeyPair
        });
        vi.mocked(hasActiveSession).mockReturnValue(true);
        vi.mocked(syncCursorDB.get).mockResolvedValue({
            serverPullCursor: 0,
            localPushCursor: 0
        });
        (pb.authStore as unknown as { isValid: boolean }).isValid = true;

        vi.mocked(mockCollection.subscribe).mockResolvedValue(() => {});
        vi.mocked(mockCollection.unsubscribe).mockResolvedValue(() => {});
        vi.mocked(localDB.getUnsyncedChanges).mockResolvedValue([]);
        vi.mocked(pb.send).mockImplementation(async (path, options) =>
            serveSync(path, options as { body?: Record<string, unknown> })
        );
        vi.mocked(localDB.getSyncGcHigh).mockResolvedValue(0);
        vi.mocked(localDB.collectTombstones).mockResolvedValue(0);
        vi.mocked(localDB.getSyncCheckpoints).mockResolvedValue([]);
        vi.mocked(localDB.getSyncScopeState).mockResolvedValue({
            lineage: LINEAGE,
            adopting: null,
            bootstrapping: null
        });
        vi.mocked(localDB.hasScopeRecords).mockResolvedValue(true);
        DataRecordSyncEngine.stop();
    });

    /** Verify the active scopes through one full session, then forget its calls. */
    async function verifySession(engine: DataRecordSyncEngineImpl = DataRecordSyncEngine) {
        const getList = vi.mocked(mockCollection.getList);
        const previous = getList.getMockImplementation();
        getList.mockResolvedValue({ items: [], page: 1, totalPages: 1 } as never);
        await engine.trigger();
        if (previous) getList.mockImplementation(previous);
        vi.mocked(pb.send).mockClear();
        vi.mocked(localDB.getRecord).mockClear();
        vi.mocked(localDB.putRecord).mockClear();
        vi.mocked(localDB.putRecords).mockClear();
        vi.mocked(localDB.transaction).mockClear();
        vi.mocked(syncCursorDB.advance).mockClear();
        mockBatch.send.mockClear();
        mockBatchCollection.upsert.mockClear();
    }

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('Realtime Subscription', () => {
        it('should subscribe to all sync tables', async () => {
            await DataRecordSyncEngine.subscribeRealtime();
            expect(mockCollection.subscribe).toHaveBeenCalled();
        });

        it('should record error status instead of throwing when the server is unreachable', async () => {
            vi.mocked(mockCollection.subscribe).mockRejectedValue(new Error('ECONNREFUSED'));

            await expect(DataRecordSyncEngine.subscribeRealtime()).resolves.toBeUndefined();

            expect(DataRecordSyncEngine.isSubscribed).toBe(false);
            expect(DataRecordSyncEngine.getState().state).toBe('network_error');
        });

        it('should handle unsubscribe', async () => {
            (DataRecordSyncEngine as unknown as { subscribed: boolean }).subscribed = true;
            await DataRecordSyncEngine.unsubscribeRealtime();
            expect(mockCollection.unsubscribe).toHaveBeenCalled();
            expect(DataRecordSyncEngine.isSubscribed).toBe(false);
        });
    });

    describe('Pull Logic (trigger)', () => {
        it('should pull changes and handle LWW conflict', async () => {
            const tableName = 'characters';
            vi.mocked(syncCursorDB.get).mockResolvedValue({
                serverPullCursor: 1000,
                localPushCursor: 1000
            });

            const serverRecord = {
                id: 'rec-1',
                kind: tableName,
                userId: mockUserId,
                updatedAt: 2000,
                updated: '2000',
                encryptedData: 'base64-data',
                encryptedDataIV: 'base64-iv'
            };

            vi.mocked(mockCollection.getList).mockResolvedValue({
                items: [serverRecord],
                page: 1,
                totalPages: 1
            } as unknown as { items: unknown[]; page: number; totalPages: number });

            vi.mocked(localDB.getRecord).mockResolvedValue({
                id: 'rec-1',
                updatedAt: 1500
            } as DataRecord);

            await DataRecordSyncEngine.trigger();

            expect(localDB.putRecords).toHaveBeenCalledWith(
                tableName,
                [
                    expect.objectContaining({
                        id: 'rec-1',
                        updatedAt: 2000
                    })
                ],
                expect.objectContaining({ origin: 'sync' })
            );
        });

        it('should push correction if local is newer', async () => {
            vi.mocked(syncCursorDB.get).mockResolvedValue({
                serverPullCursor: 1000,
                localPushCursor: 1000
            });
            const serverRecord = {
                id: 'rec-1',
                kind: 'characters',
                userId: mockUserId,
                updatedAt: 1000,
                updated: '1000',
                encryptedData: 'base64-d',
                encryptedDataIV: 'base64-iv'
            };
            const localRecord = makeRecord('rec-1', 2000);

            vi.mocked(mockCollection.getList).mockResolvedValue({
                items: [serverRecord],
                page: 1,
                totalPages: 1
            } as unknown as { items: unknown[]; page: number; totalPages: number });
            vi.mocked(localDB.getRecord).mockResolvedValue(localRecord);

            await DataRecordSyncEngine.trigger();

            expect(mockBatchCollection.upsert).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'rec-1' }),
                coverageHeader
            );
            expect(mockBatch.send).toHaveBeenCalled();
        });

        it('should keep both cursors unchanged when a pull correction push fails', async () => {
            vi.mocked(syncCursorDB.get).mockResolvedValue({
                serverPullCursor: 1000,
                localPushCursor: 1000
            });
            const serverRecord = {
                id: 'rec-1',
                kind: 'characters',
                userId: mockUserId,
                updatedAt: 1000,
                updated: '1000',
                encryptedData: 'base64-d',
                encryptedDataIV: 'base64-iv'
            };
            const localRecord = makeRecord('rec-1', 2000);

            vi.mocked(mockCollection.getList)
                .mockResolvedValueOnce({
                    items: [serverRecord],
                    page: 1,
                    totalPages: 1
                } as unknown as { items: unknown[]; page: number; totalPages: number })
                .mockResolvedValue({
                    items: [],
                    page: 1,
                    totalPages: 1
                } as unknown as { items: unknown[]; page: number; totalPages: number });

            vi.mocked(localDB.getRecord).mockResolvedValue(localRecord);
            vi.mocked(mockBatch.send).mockRejectedValueOnce(new Error('batch failed'));

            await DataRecordSyncEngine.trigger();

            expect(syncCursorDB.advance).not.toHaveBeenCalled();
            expect(DataRecordSyncEngine.getState().state).toBe('network_error');
        });

        it('pulls a late server arrival even when its logical timestamp is behind the cursor', async () => {
            vi.mocked(syncCursorDB.get).mockResolvedValue({
                serverPullCursor: 2000,
                localPushCursor: 1000
            });
            vi.mocked(mockCollection.getList).mockResolvedValue({
                items: [
                    {
                        id: 'late-record',
                        kind: 'characters',
                        userId: mockUserId,
                        updatedAt: 1500,
                        serverUpdatedAt: 2500,
                        encryptedData: 'base64-data',
                        encryptedDataIV: 'base64-iv'
                    }
                ],
                page: 1,
                totalPages: 1
            } as unknown as { items: unknown[]; page: number; totalPages: number });
            vi.mocked(localDB.getRecord).mockResolvedValue(undefined);

            await DataRecordSyncEngine.trigger();

            expect(pb.filter).toHaveBeenCalledWith(
                'userId = {:scopeId} && serverUpdatedAt > {:after} && serverUpdatedAt <= {:through}',
                { scopeId: mockUserId, after: 2000, through: 3000 }
            );
            expect(localDB.putRecords).toHaveBeenCalledWith(
                'characters',
                [expect.objectContaining({ id: 'late-record', updatedAt: 1500 })],
                { origin: 'sync' }
            );
        });

        it('should pull active room scope from multi_room_records', async () => {
            vi.mocked(getActiveSession).mockReturnValue({
                userId: mockUserId,
                masterKey: {} as CryptoKey,
                identityKeyPair: {} as CryptoKeyPair,
                roomId: mockRoomId,
                roomKey: { type: 'room-key' } as unknown as CryptoKey
            });
            vi.mocked(syncCursorDB.get).mockResolvedValue({
                serverPullCursor: 1000,
                localPushCursor: 1000
            });
            vi.mocked(mockCollection.getList)
                .mockResolvedValueOnce({
                    items: [],
                    page: 1,
                    totalPages: 1
                } as unknown as { items: unknown[]; page: number; totalPages: number })
                .mockResolvedValueOnce({
                    items: [
                        {
                            id: 'room-rec-1',
                            kind: 'chats',
                            roomId: mockRoomId,
                            updatedAt: 2000,
                            updated: '2000',
                            encryptedData: 'base64-data',
                            encryptedDataIV: 'base64-iv'
                        }
                    ],
                    page: 1,
                    totalPages: 1
                } as unknown as { items: unknown[]; page: number; totalPages: number });
            vi.mocked(localDB.getRecord).mockResolvedValue(undefined);

            await DataRecordSyncEngine.trigger();

            expect(pb.collection).toHaveBeenCalledWith('records');
            expect(pb.collection).toHaveBeenCalledWith('multi_room_records');
            expect(localDB.putRecords).toHaveBeenCalledWith(
                'chats',
                [
                    expect.objectContaining({
                        id: 'room-rec-1',
                        scopeType: 'room',
                        scopeId: mockRoomId
                    })
                ],
                expect.objectContaining({ origin: 'sync' })
            );
        });
    });

    describe('Local write buffer', () => {
        it('coalesces local write events and pushes latest records using upsert batch', async () => {
            await verifySession();
            vi.useFakeTimers();
            const record = makeRecord('existing-1');
            vi.mocked(localDB.getRecord).mockResolvedValue(record);

            DataRecordSyncEngine.handleLocalWrite({
                tableName: 'characters',
                operation: 'put',
                ids: ['existing-1'],
                origin: 'local'
            });
            DataRecordSyncEngine.handleLocalWrite({
                tableName: 'characters',
                operation: 'put',
                ids: ['existing-1'],
                origin: 'local'
            });

            await vi.advanceTimersByTimeAsync(3_000);

            expect(localDB.getRecord).toHaveBeenCalledTimes(1);
            expect(mockBatchCollection.upsert).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'existing-1' }),
                coverageHeader
            );
            expect(mockBatch.send).toHaveBeenCalled();
        });

        it('keeps the network error state when a buffered push fails', async () => {
            await verifySession();
            vi.useFakeTimers();
            vi.mocked(localDB.getRecord).mockResolvedValue(makeRecord('existing-1'));
            mockBatch.send.mockRejectedValueOnce(new Error('network down'));

            DataRecordSyncEngine.handleLocalWrite({
                tableName: 'characters',
                operation: 'put',
                ids: ['existing-1'],
                origin: 'local'
            });

            await vi.advanceTimersByTimeAsync(3_000);

            expect(DataRecordSyncEngine.getState().state).toBe('network_error');
        });
    });

    describe('Delete-wins merge', () => {
        const makeDeletedRecord = (id: string, updatedAt = 1000): DataRecord => ({
            id,
            scopeType: 'user',
            scopeId: mockUserId,
            createdAt: 1000,
            updatedAt,
            isDeleted: true,
            data: {}
        });

        it('remote deleted beats local live regardless of timestamp', async () => {
            const tableName = 'characters';
            vi.mocked(syncCursorDB.get).mockResolvedValue({
                serverPullCursor: 500,
                localPushCursor: 500
            });

            const serverRecord = {
                id: 'rec-1',
                kind: tableName,
                userId: mockUserId,
                updatedAt: 1000,
                updated: '1000',
                isDeleted: true,
                encryptedData: 'base64-data',
                encryptedDataIV: 'base64-iv'
            };

            vi.mocked(mockCollection.getList).mockResolvedValue({
                items: [serverRecord],
                page: 1,
                totalPages: 1
            } as unknown as { items: unknown[]; page: number; totalPages: number });

            // Local has live record with NEWER timestamp
            vi.mocked(localDB.getRecord).mockResolvedValue({
                ...makeRecord('rec-1', 2000),
                isDeleted: false
            });

            await DataRecordSyncEngine.trigger();

            // Remote deleted wins ??local should be soft-deleted
            expect(localDB.putRecords).toHaveBeenCalledWith(
                tableName,
                [expect.objectContaining({ id: 'rec-1', isDeleted: true })],
                expect.objectContaining({ origin: 'sync' })
            );
            // No repair push for this record
            expect(mockBatchCollection.upsert).not.toHaveBeenCalledWith(
                expect.objectContaining({ id: 'rec-1' }),
                coverageHeader
            );
        });

        it('local deleted beats remote live ??queues repair push', async () => {
            const tableName = 'characters';
            vi.mocked(syncCursorDB.get).mockResolvedValue({
                serverPullCursor: 500,
                localPushCursor: 500
            });

            const serverRecord = {
                id: 'rec-1',
                kind: tableName,
                userId: mockUserId,
                updatedAt: 2000,
                updated: '2000',
                isDeleted: false,
                encryptedData: 'base64-data',
                encryptedDataIV: 'base64-iv'
            };

            vi.mocked(mockCollection.getList).mockResolvedValue({
                items: [serverRecord],
                page: 1,
                totalPages: 1
            } as unknown as { items: unknown[]; page: number; totalPages: number });

            // Local has deleted record with OLDER timestamp
            vi.mocked(localDB.getRecord).mockResolvedValue(makeDeletedRecord('rec-1', 1000));

            await DataRecordSyncEngine.trigger();

            // Local deleted wins ??should NOT overwrite local with remote
            expect(localDB.putRecords).not.toHaveBeenCalled();
            // Should queue repair push
            expect(mockBatchCollection.upsert).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'rec-1', isDeleted: true }),
                coverageHeader
            );
        });

        it('preserves a pulled tombstone with no local counterpart', async () => {
            const tableName = 'characters';
            vi.mocked(syncCursorDB.get).mockResolvedValue({
                serverPullCursor: 500,
                localPushCursor: 500
            });

            const serverRecord = {
                id: 'rec-1',
                kind: tableName,
                userId: mockUserId,
                updatedAt: 1000,
                updated: '1000',
                isDeleted: true,
                encryptedData: 'base64-data',
                encryptedDataIV: 'base64-iv'
            };

            vi.mocked(mockCollection.getList).mockResolvedValue({
                items: [serverRecord],
                page: 1,
                totalPages: 1
            } as unknown as { items: unknown[]; page: number; totalPages: number });

            // No local record
            vi.mocked(localDB.getRecord).mockResolvedValue(undefined);

            await DataRecordSyncEngine.trigger();

            expect(localDB.putRecords).toHaveBeenCalledWith(
                tableName,
                [
                    expect.objectContaining({
                        id: 'rec-1',
                        scopeType: 'user',
                        scopeId: mockUserId,
                        isDeleted: true,
                        updatedAt: 1000
                    })
                ],
                { origin: 'sync' }
            );
        });

        it('both deleted uses LWW', async () => {
            const tableName = 'characters';
            vi.mocked(syncCursorDB.get).mockResolvedValue({
                serverPullCursor: 500,
                localPushCursor: 500
            });

            const serverRecord = {
                id: 'rec-1',
                kind: tableName,
                userId: mockUserId,
                updatedAt: 2000,
                updated: '2000',
                isDeleted: true,
                encryptedData: 'base64-data',
                encryptedDataIV: 'base64-iv'
            };

            vi.mocked(mockCollection.getList).mockResolvedValue({
                items: [serverRecord],
                page: 1,
                totalPages: 1
            } as unknown as { items: unknown[]; page: number; totalPages: number });

            // Local also deleted but older
            vi.mocked(localDB.getRecord).mockResolvedValue(makeDeletedRecord('rec-1', 1000));

            await DataRecordSyncEngine.trigger();

            // Both deleted, remote newer ??LWW applies
            expect(localDB.putRecords).toHaveBeenCalledWith(
                tableName,
                [expect.objectContaining({ id: 'rec-1', isDeleted: true, updatedAt: 2000 })],
                expect.objectContaining({ origin: 'sync' })
            );
        });

        it('push response handles server-enforced delete', async () => {
            const tableName = 'characters';
            vi.mocked(syncCursorDB.get).mockResolvedValue({
                serverPullCursor: 500,
                localPushCursor: 500
            });
            vi.mocked(mockCollection.getList).mockResolvedValue({
                items: [],
                page: 1,
                totalPages: 1
            } as unknown as { items: unknown[]; page: number; totalPages: number });

            // Local has an unsynced live record
            const liveRecord = makeRecord('rec-1', 2000);
            vi.mocked(localDB.getUnsyncedChanges).mockResolvedValue([liveRecord]);
            vi.mocked(localDB.getRecord).mockResolvedValue(liveRecord);

            // Server returns deleted in batch response
            vi.mocked(mockBatch.send).mockResolvedValue([
                {
                    status: 200,
                    body: {
                        id: 'rec-1',
                        kind: tableName,
                        userId: mockUserId,
                        isDeleted: true,
                        updatedAt: 2500,
                        updated: '2500',
                        encryptedData: 'base64-data',
                        encryptedDataIV: 'base64-iv'
                    }
                }
            ]);

            await DataRecordSyncEngine.trigger();

            // Should apply server-enforced delete locally
            expect(localDB.putRecord).toHaveBeenCalledWith(
                tableName,
                expect.objectContaining({ id: 'rec-1', isDeleted: true }),
                expect.objectContaining({ origin: 'sync' })
            );
        });
    });
    describe('merge safety', () => {
        const serverRecord = (id: string, isDeleted = false) => ({
            id,
            kind: 'characters',
            userId: mockUserId,
            updatedAt: 2000,
            updated: '2000',
            isDeleted,
            encryptedData: 'base64-data',
            encryptedDataIV: 'base64-iv'
        });
        const page = (items: unknown[]) =>
            ({ items, page: 1, totalPages: 1 }) as unknown as {
                items: unknown[];
                page: number;
                totalPages: number;
            };
        const sent = (path: string) =>
            vi
                .mocked(pb.send)
                .mock.calls.filter(([p]) => p === path)
                .map(([, options]) => (options as { body: Record<string, unknown> }).body);
        const serve = (overrides: Record<string, unknown>) =>
            vi.mocked(pb.send).mockImplementation(async (path, options) => {
                const value = overrides[path];
                if (typeof value === 'function') return value(options);
                if (value instanceof Error) throw value;
                return value ?? serveSync(path, options as { body?: Record<string, unknown> });
            });

        beforeEach(() => {
            vi.mocked(syncCursorDB.get).mockResolvedValue({
                serverPullCursor: 1000,
                localPushCursor: 1000
            });
            vi.mocked(mockCollection.getList).mockResolvedValue(page([]));
            vi.mocked(mockBatch.send).mockResolvedValue([]);
        });

        it('refuses before any Pull or Push when the server forgot an uncovered deletion', async () => {
            vi.mocked(localDB.getSyncCheckpoints).mockResolvedValue([
                { id: 'unknown-to-server', anchor: 900, heldAt: 900, createdAt: Date.now() }
            ]);
            serve({
                '/api/sync/handshake': {
                    gcHigh: 1500,
                    coverage: 1000,
                    known: [],
                    lineage: LINEAGE,
                    initializing: null,
                    hasRecords: true
                }
            });
            vi.mocked(localDB.getUnsyncedChanges).mockResolvedValue([makeRecord('local', 2000)]);

            await DataRecordSyncEngine.trigger();

            expect(mockCollection.getList).not.toHaveBeenCalled();
            expect(mockBatch.send).not.toHaveBeenCalled();
            expect(syncCursorDB.advance).not.toHaveBeenCalled();
            expect(DataRecordSyncEngine.getState().state).toBe('unsafe_merge');
        });

        it('reports initialization when a never-synced device holds data and the server another replica', async () => {
            vi.mocked(localDB.getSyncScopeState).mockResolvedValue({
                lineage: null,
                adopting: null,
                bootstrapping: null
            });
            serve({
                '/api/sync/handshake': {
                    gcHigh: 0,
                    coverage: 1000,
                    known: [],
                    lineage: 'other-lineage',
                    initializing: null,
                    hasRecords: true
                }
            });
            const conflicts: unknown[][] = [];
            const unsubscribe = DataRecordSyncEngine.subscribeConflicts((list) =>
                conflicts.push(list)
            );

            await DataRecordSyncEngine.trigger();
            unsubscribe();

            expect(mockCollection.getList).not.toHaveBeenCalled();
            expect(mockBatch.send).not.toHaveBeenCalled();
            expect(DataRecordSyncEngine.getState().state).toBe('init_required');
            expect(conflicts.at(-1)).toEqual([
                expect.objectContaining({ kind: 'init', serverLineage: 'other-lineage' })
            ]);
        });

        it('proves local deletions through a checkpoint the server holds', async () => {
            vi.mocked(localDB.getSyncGcHigh).mockResolvedValue(1500);
            vi.mocked(localDB.getSyncCheckpoints).mockResolvedValue([
                { id: 'k', anchor: 1600, heldAt: 1700, createdAt: Date.now() }
            ]);
            serve({
                '/api/sync/handshake': {
                    gcHigh: 0,
                    coverage: 1000,
                    known: ['k'],
                    lineage: LINEAGE,
                    initializing: null,
                    hasRecords: true
                }
            });

            await DataRecordSyncEngine.trigger();

            expect(mockCollection.getList).toHaveBeenCalled();
            expect(DataRecordSyncEngine.getState().state).toBe('idle');
        });

        it('keeps the Pull cursor when the commit end-check fails', async () => {
            const refusal = Object.assign(new Error('conflict'), {
                status: 409,
                response: { code: 'sync_unsafe' }
            });
            serve({ '/api/sync/commit': refusal });

            await DataRecordSyncEngine.trigger();

            expect(syncCursorDB.advance).toHaveBeenCalledWith(expect.anything(), {
                serverPullCursor: undefined,
                localPushCursor: 2500
            });
            expect(DataRecordSyncEngine.getState().state).toBe('unsafe_merge');
        });

        it('refuses an unknown live record once GC outruns the session coverage', async () => {
            vi.mocked(localDB.getSyncGcHigh).mockResolvedValueOnce(0).mockResolvedValue(1200);
            vi.mocked(mockCollection.getList).mockResolvedValue(page([serverRecord('new')]));
            vi.mocked(localDB.getRecord).mockResolvedValue(undefined);

            await DataRecordSyncEngine.trigger();

            expect(localDB.putRecords).not.toHaveBeenCalled();
            expect(syncCursorDB.advance).not.toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ serverPullCursor: expect.any(Number) })
            );
            expect(DataRecordSyncEngine.getState().state).toBe('unsafe_merge');
        });

        it('still accepts unknown tombstones while uncovered', async () => {
            vi.mocked(localDB.getSyncGcHigh).mockResolvedValueOnce(0).mockResolvedValue(1200);
            vi.mocked(mockCollection.getList).mockResolvedValue(page([serverRecord('gone', true)]));
            vi.mocked(localDB.getRecord).mockResolvedValue(undefined);

            await DataRecordSyncEngine.trigger();

            expect(localDB.putRecords).toHaveBeenCalledWith(
                'characters',
                [expect.objectContaining({ id: 'gone', isDeleted: true })],
                { origin: 'sync' }
            );
        });

        it('pushes with the server coverage proven by the handshake', async () => {
            serve({
                '/api/sync/handshake': {
                    gcHigh: 0,
                    coverage: 1700,
                    known: [],
                    lineage: LINEAGE,
                    initializing: null,
                    hasRecords: true
                }
            });
            vi.mocked(localDB.getUnsyncedChanges).mockResolvedValue([makeRecord('local', 2000)]);

            await DataRecordSyncEngine.trigger();

            expect(mockBatchCollection.upsert).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'local' }),
                { headers: { 'X-Kei-Sync-Coverage': '1700', 'X-Kei-Sync-Lineage': LINEAGE } }
            );
        });

        it('confirms own pushes, issues and exchanges checkpoints, then collects pushed tombstones', async () => {
            let now = 3000;
            serve({
                '/api/now': () => ({ now: now++ === 3000 ? 3000 : 3500 }),
                '/api/sync/commit': { checkpoints: ['server-held'] }
            });
            const old = Date.now() - 2 * 24 * 60 * 60 * 1000;
            vi.mocked(localDB.getSyncCheckpoints).mockResolvedValue([
                { id: 'sent-before', anchor: 0, heldAt: 900, createdAt: old },
                { id: 'to-send', anchor: 0, heldAt: 2000, createdAt: old }
            ]);
            vi.mocked(localDB.getUnsyncedChanges).mockResolvedValue([makeRecord('local', 2000)]);

            await DataRecordSyncEngine.trigger();

            const [commit] = sent('/api/sync/commit');
            expect(commit).toMatchObject({
                scopeType: 'user',
                scopeId: mockUserId,
                pullCursor: 1000,
                serverUpper: 3500,
                checkpoints: ['to-send', 'sent-before'],
                inherit: ['to-send'],
                checkpoint: expect.any(String)
            });
            expect(localDB.addSyncCheckpoints).toHaveBeenCalledWith(
                { scopeType: 'user', scopeId: mockUserId },
                [
                    { id: 'server-held', anchor: 0 },
                    { id: commit.checkpoint, anchor: 2500 }
                ]
            );
            expect(syncCursorDB.advance).toHaveBeenCalledWith(expect.anything(), {
                serverPullCursor: 3500,
                localPushCursor: 2500
            });
            expect(localDB.collectTombstones).toHaveBeenCalledWith(
                { scopeType: 'user', scopeId: mockUserId },
                {
                    receivedThrough: expect.any(Number),
                    throughLocalUpdatedAt: 2500
                }
            );
            const [[, { receivedThrough }]] = vi.mocked(localDB.collectTombstones).mock.calls;
            expect(Date.now() - receivedThrough).toBeGreaterThanOrEqual(30 * 24 * 60 * 60 * 1000);
        });

        it('neither issues a checkpoint nor collects tombstones when the Push fails', async () => {
            vi.mocked(localDB.getUnsyncedChanges).mockResolvedValue([makeRecord('local', 2000)]);
            vi.mocked(mockBatch.send).mockRejectedValueOnce(new Error('offline'));

            await DataRecordSyncEngine.trigger();

            expect(sent('/api/sync/commit')[0]).toMatchObject({
                inherit: [],
                checkpoint: undefined
            });
            expect(localDB.collectTombstones).not.toHaveBeenCalled();
        });

        it('reports a server refusal of an unproven create as an unsafe merge', async () => {
            vi.mocked(localDB.getUnsyncedChanges).mockResolvedValue([makeRecord('local', 2000)]);
            vi.mocked(mockBatch.send).mockRejectedValueOnce(
                Object.assign(new Error('Batch transaction failed.'), {
                    status: 400,
                    response: {
                        data: {
                            requests: {
                                0: {
                                    response: { message: 'Merge is not proven safe (Sync_unsafe).' }
                                }
                            }
                        }
                    }
                })
            );

            await DataRecordSyncEngine.trigger();

            expect(DataRecordSyncEngine.getState().state).toBe('unsafe_merge');
        });
    });

    describe('Realtime and buffered Push safety gate', () => {
        const serverRecord = (id: string, isDeleted = false, updatedAt = 2000) => ({
            id,
            kind: 'characters',
            userId: mockUserId,
            updatedAt,
            updated: String(updatedAt),
            isDeleted,
            encryptedData: 'base64-data',
            encryptedDataIV: 'base64-iv'
        });
        const handshakes = () =>
            vi.mocked(pb.send).mock.calls.filter(([path]) => path === '/api/sync/handshake').length;
        const refuseHandshake = () =>
            vi.mocked(pb.send).mockImplementation(async (path, options) =>
                path === '/api/sync/handshake'
                    ? {
                          gcHigh: 1500,
                          coverage: 1000,
                          known: [],
                          lineage: LINEAGE,
                          initializing: null,
                          hasRecords: true
                      }
                    : serveSync(path, options as { body?: Record<string, unknown> })
            );
        const localWrite = (engine: DataRecordSyncEngineImpl, id: string) =>
            engine.handleLocalWrite({
                tableName: 'characters',
                operation: 'put',
                ids: [id],
                origin: 'local'
            });
        const makeDeletedRecordFor = (id: string): DataRecord => ({
            ...makeRecord(id, 3000),
            isDeleted: true
        });
        /** Let the buffered write flush interval elapse. */
        const flushBuffer = () => vi.advanceTimersByTimeAsync(3_100);
        let engine: DataRecordSyncEngineImpl;
        let deliver: (event: unknown) => void;

        beforeEach(async () => {
            engine = new DataRecordSyncEngineImpl();
            vi.mocked(syncCursorDB.get).mockResolvedValue({
                serverPullCursor: 1000,
                localPushCursor: 1000
            });
            vi.mocked(mockCollection.getList).mockResolvedValue({
                items: [],
                page: 1,
                totalPages: 1
            } as never);
            vi.mocked(mockBatch.send).mockResolvedValue([]);
            vi.mocked(localDB.getSyncCheckpoints).mockResolvedValue([
                { id: 'held', anchor: 900, heldAt: 900, createdAt: Date.now() }
            ]);
            await engine.subscribeRealtime();
            deliver = mockCollection.subscribe.mock.calls.at(-1)![1] as (event: unknown) => void;
        });

        afterEach(async () => {
            await engine.unsubscribeRealtime();
            pb.baseUrl = 'https://sync.example.test';
        });

        it('merges nothing from an unverified scope and recovers the event through a verified Pull', async () => {
            vi.mocked(localDB.getRecord).mockResolvedValue(undefined);
            vi.mocked(mockCollection.getList).mockResolvedValue({
                items: [serverRecord('late')],
                page: 1,
                totalPages: 1
            } as never);

            deliver({ action: 'create', record: serverRecord('late') });

            await vi.waitFor(() =>
                expect(localDB.putRecords).toHaveBeenCalledWith(
                    'characters',
                    [expect.objectContaining({ id: 'late' })],
                    { origin: 'sync' }
                )
            );
            expect(localDB.putRecord).not.toHaveBeenCalled();
            expect(handshakes()).toBe(1);
        });

        it('applies realtime events on a verified scope as before', async () => {
            await verifySession(engine);
            vi.mocked(localDB.getRecord).mockResolvedValueOnce(undefined);
            deliver({ action: 'create', record: serverRecord('new') });
            await vi.waitFor(() =>
                expect(localDB.putRecord).toHaveBeenCalledWith(
                    'characters',
                    expect.objectContaining({ id: 'new' }),
                    { origin: 'sync' }
                )
            );

            vi.mocked(localDB.getRecord).mockResolvedValue(makeRecord('known', 1000));
            deliver({ action: 'update', record: serverRecord('known') });
            await vi.waitFor(() =>
                expect(localDB.putRecord).toHaveBeenCalledWith(
                    'characters',
                    expect.objectContaining({ id: 'known', updatedAt: 2000 }),
                    { origin: 'sync' }
                )
            );
            expect(handshakes()).toBe(0);
        });

        it('refuses a realtime event from a replaced lineage and re-verifies', async () => {
            await verifySession(engine);
            vi.mocked(localDB.getRecord).mockResolvedValue(makeRecord('known', 1000));

            deliver({
                action: 'update',
                record: { ...serverRecord('known'), lineage: 'replaced-lineage' }
            });

            await vi.waitFor(() => expect(handshakes()).toBe(1));
            expect(localDB.putRecord).not.toHaveBeenCalled();
        });

        it('refuses an unknown live realtime record once local GC outruns coverage, and re-verifies', async () => {
            await verifySession(engine);
            // The session proved local coverage through its Push bound (2500).
            vi.mocked(localDB.getSyncGcHigh).mockResolvedValue(2600);
            vi.mocked(localDB.getRecord).mockResolvedValue(undefined);

            deliver({ action: 'create', record: serverRecord('resurrected') });

            await vi.waitFor(() => expect(handshakes()).toBe(1));
            expect(localDB.putRecord).not.toHaveBeenCalled();
        });

        it('drops events of a refused scope without re-triggering, and merges nothing', async () => {
            refuseHandshake();
            await engine.trigger();
            expect(engine.getState().state).toBe('unsafe_merge');
            vi.mocked(pb.send).mockClear();
            vi.mocked(localDB.getRecord).mockResolvedValue(makeDeletedRecordFor('x'));

            vi.useFakeTimers();
            deliver({ action: 'update', record: serverRecord('x') });
            localWrite(engine, 'x');
            await flushBuffer();

            expect(localDB.transaction).not.toHaveBeenCalled();
            expect(mockBatch.send).not.toHaveBeenCalled();
            expect(handshakes()).toBe(0);
        });

        it('keeps a realtime correction Push behind the gate and the server guard', async () => {
            await verifySession(engine);
            // Local tombstone beats remote live: the correction is pushed with proof.
            vi.mocked(localDB.getRecord).mockResolvedValue(makeDeletedRecordFor('x'));
            deliver({ action: 'update', record: serverRecord('x') });
            await vi.waitFor(() =>
                expect(mockBatchCollection.upsert).toHaveBeenCalledWith(
                    expect.objectContaining({ id: 'x', isDeleted: true }),
                    // The session proved server coverage through its confirmed Pull bound.
                    { headers: { 'X-Kei-Sync-Coverage': '3000', 'X-Kei-Sync-Lineage': LINEAGE } }
                )
            );

            // The server refuses an unproven create: the scope stops sending.
            mockBatch.send.mockRejectedValueOnce(
                Object.assign(new Error('Batch transaction failed.'), {
                    response: { message: 'Merge is not proven safe (Sync_unsafe).' }
                })
            );
            vi.mocked(localDB.getRecord).mockResolvedValue(makeRecord('y', 3000));
            deliver({ action: 'update', record: serverRecord('y', false, 1000) });
            await vi.waitFor(() => expect(mockBatch.send).toHaveBeenCalledTimes(2));
            mockBatch.send.mockClear();
            vi.mocked(pb.send).mockClear();

            vi.useFakeTimers();
            deliver({ action: 'update', record: serverRecord('y', false, 1000) });
            localWrite(engine, 'y');
            await flushBuffer();
            expect(mockBatch.send).not.toHaveBeenCalled();
            expect(handshakes()).toBe(0);
        });

        it('holds buffered Pushes for an unverified scope and requests a verified session', async () => {
            vi.mocked(localDB.getRecord).mockResolvedValue(makeRecord('held'));
            vi.mocked(localDB.getUnsyncedChanges).mockResolvedValue([makeRecord('held')]);
            refuseHandshake();

            vi.useFakeTimers();
            localWrite(engine, 'held');
            await flushBuffer();
            await vi.waitFor(() => expect(handshakes()).toBe(1));
            expect(mockBatch.send).not.toHaveBeenCalled();
            expect(engine.getState().state).toBe('unsafe_merge');
        });

        it('pages the Pull by revision so a row moving mid-Pull cannot shift an unread row out', async () => {
            const page = Array.from({ length: 200 }, (_, i) => ({
                ...serverRecord(`r${i}`),
                serverUpdatedAt: 1001 + i
            }));
            // Same versions locally: nothing to merge or correct, only paging is observed.
            vi.mocked(localDB.getRecord).mockResolvedValue(makeRecord('known', 2000));
            vi.mocked(mockCollection.getList)
                .mockResolvedValueOnce({ items: page, page: 1, totalPages: 9 } as never)
                .mockResolvedValue({ items: [], page: 1, totalPages: 1 } as never);

            await engine.trigger();

            const pulls = vi.mocked(mockCollection.getList).mock.calls;
            expect(pulls.map(([pageNumber]) => pageNumber)).toEqual([1, 1]);
            const bounds = vi.mocked(pb.filter).mock.calls.map(([, params]) => params);
            expect(bounds).toEqual([
                { scopeId: mockUserId, after: 1000, through: 3000 },
                { scopeId: mockUserId, after: 1200, through: 3000 }
            ]);
        });

        it('offers own anchored checkpoints first and caps the offered set', async () => {
            vi.mocked(localDB.getSyncCheckpoints).mockResolvedValue([
                ...Array.from({ length: 600 }, (_, i) => ({
                    id: `inherited-${i}`,
                    anchor: 0,
                    heldAt: 1000 + i,
                    createdAt: Date.now()
                })),
                { id: 'own', anchor: 50, heldAt: 1, createdAt: Date.now() }
            ]);

            await engine.trigger();

            const [handshake] = vi
                .mocked(pb.send)
                .mock.calls.filter(([path]) => path === '/api/sync/handshake')
                .map(([, options]) => (options as { body: { checkpoints: string[] } }).body);
            expect(handshake.checkpoints).toHaveLength(500);
            expect(handshake.checkpoints[0]).toBe('own');
            expect(handshake.checkpoints[1]).toBe('inherited-599');
        });

        it('does not retry per event after an ordinary session failure, and keeps reporting it', async () => {
            vi.mocked(pb.send).mockImplementation(async (path, options) => {
                if (path === '/api/sync/handshake') throw new Error('offline');
                return serveSync(path, options as { body?: Record<string, unknown> });
            });
            await engine.trigger();
            expect(engine.getState().state).toBe('network_error');
            vi.mocked(pb.send).mockClear();
            vi.mocked(localDB.getRecord).mockResolvedValue(makeRecord('x'));

            vi.useFakeTimers();
            deliver({ action: 'update', record: serverRecord('x') });
            localWrite(engine, 'x');
            await flushBuffer();

            expect(handshakes()).toBe(0);
            expect(mockBatch.send).not.toHaveBeenCalled();
            expect(engine.getState().state).toBe('network_error');
        });

        it('still pushes a verified scope when another scope is blocked', async () => {
            vi.mocked(getActiveSession).mockReturnValue({
                userId: mockUserId,
                masterKey: {} as CryptoKey,
                identityKeyPair: {} as CryptoKeyPair,
                roomId: mockRoomId,
                roomKey: {} as CryptoKey
            });
            vi.mocked(pb.send).mockImplementation(async (path, options) => {
                const body = (options as { body?: Record<string, unknown> }).body;
                if (path === '/api/sync/handshake' && body?.scopeType === 'user') {
                    return {
                        gcHigh: 1500,
                        coverage: 1000,
                        known: [],
                        lineage: LINEAGE,
                        initializing: null,
                        hasRecords: true
                    };
                }
                return serveSync(path, options as { body?: Record<string, unknown> });
            });
            await engine.trigger();
            mockBatchCollection.upsert.mockClear();
            vi.mocked(localDB.getRecord).mockResolvedValue({
                ...makeRecord('room-chat'),
                scopeType: 'room',
                scopeId: mockRoomId
            });

            vi.useFakeTimers();
            localWrite(engine, 'room-chat');
            await flushBuffer();

            expect(mockBatchCollection.upsert).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'room-chat', roomId: mockRoomId }),
                coverageHeader
            );
            expect(engine.getState().state).toBe('unsafe_merge');
        });

        it('neither commits nor advances cursors when the server changes mid-session', async () => {
            vi.mocked(mockCollection.getList).mockImplementation(async () => {
                pb.baseUrl = 'https://other.example.test';
                return { items: [], page: 1, totalPages: 1 } as never;
            });
            vi.mocked(localDB.getUnsyncedChanges).mockResolvedValue([makeRecord('local', 2000)]);

            await engine.trigger();

            expect(vi.mocked(pb.send).mock.calls.map(([path]) => path)).not.toContain(
                '/api/sync/commit'
            );
            expect(mockBatch.send).not.toHaveBeenCalled();
            expect(syncCursorDB.advance).not.toHaveBeenCalled();
        });

        it('sends nothing to a server other than the verified one', async () => {
            await verifySession(engine);
            pb.baseUrl = 'https://other.example.test';
            vi.mocked(localDB.getRecord).mockResolvedValue(undefined);
            refuseHandshake();

            // Stale subscription of the previous server.
            deliver({ action: 'create', record: serverRecord('stale') });
            // A local write must be verified against the new server first.
            vi.mocked(localDB.getRecord).mockResolvedValue(makeRecord('moved'));
            vi.useFakeTimers();
            localWrite(engine, 'moved');
            await flushBuffer();

            await vi.waitFor(() => expect(handshakes()).toBe(1));
            expect(localDB.transaction).not.toHaveBeenCalled();
            expect(mockBatch.send).not.toHaveBeenCalled();
        });
    });

    describe('canonical local persistence', () => {
        let db: WebDatabaseAdapter;
        let tick: number;
        const remote = {
            id: 'low-version',
            kind: 'characters',
            userId: mockUserId,
            createdAt: 1,
            updatedAt: 10,
            isDeleted: false,
            localUpdatedAt: Number.MAX_SAFE_INTEGER,
            encryptedData: 'data',
            encryptedDataIV: 'iv'
        };

        beforeEach(async () => {
            await Dexie.delete('KeiLocalDB');
            db = new WebDatabaseAdapter();
            tick = 10000;
            vi.mocked(clock.now).mockImplementation(() => ++tick);
            vi.mocked(localDB.getLocalUpdatedAt).mockImplementation(db.getLocalUpdatedAt.bind(db));
            vi.mocked(localDB.getRecord).mockImplementation(db.getRecord.bind(db));
            vi.mocked(localDB.putRecord).mockImplementation(db.putRecord.bind(db));
            vi.mocked(localDB.putRecords).mockImplementation(db.putRecords.bind(db));
            vi.mocked(localDB.getUnsyncedChanges).mockImplementation(
                db.getUnsyncedChanges.bind(db)
            );
            vi.mocked(localDB.getSyncGcHigh).mockImplementation(db.getSyncGcHigh.bind(db));
            vi.mocked(localDB.collectTombstones).mockImplementation(db.collectTombstones.bind(db));
            vi.mocked(localDB.getSyncCheckpoints).mockImplementation(
                db.getSyncCheckpoints.bind(db)
            );
            vi.mocked(localDB.addSyncCheckpoints).mockImplementation(
                db.addSyncCheckpoints.bind(db)
            );
            vi.mocked(localDB.pruneSyncCheckpoints).mockImplementation(
                db.pruneSyncCheckpoints.bind(db)
            );
            vi.mocked(localDB.getSyncScopeState).mockImplementation(db.getSyncScopeState.bind(db));
            vi.mocked(localDB.setSyncScopeState).mockImplementation(db.setSyncScopeState.bind(db));
            vi.mocked(localDB.hasScopeRecords).mockImplementation(db.hasScopeRecords.bind(db));
            await db.setSyncScopeState(
                { scopeType: 'user', scopeId: mockUserId },
                { lineage: LINEAGE, adopting: null, bootstrapping: null }
            );
            vi.mocked(mockBatch.send).mockResolvedValue([]);
            vi.mocked(mockCollection.getList).mockResolvedValue({
                items: [],
                page: 1,
                totalPages: 1
            });
            vi.mocked(decryptBytes).mockResolvedValue(
                deflateSync(
                    strToU8(
                        JSON.stringify({
                            data: { name: 'Remote' },
                            localUpdatedAt: Number.MAX_SAFE_INTEGER
                        })
                    )
                )
            );
        });

        afterEach(async () => {
            await Dexie.delete('KeiLocalDB');
            pb.baseUrl = 'https://sync.example.test';
            vi.mocked(localDB.getLocalUpdatedAt).mockResolvedValue(2500);
            vi.mocked(localDB.getRecord).mockReset();
            vi.mocked(localDB.putRecord).mockReset();
            vi.mocked(localDB.putRecords).mockReset();
            vi.mocked(localDB.getUnsyncedChanges).mockReset();
            vi.mocked(syncCursorDB.get).mockReset();
            vi.mocked(syncCursorDB.advance).mockReset();
            vi.mocked(decryptBytes).mockResolvedValue(deflateSync(strToU8('{}')));
        });

        it('sends a change held while unsafe once a later session is verified', async () => {
            const cursors = { serverPullCursor: 0, localPushCursor: 0 };
            vi.mocked(syncCursorDB.get).mockImplementation(async () => ({ ...cursors }));
            vi.mocked(syncCursorDB.advance).mockImplementation(async (_identity, update) => {
                cursors.serverPullCursor = update.serverPullCursor ?? cursors.serverPullCursor;
                cursors.localPushCursor = update.localPushCursor ?? cursors.localPushCursor;
            });
            await db.addSyncCheckpoints({ scopeType: 'user', scopeId: mockUserId }, [
                { id: 'held', anchor: 0 }
            ]);
            // A device with data: an unproven merge is refused, not replaced by adoption.
            await db.putRecord('characters', makeRecord('existing'));
            let safe = false;
            vi.mocked(pb.send).mockImplementation(async (path, options) =>
                path === '/api/sync/handshake' && !safe
                    ? {
                          gcHigh: 10,
                          coverage: 0,
                          known: [],
                          lineage: LINEAGE,
                          initializing: null,
                          hasRecords: true
                      }
                    : serveSync(path, options as { body?: Record<string, unknown> })
            );
            await DataRecordSyncEngine.trigger();
            expect(DataRecordSyncEngine.getState().state).toBe('unsafe_merge');

            const states: string[] = [];
            const unsubscribe = DataRecordSyncEngine.subscribeStatus(({ state }) =>
                states.push(state)
            );
            states.length = 0;
            await db.putRecord('characters', makeRecord('written-while-unsafe'));
            DataRecordSyncEngine.handleLocalWrite({
                tableName: 'characters',
                operation: 'put',
                ids: ['written-while-unsafe'],
                origin: 'local'
            });
            // The flush runs, holds the change, and keeps reporting why.
            await vi.waitFor(() => expect(states).toEqual(['syncing', 'unsafe_merge']), {
                timeout: 5_000
            });
            unsubscribe();
            expect(mockBatchCollection.upsert).not.toHaveBeenCalled();
            expect(cursors.localPushCursor).toBe(0);

            safe = true;
            await DataRecordSyncEngine.trigger();
            expect(mockBatchCollection.upsert).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'written-while-unsafe' }),
                coverageHeader
            );
            const held = await db.getRecord('characters', 'written-while-unsafe');
            expect(cursors.localPushCursor).toBeGreaterThanOrEqual(held!.localUpdatedAt!);
        });

        it('pushes a low updatedAt change received from another server back to the original server', async () => {
            const cursors = new Map<
                string,
                { serverPullCursor: number; localPushCursor: number }
            >();
            vi.mocked(syncCursorDB.get).mockImplementation(
                async ({ serverUrl }) =>
                    cursors.get(serverUrl) ?? { serverPullCursor: 0, localPushCursor: 0 }
            );
            vi.mocked(syncCursorDB.advance).mockImplementation(async ({ serverUrl }, update) => {
                cursors.set(serverUrl, { ...cursors.get(serverUrl)!, ...update });
            });
            for (let i = 0; i < 11; i++) {
                await db.putRecord('characters', makeRecord('original', 1000 + i));
            }
            await DataRecordSyncEngine.trigger();
            const originalCursor = cursors.get(pb.baseUrl)!.localPushCursor;

            pb.baseUrl = 'https://other.example.test';
            vi.mocked(mockCollection.getList).mockResolvedValue({
                items: [remote],
                page: 1,
                totalPages: 1
            });
            await DataRecordSyncEngine.trigger();
            const stored = await db.getRecord('characters', remote.id);
            expect(stored!.updatedAt).toBeLessThan(originalCursor);
            expect(stored!.localUpdatedAt).toBeGreaterThan(originalCursor);
            expect(stored!.localUpdatedAt).toBeLessThan(Number.MAX_SAFE_INTEGER);

            pb.baseUrl = 'https://sync.example.test';
            vi.mocked(mockCollection.getList).mockResolvedValue({
                items: [],
                page: 1,
                totalPages: 1
            });
            mockBatchCollection.upsert.mockClear();
            await DataRecordSyncEngine.trigger();
            expect(mockBatchCollection.upsert).toHaveBeenCalledWith(
                expect.objectContaining({ id: remote.id, updatedAt: 10 }),
                coverageHeader
            );
            expect(mockBatchCollection.upsert.mock.calls[0][0]).not.toHaveProperty(
                'localUpdatedAt'
            );
            const compressed = vi.mocked(encryptBytes).mock.calls.at(-1)![1];
            expect(JSON.parse(strFromU8(inflateSync(compressed)))).toEqual({
                data: { name: 'Remote' }
            });
        });

        it.each(['Pull', 'Realtime', 'Push'] as const)(
            'stamps accepted %s changes with local time',
            async (path) => {
                await db.putRecord('characters', { ...makeRecord(remote.id, 5), createdAt: 1 });
                const before = await db.getRecord('characters', remote.id);
                if (path === 'Pull') {
                    vi.mocked(mockCollection.getList).mockResolvedValue({
                        items: [remote],
                        page: 1,
                        totalPages: 1
                    });
                } else if (path === 'Push') {
                    vi.mocked(mockBatch.send).mockResolvedValue([{ status: 200, body: remote }]);
                } else {
                    await DataRecordSyncEngine.trigger();
                    await DataRecordSyncEngine.subscribeRealtime();
                    const callback = mockCollection.subscribe.mock.calls.at(-1)![1] as (
                        event: unknown
                    ) => void;
                    callback({ action: 'update', record: remote });
                    await vi.waitFor(() => expect(localDB.transaction).toHaveBeenCalled());
                    await vi.mocked(localDB.transaction).mock.results.at(-1)!.value;
                    await DataRecordSyncEngine.unsubscribeRealtime();
                }
                if (path !== 'Realtime') await DataRecordSyncEngine.trigger();
                const after = await db.getRecord('characters', remote.id);
                expect(after?.updatedAt).toBe(10);
                expect(after!.localUpdatedAt).toBeGreaterThan(before!.localUpdatedAt!);
                expect(after!.localUpdatedAt).toBeLessThan(Number.MAX_SAFE_INTEGER);
            }
        );

        it('keeps localUpdatedAt on duplicate Pull, Realtime, and Push responses and rejected versions', async () => {
            vi.mocked(mockCollection.getList).mockResolvedValue({
                items: [remote],
                page: 1,
                totalPages: 1
            });
            await DataRecordSyncEngine.trigger();
            const first = await db.getRecord('characters', remote.id);
            await DataRecordSyncEngine.trigger();
            expect((await db.getRecord('characters', remote.id))?.localUpdatedAt).toBe(
                first?.localUpdatedAt
            );

            await DataRecordSyncEngine.subscribeRealtime();
            const callback = mockCollection.subscribe.mock.calls.at(-1)![1] as (
                event: unknown
            ) => void;
            callback({ action: 'update', record: remote });
            await vi.waitFor(() => expect(localDB.transaction).toHaveBeenCalled());
            await vi.mocked(localDB.transaction).mock.results.at(-1)!.value;
            expect((await db.getRecord('characters', remote.id))?.localUpdatedAt).toBe(
                first?.localUpdatedAt
            );

            vi.mocked(mockBatch.send).mockResolvedValue([{ status: 200, body: remote }]);
            await DataRecordSyncEngine.trigger();
            expect((await db.getRecord('characters', remote.id))?.localUpdatedAt).toBe(
                first?.localUpdatedAt
            );
            vi.mocked(mockCollection.getList).mockResolvedValue({
                items: [{ ...remote, updatedAt: 5 }],
                page: 1,
                totalPages: 1
            });
            await DataRecordSyncEngine.trigger();
            expect(await db.getRecord('characters', remote.id)).toEqual(first);
            await DataRecordSyncEngine.unsubscribeRealtime();
        });
    });
});
