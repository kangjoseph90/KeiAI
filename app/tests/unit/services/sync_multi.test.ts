import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MultiRecordSyncEngineImpl } from '$lib/services/sync/multi';
import { pb } from '$lib/adapters/pb';
import {
    appMulti,
    type MultiRoomIndexRecord,
    type MultiRoomMemberRecord
} from '$lib/adapters/multi';
import { appKV } from '$lib/adapters/kv';
import { getActiveSession, hasActiveSession } from '$lib/services/session';

const mockCollection = {
    getList: vi.fn(),
    getOne: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn()
};

const mockBatchCollection = {
    upsert: vi.fn()
};

const mockBatch = {
    collection: vi.fn(() => mockBatchCollection),
    send: vi.fn().mockResolvedValue([])
};

vi.mock('$lib/adapters/pb', () => ({
    pb: {
        baseUrl: 'https://sync.example.test',
        authStore: { isValid: true },
        collection: vi.fn(() => mockCollection),
        filter: vi.fn((value: string) => value),
        createBatch: vi.fn(() => mockBatch)
    }
}));

vi.mock('$lib/adapters/multi', () => ({
    appMulti: {
        getRoomIndex: vi.fn(),
        getRoomIndexesByOwner: vi.fn(),
        getRoomIndexesSince: vi.fn(),
        saveRoomIndex: vi.fn(),
        purgeRoomLocal: vi.fn(),
        getMember: vi.fn(),
        getMembersSince: vi.fn(),
        getMembersByRoomsSince: vi.fn(),
        saveMember: vi.fn()
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
    getActiveSession: vi.fn(),
    hasActiveSession: vi.fn()
}));

describe('MultiRecordSyncEngine', () => {
    const userId = 'user-1';
    let service: MultiRecordSyncEngineImpl;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new MultiRecordSyncEngineImpl();
        vi.mocked(getActiveSession).mockReturnValue({
            userId,
            masterKey: {} as CryptoKey,
            identityKeyPair: {} as CryptoKeyPair
        });
        vi.mocked(hasActiveSession).mockReturnValue(true);
        (pb.authStore as { isValid: boolean }).isValid = true;
        vi.mocked(appKV.get).mockResolvedValue('1000');
        vi.mocked(mockCollection.getList).mockResolvedValue({
            items: [],
            page: 1,
            totalPages: 1
        } as unknown as { items: unknown[]; page: number; totalPages: number });
        vi.mocked(mockCollection.getOne).mockResolvedValue({
            id: 'room-1',
            ownerUserId: 'owner-1',
            visibility: 'private',
            publicName: 'Room',
            createdAt: 1,
            updatedAt: 2000,
            isDeleted: false
        });
        vi.mocked(appMulti.getRoomIndexesByOwner).mockResolvedValue([]);
        vi.mocked(appMulti.getRoomIndexesSince).mockResolvedValue([]);
        vi.mocked(appMulti.getMembersSince).mockResolvedValue([]);
        vi.mocked(appMulti.getMembersByRoomsSince).mockResolvedValue([]);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('pulls remote room index and member metadata', async () => {
        vi.mocked(mockCollection.getList)
            .mockResolvedValueOnce({
                items: [
                    {
                        id: 'room-1',
                        ownerUserId: userId,
                        visibility: 'private',
                        publicName: 'Room',
                        createdAt: 1,
                        updatedAt: 2000,
                        isDeleted: false
                    }
                ],
                page: 1,
                totalPages: 1
            } as unknown as { items: unknown[]; page: number; totalPages: number })
            .mockResolvedValueOnce({
                items: [
                    {
                        id: 'member-1',
                        roomId: 'room-1',
                        userId,
                        status: 'accepted',
                        encryptedRoomKey: 'key',
                        createdAt: 1,
                        updatedAt: 2500,
                        isDeleted: false
                    }
                ],
                page: 1,
                totalPages: 1
            } as unknown as { items: unknown[]; page: number; totalPages: number });
        vi.mocked(appMulti.getRoomIndex).mockResolvedValue(null);
        vi.mocked(appMulti.getMember).mockResolvedValue(null);

        await service.trigger();

        expect(appMulti.saveRoomIndex).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'room-1', updatedAt: 2000 }),
            { origin: 'sync' }
        );
        expect(appMulti.saveMember).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'member-1', roomId: 'room-1' }),
            { origin: 'sync' }
        );
        expect(appKV.set).toHaveBeenCalledWith(
            'lastSync_multi_meta_user-1_server_https%3A%2F%2Fsync.example.test',
            '2500'
        );
    });

    it('resets the current user and server metadata cursor', async () => {
        await service.resetCursor(userId);

        expect(appKV.remove).toHaveBeenCalledWith(
            'lastSync_multi_meta_user-1_server_https%3A%2F%2Fsync.example.test'
        );
    });

    it('pushes owned room indexes and writable members', async () => {
        const ownedIndex = roomIndex({ updatedAt: 2000 });
        const ownMember = member({ updatedAt: 2100 });
        const invitedMember = member({ id: 'member-2', userId: 'user-2', updatedAt: 2200 });

        vi.mocked(appMulti.getRoomIndexesByOwner).mockResolvedValue([ownedIndex]);
        vi.mocked(appMulti.getRoomIndexesSince).mockResolvedValue([ownedIndex]);
        vi.mocked(appMulti.getMembersSince).mockResolvedValue([ownMember]);
        vi.mocked(appMulti.getMembersByRoomsSince).mockResolvedValue([invitedMember]);

        await service.trigger();

        expect(mockBatch.collection).toHaveBeenCalledWith('multi_room_index');
        expect(mockBatch.collection).toHaveBeenCalledWith('multi_room_members');
        expect(mockBatchCollection.upsert).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'room-1', ownerUserId: userId })
        );
        expect(mockBatchCollection.upsert).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'member-2', userId: 'user-2' })
        );
        expect(appKV.set).toHaveBeenCalledWith(
            'lastSync_multi_meta_user-1_server_https%3A%2F%2Fsync.example.test',
            '2200'
        );
    });

    it('does not push local member write events for non-owned rooms', async () => {
        vi.useFakeTimers();
        vi.mocked(appMulti.getMember).mockResolvedValue(member({ id: 'member-1' }));
        vi.mocked(appMulti.getRoomIndexesByOwner).mockResolvedValue([]);

        service.handleLocalWrite({
            tableName: 'multi_room_members',
            operation: 'put',
            ids: ['member-1'],
            origin: 'local'
        });

        await vi.advanceTimersByTimeAsync(3_000);
        expect(mockBatch.collection).not.toHaveBeenCalledWith('multi_room_members');
        expect(mockBatchCollection.upsert).not.toHaveBeenCalledWith(
            expect.objectContaining({ id: 'member-1', userId })
        );
    });

    it('bootstraps a room index when an accepted own membership arrives', async () => {
        vi.mocked(mockCollection.getList)
            .mockResolvedValueOnce({
                items: [],
                page: 1,
                totalPages: 1
            } as unknown as { items: unknown[]; page: number; totalPages: number })
            .mockResolvedValueOnce({
                items: [
                    {
                        id: 'member-1',
                        roomId: 'room-1',
                        userId,
                        status: 'accepted',
                        encryptedRoomKey: 'key',
                        createdAt: 1,
                        updatedAt: 2500
                    }
                ],
                page: 1,
                totalPages: 1
            } as unknown as { items: unknown[]; page: number; totalPages: number });
        vi.mocked(appMulti.getMember).mockResolvedValue(null);
        vi.mocked(appMulti.getRoomIndex).mockResolvedValue(null);
        vi.mocked(mockCollection.getOne).mockResolvedValue(
            roomIndex({ ownerUserId: 'owner-1', updatedAt: 1500 })
        );

        await service.trigger();

        expect(mockCollection.getOne).toHaveBeenCalledWith('room-1', { requestKey: null });
        expect(appMulti.saveRoomIndex).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'room-1', ownerUserId: 'owner-1' }),
            { origin: 'sync' }
        );
    });

    describe('Room index endpoint-first tombstone', () => {
        it('remote deleted index always triggers purge', async () => {
            vi.mocked(mockCollection.getList)
                .mockResolvedValueOnce({
                    items: [
                        {
                            id: 'room-1',
                            ownerUserId: userId,
                            visibility: 'private',
                            publicName: 'Room',
                            createdAt: 1,
                            updatedAt: 2000,
                            isDeleted: true
                        }
                    ],
                    page: 1,
                    totalPages: 1
                } as unknown as { items: unknown[]; page: number; totalPages: number })
                .mockResolvedValueOnce({
                    items: [],
                    page: 1,
                    totalPages: 1
                } as unknown as { items: unknown[]; page: number; totalPages: number });

            // No local room index — should still hard-delete
            vi.mocked(appMulti.getRoomIndex).mockResolvedValue(null);
            vi.mocked(appMulti.getMember).mockResolvedValue(null);

            await service.trigger();

            // Should hard-delete, not save isDeleted
            expect(appMulti.purgeRoomLocal).toHaveBeenCalledWith('room-1', { origin: 'sync' });
        });

        it('local deleted + remote live does not trigger repair push', async () => {
            vi.mocked(mockCollection.getList)
                .mockResolvedValueOnce({
                    items: [
                        {
                            id: 'room-1',
                            ownerUserId: userId,
                            visibility: 'private',
                            publicName: 'Room',
                            createdAt: 1,
                            updatedAt: 2000
                        }
                    ],
                    page: 1,
                    totalPages: 1
                } as unknown as { items: unknown[]; page: number; totalPages: number })
                .mockResolvedValueOnce({
                    items: [],
                    page: 1,
                    totalPages: 1
                } as unknown as { items: unknown[]; page: number; totalPages: number });

            // Local has no room index (hard-deleted, not soft-deleted)
            vi.mocked(appMulti.getRoomIndex).mockResolvedValue(null);
            vi.mocked(appMulti.getRoomIndexesByOwner).mockResolvedValue([]);

            await service.trigger();

            // Should NOT push — no local room index to push
            expect(mockBatchCollection.upsert).not.toHaveBeenCalledWith(
                expect.objectContaining({ id: 'room-1' })
            );
        });

        it('push response handles server-enforced deleted room index', async () => {
            vi.mocked(appMulti.getRoomIndexesByOwner).mockResolvedValue([
                roomIndex({ updatedAt: 2000 })
            ]);
            vi.mocked(appMulti.getRoomIndexesSince).mockResolvedValue([
                roomIndex({ updatedAt: 2000 })
            ]);
            vi.mocked(appMulti.getMembersSince).mockResolvedValue([]);
            vi.mocked(appMulti.getMembersByRoomsSince).mockResolvedValue([]);

            // Server returns deleted room index in batch response
            vi.mocked(mockBatch.send).mockResolvedValue([
                {
                    status: 200,
                    body: {
                        id: 'room-1',
                        ownerUserId: userId,
                        visibility: 'private',
                        publicName: 'Room',
                        createdAt: 1,
                        updatedAt: 2500,
                        isDeleted: true
                    }
                }
            ]);

            await service.trigger();

            // Should hard-delete room locally (not save isDeleted)
            expect(appMulti.purgeRoomLocal).toHaveBeenCalledWith('room-1', { origin: 'sync' });
        });
    });
});

function roomIndex(overrides: Partial<MultiRoomIndexRecord> = {}): MultiRoomIndexRecord {
    return {
        id: 'room-1',
        ownerUserId: 'user-1',
        visibility: 'private',
        publicName: 'Room',
        createdAt: 1,
        updatedAt: 2,
        ...overrides
    };
}

function member(overrides: Partial<MultiRoomMemberRecord> = {}): MultiRoomMemberRecord {
    return {
        id: 'member-1',
        roomId: 'room-1',
        userId: 'user-1',
        status: 'accepted',
        encryptedRoomKey: 'key',
        createdAt: 1,
        updatedAt: 2,
        ...overrides
    };
}
