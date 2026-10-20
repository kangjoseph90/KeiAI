import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import Dexie from 'dexie';
import fakeIndexedDB, { IDBKeyRange } from 'fake-indexeddb';
import { WebDatabaseAdapter } from '$lib/adapters/db/web';
import { clock } from '$lib/utils/clock';
import { encryptBytes, decryptBytes } from '$lib/crypto';
import { DataRecordSyncEngine } from '$lib/services/sync/data';
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
        send: vi.fn().mockResolvedValue({ now: 3000 }),
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
        subscribeWriteEvents: vi.fn(() => () => {})
    }
}));

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
    });

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
        it('continues by timestamp and id when a full page shifts during a pull', async () => {
            vi.mocked(syncCursorDB.get).mockResolvedValue({
                serverPullCursor: 1000,
                localPushCursor: 2500
            });
            const page = Array.from({ length: 200 }, (_, index) => ({
                id: `record-${String(index).padStart(3, '0')}`,
                kind: 'characters',
                userId: mockUserId,
                updatedAt: 1500,
                serverUpdatedAt: 2000,
                encryptedData: 'base64-data',
                encryptedDataIV: 'base64-iv'
            }));
            vi.mocked(mockCollection.getList)
                .mockResolvedValueOnce({ items: page } as unknown as {
                    items: unknown[];
                    page: number;
                    totalPages: number;
                })
                // A row that was just beyond page one moved into its range while an earlier
                // row moved beyond the bounded server revision.
                .mockResolvedValueOnce({
                    items: [
                        {
                            id: 'record-200',
                            kind: 'characters',
                            userId: mockUserId,
                            updatedAt: 1500,
                            serverUpdatedAt: 2000,
                            encryptedData: 'base64-data',
                            encryptedDataIV: 'base64-iv'
                        }
                    ]
                } as unknown as { items: unknown[]; page: number; totalPages: number });
            vi.mocked(localDB.getRecord).mockResolvedValue(undefined);

            await DataRecordSyncEngine.trigger();

            expect(mockCollection.getList).toHaveBeenCalledTimes(2);
            expect(
                mockCollection.getList.mock.calls.map(([requestedPage]) => requestedPage)
            ).toEqual([1, 1]);
            expect(pb.filter).toHaveBeenLastCalledWith(
                expect.stringContaining('serverUpdatedAt = {:after} && id > {:afterId}'),
                { scopeId: mockUserId, after: 2000, afterId: 'record-199', through: 3000 }
            );
            expect(localDB.putRecords).toHaveBeenCalledTimes(2);
            expect(localDB.putRecords).toHaveBeenLastCalledWith(
                'characters',
                [expect.objectContaining({ id: 'record-200' })],
                { origin: 'sync' }
            );
        });

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
                expect.objectContaining({ id: 'rec-1' })
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
                expect.objectContaining({ id: 'existing-1' })
            );
            expect(mockBatch.send).toHaveBeenCalled();
        });

        it('keeps the network error state when a buffered push fails', async () => {
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
                expect.objectContaining({ id: 'rec-1' })
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
                expect.objectContaining({ id: 'rec-1', isDeleted: true })
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
                expect.objectContaining({ id: remote.id, updatedAt: 10 })
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
