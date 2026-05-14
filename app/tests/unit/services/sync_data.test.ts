import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataSyncService } from '$lib/services/sync/data';
import { pb } from '$lib/adapters/pb';
import { localDB } from '$lib/adapters/db';
import { appKV } from '$lib/adapters/kv';
import { getActiveSession, hasActiveSession } from '$lib/services/session';
import type { BaseRecord, DataRecord } from '$lib/adapters/db';

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

vi.mock('$lib/adapters/kv', () => ({
    appKV: {
        get: vi.fn(),
        set: vi.fn(),
        remove: vi.fn()
    }
}));

vi.mock('$lib/adapters/multi', () => ({
    appMulti: {
        getDeleteMarkers: vi.fn(() => Promise.resolve([])),
        saveDeleteMarker: vi.fn(),
        deleteDeleteMarker: vi.fn()
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
    importMasterKey: vi.fn(() => Promise.resolve({ type: 'room-key' } as unknown as CryptoKey)),
    encrypt: vi.fn(() => ({ ciphertext: new Uint8Array(), iv: new Uint8Array() })),
    decrypt: vi.fn(() => '{}')
}));

import { appMulti } from '$lib/adapters/multi';

describe('DataSyncService', () => {
    const mockUserId = 'user-123';
    const mockRoomId = 'room-123';
    const makeRecord = (id: string, updatedAt = 1000): BaseRecord => ({
        id,
        scopeType: 'user',
        scopeId: mockUserId,
        createdAt: 1000,
        updatedAt,
        isDeleted: false
    });

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getActiveSession).mockReturnValue({
            userId: mockUserId,
            masterKey: {} as CryptoKey,
            identityKeyPair: {} as CryptoKeyPair
        });
        vi.mocked(hasActiveSession).mockReturnValue(true);
        (pb.authStore as unknown as { isValid: boolean }).isValid = true;

        vi.mocked(mockCollection.subscribe).mockResolvedValue(() => {});
        vi.mocked(mockCollection.unsubscribe).mockResolvedValue(() => {});
        vi.mocked(localDB.getUnsyncedChanges).mockResolvedValue([]);
    });

    describe('Realtime Subscription', () => {
        it('should subscribe to all sync tables', async () => {
            await DataSyncService.subscribeRealtime();
            expect(mockCollection.subscribe).toHaveBeenCalled();
        });

        it('should handle unsubscribe', async () => {
            (DataSyncService as unknown as { subscribed: boolean }).subscribed = true;
            await DataSyncService.unsubscribeRealtime();
            expect(mockCollection.unsubscribe).toHaveBeenCalled();
            expect(DataSyncService.isSubscribed).toBe(false);
        });
    });

    describe('Pull Logic (syncAll)', () => {
        it('should pull changes and handle LWW conflict', async () => {
            const tableName = 'characters';
            vi.mocked(appKV.get).mockResolvedValue('1000');

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
            } as BaseRecord);

            await DataSyncService.syncAll();

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
            vi.mocked(appKV.get).mockResolvedValue('1000');
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

            await DataSyncService.syncAll();

            expect(mockBatchCollection.upsert).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'rec-1' })
            );
            expect(mockBatch.send).toHaveBeenCalled();
        });

        it('should keep cursor unchanged when correction push fails', async () => {
            vi.mocked(appKV.get).mockResolvedValue('1000');
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

            await DataSyncService.syncAll();

            expect(appKV.set).not.toHaveBeenCalled();
            expect(DataSyncService.getState().state).toBe('network_error');
        });

        it('should pull active room scope from multi_room_records', async () => {
            vi.mocked(getActiveSession).mockReturnValue({
                userId: mockUserId,
                masterKey: {} as CryptoKey,
                identityKeyPair: {} as CryptoKeyPair,
                roomId: mockRoomId,
                roomKey: { type: 'room-key' } as unknown as CryptoKey
            });
            vi.mocked(appKV.get).mockResolvedValue('1000');
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

            await DataSyncService.syncAll();

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

        it('should push room delete marker tombstones and mark data done', async () => {
            vi.mocked(appKV.get).mockResolvedValue('1000');
            vi.mocked(mockCollection.getList).mockResolvedValue({
                items: [],
                page: 1,
                totalPages: 1
            } as unknown as { items: unknown[]; page: number; totalPages: number });
            vi.mocked(appMulti.getDeleteMarkers).mockResolvedValue([
                {
                    roomId: mockRoomId,
                    roomKey: 'room-key',
                    dataDone: false,
                    assetDone: false,
                    createdAt: 1,
                    updatedAt: 2,
                    attempts: 0
                }
            ]);
            const deletedRecord: DataRecord = {
                id: 'deleted-room-record',
                scopeType: 'room',
                scopeId: mockRoomId,
                createdAt: 1,
                updatedAt: 2,
                isDeleted: true,
                data: {}
            };
            vi.mocked(localDB.getUnsyncedChanges)
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([deletedRecord])
                .mockResolvedValueOnce([]);

            await DataSyncService.syncAll();

            expect(mockBatch.collection).toHaveBeenCalledWith('multi_room_records');
            expect(mockBatchCollection.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: 'deleted-room-record',
                    roomId: mockRoomId,
                    kind: 'characters',
                    isDeleted: true
                })
            );
            expect(appMulti.saveDeleteMarker).toHaveBeenCalledWith(
                expect.objectContaining({
                    roomId: mockRoomId,
                    dataDone: true,
                    assetDone: false,
                    lastError: undefined
                })
            );
            expect(appMulti.deleteDeleteMarker).not.toHaveBeenCalled();
        });
    });

    describe('Push Logic', () => {
        it('pushRecord should use create if isNew is true', async () => {
            const record = makeRecord('new-1');
            await DataSyncService.pushRecord('characters', record, true);
            expect(mockBatchCollection.create).toHaveBeenCalled();
            expect(mockBatch.send).toHaveBeenCalled();
        });

        it('pushRecord should use upsert if isNew is false', async () => {
            const record = makeRecord('existing-1');
            await DataSyncService.pushRecord('characters', record);
            expect(mockBatchCollection.upsert).toHaveBeenCalled();
            expect(mockBatch.send).toHaveBeenCalled();
        });
    });

    describe('pushRecentWrites', () => {
        it('should fetch unsynced changes and push them using upsert batch', async () => {
            const record = makeRecord('offline-1');
            vi.mocked(localDB.getUnsyncedChanges).mockResolvedValue([record]);

            await DataSyncService.pushRecentWrites(mockUserId, 5000);

            expect(localDB.getUnsyncedChanges).toHaveBeenCalled();
            expect(mockBatchCollection.upsert).toHaveBeenCalled();
            expect(mockBatch.send).toHaveBeenCalled();
        });
    });
});
