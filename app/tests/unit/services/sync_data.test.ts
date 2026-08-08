import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
    encrypt: vi.fn(() => ({ ciphertext: new Uint8Array(), iv: new Uint8Array() })),
    decrypt: vi.fn(() => '{}')
}));

vi.mock('$lib/utils/clock', () => ({
    clock: {
        now: vi.fn(() => 2500),
        observe: vi.fn()
    }
}));

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

        it('deleted record with no local counterpart is skipped', async () => {
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

            // Should NOT store a deleted record we never had
            expect(localDB.putRecords).not.toHaveBeenCalled();
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
});
