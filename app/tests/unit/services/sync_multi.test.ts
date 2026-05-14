import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MultiSyncEngine } from '$lib/services/sync/multi';
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
    subscribe: vi.fn(),
    unsubscribe: vi.fn()
};

const mockBatchCollection = {
    upsert: vi.fn()
};

const mockBatch = {
    collection: vi.fn(() => mockBatchCollection),
    send: vi.fn()
};

vi.mock('$lib/adapters/pb', () => ({
    pb: {
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

describe('MultiSyncEngine', () => {
    const userId = 'user-1';
    let service: MultiSyncEngine;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new MultiSyncEngine();
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
        vi.mocked(appMulti.getRoomIndexesByOwner).mockResolvedValue([]);
        vi.mocked(appMulti.getRoomIndexesSince).mockResolvedValue([]);
        vi.mocked(appMulti.getMembersSince).mockResolvedValue([]);
        vi.mocked(appMulti.getMembersByRoomsSince).mockResolvedValue([]);
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

        await service.syncAll();

        expect(appMulti.saveRoomIndex).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'room-1', updatedAt: 2000 }),
            { origin: 'sync' }
        );
        expect(appMulti.saveMember).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'member-1', roomId: 'room-1' }),
            { origin: 'sync' }
        );
        expect(appKV.set).toHaveBeenCalledWith('lastSync_multi_meta_user-1', '2500');
    });

    it('pushes owned room indexes and writable members', async () => {
        const ownedIndex = roomIndex({ updatedAt: 2000 });
        const ownMember = member({ updatedAt: 2100 });
        const invitedMember = member({ id: 'member-2', userId: 'user-2', updatedAt: 2200 });

        vi.mocked(appMulti.getRoomIndexesByOwner).mockResolvedValue([ownedIndex]);
        vi.mocked(appMulti.getRoomIndexesSince).mockResolvedValue([ownedIndex]);
        vi.mocked(appMulti.getMembersSince).mockResolvedValue([ownMember]);
        vi.mocked(appMulti.getMembersByRoomsSince).mockResolvedValue([invitedMember]);

        await service.syncAll();

        expect(mockBatch.collection).toHaveBeenCalledWith('multi_room_index');
        expect(mockBatch.collection).toHaveBeenCalledWith('multi_room_members');
        expect(mockBatchCollection.upsert).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'room-1', ownerUserId: userId })
        );
        expect(mockBatchCollection.upsert).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'member-2', userId: 'user-2' })
        );
        expect(appKV.set).toHaveBeenCalledWith('lastSync_multi_meta_user-1', '2200');
    });

    it('routes local member write events through writable-member filtering', async () => {
        vi.mocked(appMulti.getMember).mockResolvedValue(member({ id: 'member-1' }));
        vi.mocked(appMulti.getRoomIndexesByOwner).mockResolvedValue([]);

        await service.handleLocalWrite({
            tableName: 'multi_room_members',
            operation: 'put',
            ids: ['member-1'],
            origin: 'local'
        });

        await vi.waitFor(() => {
            expect(mockBatch.collection).toHaveBeenCalledWith('multi_room_members');
        });
        expect(mockBatchCollection.upsert).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'member-1', userId })
        );
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
        isDeleted: false,
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
        isDeleted: false,
        ...overrides
    };
}
