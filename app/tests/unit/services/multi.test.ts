import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, getActiveSession, setUserSession } from '$lib/services/session';
import { MultiRoomService } from '$lib/services/multi';
import type { MultiRoomIndexRecord, MultiRoomMemberRecord } from '$lib/adapters/multi';
import type { RoomRecord } from '$lib/adapters/db';

const mockMasterKey = {} as CryptoKey;
const mockRoomKey = { type: 'room-key' } as unknown as CryptoKey;

vi.mock('$lib/adapters/multi', () => ({
    appMulti: {
        saveRoomIndex: vi.fn(),
        saveMember: vi.fn(),
        purgeRoomLocal: vi.fn(),
        getRoomIndex: vi.fn(),
        getRoomIndexes: vi.fn(),
        getMembersByUser: vi.fn(),
        getMembersByRoom: vi.fn(),
        getMembership: vi.fn()
    }
}));

vi.mock('$lib/adapters/db', () => ({
    TABLES: ['rooms', 'chats', 'messages'],
    localDB: {
        putRecord: vi.fn(),
        transaction: vi.fn(async (_tables, _mode, callback) => {
            await callback();
        }),
        softDeleteByIndex: vi.fn(),
        deleteByIndex: vi.fn()
    }
}));

vi.mock('$lib/services/content/record_buffer', () => ({
    buffer: {
        get: vi.fn(),
        drop: vi.fn(),
        flushTable: vi.fn()
    }
}));

vi.mock('$lib/adapters/asset', () => ({
    appAsset: {
        deleteScopeAssets: vi.fn(() => Promise.resolve()),
        deleteAsset: vi.fn(() => Promise.resolve())
    }
}));

vi.mock('$lib/adapters/storage', () => ({
    appStorage: {
        delete: vi.fn(() => Promise.resolve())
    }
}));

vi.mock('$lib/crypto', () => ({
    generateMasterKey: vi.fn(() => Promise.resolve(mockRoomKey)),
    wrapKeyForIdentity: vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3]))),
    unwrapKeyWithIdentity: vi.fn(() => Promise.resolve(mockRoomKey)),
    toBase64: vi.fn((bytes: Uint8Array) => Array.from(bytes).join(',')),
    fromBase64: vi.fn((text: string) => new Uint8Array(text.split(',').map(Number)))
}));

vi.mock('$lib/adapters/http', () => ({
    appHttp: {
        fetch: vi.fn()
    }
}));

vi.mock('$lib/adapters/logger', () => ({
    createLogger: vi.fn(() => ({
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn()
    }))
}));

vi.mock('$lib/adapters/pb', () => ({
    pb: {
        baseUrl: 'http://pb.test',
        authStore: { token: 'token' }
    }
}));

vi.mock('$lib/utils/id', () => ({
    generateId: vi.fn()
}));

vi.mock('$lib/utils/clock', () => ({
    clock: {
        now: vi.fn(() => 1000)
    }
}));

import { appMulti } from '$lib/adapters/multi';
import { localDB } from '$lib/adapters/db';
import { buffer } from '$lib/services/content/record_buffer';
import { generateId } from '$lib/utils/id';
import { appAsset } from '$lib/adapters/asset';
import { appStorage } from '$lib/adapters/storage';
import { appHttp } from '$lib/adapters/http';

describe('MultiRoomService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearSession();
        setUserSession({
            userId: 'user-1',
            masterKey: mockMasterKey,
            identityKeyPair: {
                publicKey: { type: 'public' } as unknown as CryptoKey,
                privateKey: { type: 'private' } as unknown as CryptoKey
            }
        });
        vi.mocked(generateId).mockReturnValueOnce('room-1').mockReturnValueOnce('member-1');
    });

    it('creates a room index, owner membership, and activates room session', async () => {
        const room = await MultiRoomService.createRoom({
            visibility: 'private',
            publicName: 'Quiet Room'
        });

        expect(room).toMatchObject({
            id: 'room-1',
            name: 'Quiet Room'
        });
        expect(localDB.putRecord).toHaveBeenCalledWith(
            'rooms',
            expect.objectContaining({
                id: 'room-1',
                scopeType: 'room',
                scopeId: 'room-1',
                data: expect.objectContaining({
                    name: 'Quiet Room'
                })
            })
        );
        expect(appMulti.saveRoomIndex).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'room-1',
                ownerUserId: 'user-1',
                visibility: 'private',
                publicName: 'Quiet Room',
                isDeleted: false
            })
        );
        expect(appMulti.saveMember).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'member-1',
                roomId: 'room-1',
                userId: 'user-1',
                status: 'accepted',
                encryptedRoomKey: '1,2,3'
            })
        );
        expect(getActiveSession()).toMatchObject({
            userId: 'user-1',
            roomId: 'room-1',
            roomKey: mockRoomKey
        });
    });

    it('opens an accepted room membership', async () => {
        vi.mocked(appMulti.getRoomIndex).mockResolvedValue(roomIndex());
        vi.mocked(appMulti.getMembership).mockResolvedValue(member());

        const room = await MultiRoomService.openRoom('room-1');

        expect(room).toMatchObject({
            id: 'room-1',
            status: 'accepted'
        });
        expect(getActiveSession()).toMatchObject({
            roomId: 'room-1',
            roomKey: mockRoomKey
        });
    });

    it('rejects opening a pending membership', async () => {
        vi.mocked(appMulti.getRoomIndex).mockResolvedValue(roomIndex());
        vi.mocked(appMulti.getMembership).mockResolvedValue(member({ status: 'pending' }));

        await expect(MultiRoomService.openRoom('room-1')).rejects.toThrow(
            'Multi membership is not accepted'
        );
    });

    it('lists room-scoped room records for the active session', async () => {
        vi.mocked(appMulti.getMembersByUser).mockResolvedValue([
            member({ roomId: 'room-1', status: 'accepted' }),
            member({ roomId: 'room-2', status: 'pending' })
        ]);
        vi.mocked(appMulti.getRoomIndexes).mockResolvedValue([roomIndex()]);
        vi.mocked(buffer.get).mockImplementation(async (_table, id) => {
            if (id !== 'room-1') return null;
            return roomRecord({
                id: 'room-1',
                scopeId: 'room-1',
                data: { name: 'Quiet Room' }
            }) as never;
        });

        const rooms = await MultiRoomService.listRooms();

        expect(buffer.flushTable).toHaveBeenCalledWith('rooms');
        expect(buffer.get).toHaveBeenCalledWith('rooms', 'room-1');
        expect(rooms).toEqual([
            expect.objectContaining({
                id: 'room-1',
                name: 'Quiet Room'
            })
        ]);
    });

    it('lists accepted rooms from metadata before encrypted room content is synced', async () => {
        vi.mocked(appMulti.getMembersByUser).mockResolvedValue([
            member({ roomId: 'room-1', status: 'accepted' })
        ]);
        vi.mocked(appMulti.getRoomIndexes).mockResolvedValue([
            roomIndex({ id: 'room-1', publicName: 'Shared Room' })
        ]);
        vi.mocked(buffer.get).mockResolvedValue(null);

        const rooms = await MultiRoomService.listRooms();

        expect(rooms).toEqual([
            expect.objectContaining({
                id: 'room-1',
                name: 'Shared Room',
                scopeType: 'room',
                scopeId: 'room-1'
            })
        ]);
    });

    it('lists room indexes for the active user', async () => {
        vi.mocked(appMulti.getMembersByUser).mockResolvedValue([
            member({ roomId: 'room-1', updatedAt: 3 }),
            member({ roomId: 'room-2', updatedAt: 5 })
        ]);
        vi.mocked(appMulti.getRoomIndexes).mockResolvedValue([
            roomIndex({ id: 'room-1', publicName: 'First', updatedAt: 4 }),
            roomIndex({ id: 'room-2', publicName: 'Second', updatedAt: 2 })
        ]);

        const rooms = await MultiRoomService.listIndexes();

        expect(appMulti.getRoomIndexes).toHaveBeenCalledWith(['room-1', 'room-2']);
        expect(rooms.map((room) => room.id)).toEqual(['room-2', 'room-1']);
    });

    it('updates owner-visible room index fields', async () => {
        vi.mocked(appMulti.getRoomIndex).mockResolvedValue(roomIndex({ publicName: 'Old' }));
        vi.mocked(appMulti.getMembership).mockResolvedValue(member());

        const room = await MultiRoomService.updateIndex('room-1', {
            visibility: 'public',
            publicName: 'New'
        });

        expect(room).toMatchObject({
            visibility: 'public',
            publicName: 'New'
        });
        expect(appMulti.saveRoomIndex).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'room-1',
                ownerUserId: 'user-1',
                visibility: 'public',
                publicName: 'New',
                updatedAt: 1000
            })
        );
    });

    it('does not update another owner room', async () => {
        vi.mocked(appMulti.getRoomIndex).mockResolvedValue(roomIndex({ ownerUserId: 'other' }));
        vi.mocked(appMulti.getMembership).mockResolvedValue(member());

        await expect(
            MultiRoomService.updateIndex('room-1', { publicName: 'Nope' })
        ).rejects.toThrow('Cannot update shared room');
    });

    it('deletes an owned room through the server and purges local room content', async () => {
        await MultiRoomService.createRoom({ visibility: 'private' });
        vi.clearAllMocks();
        vi.mocked(appMulti.getRoomIndex).mockResolvedValue(roomIndex());
        vi.mocked(appHttp.fetch).mockResolvedValue({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ room: roomIndex({ isDeleted: true, updatedAt: 3 }) })
        } as Response);

        await MultiRoomService.deleteRoom('room-1');

        expect(appHttp.fetch).toHaveBeenCalledWith('http://pb.test/api/multi-rooms/room-1', {
            method: 'DELETE',
            headers: { Authorization: 'token' }
        });
        expect(appMulti.saveRoomIndex).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'room-1', isDeleted: true }),
            { origin: 'sync' }
        );
        expect(appAsset.deleteScopeAssets).toHaveBeenCalledWith({
            scopeType: 'room',
            scopeId: 'room-1'
        });
        expect(buffer.flushTable).toHaveBeenCalledWith('rooms');
        expect(buffer.flushTable).toHaveBeenCalledWith('chats');
        expect(buffer.flushTable).toHaveBeenCalledWith('messages');
        expect(localDB.deleteByIndex).toHaveBeenCalledWith('rooms', 'scopeId', 'room-1');
        expect(localDB.deleteByIndex).toHaveBeenCalledWith('chats', 'scopeId', 'room-1');
        expect(localDB.deleteByIndex).toHaveBeenCalledWith('messages', 'scopeId', 'room-1');
        expect(getActiveSession().roomId).toBeUndefined();
    });

    it('leaves the current room through the server and purges local room content', async () => {
        await MultiRoomService.createRoom({ visibility: 'private' });
        vi.clearAllMocks();
        vi.mocked(appHttp.fetch).mockResolvedValue({
            ok: true,
            status: 200,
            json: () =>
                Promise.resolve({ member: member({ status: 'left', encryptedRoomKey: undefined }) })
        } as Response);

        await MultiRoomService.leaveRoom('room-1');

        expect(appHttp.fetch).toHaveBeenCalledWith('http://pb.test/api/multi-rooms/room-1/leave', {
            method: 'POST',
            headers: { Authorization: 'token' }
        });
        expect(appMulti.saveMember).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'member-1', status: 'left' }),
            { origin: 'sync' }
        );
        expect(getActiveSession().roomId).toBeUndefined();
    });

    it('purges content for locally inaccessible rooms', async () => {
        vi.mocked(appMulti.getMembersByUser).mockResolvedValue([
            member({ roomId: 'room-1', status: 'accepted' }),
            member({ roomId: 'room-2', status: 'pending' }),
            member({ roomId: 'room-3', status: 'accepted' })
        ]);
        vi.mocked(appMulti.getRoomIndexes).mockResolvedValue([roomIndex({ id: 'room-1' })]);

        await MultiRoomService.purgeInaccessibleRoomContent();

        expect(localDB.deleteByIndex).not.toHaveBeenCalledWith('rooms', 'scopeId', 'room-1');
        expect(localDB.deleteByIndex).toHaveBeenCalledWith('rooms', 'scopeId', 'room-2');
        expect(localDB.deleteByIndex).toHaveBeenCalledWith('rooms', 'scopeId', 'room-3');
    });

    it('approves a pending member by wrapping the owner room key for their public key', async () => {
        await MultiRoomService.createRoom({ visibility: 'private' });
        vi.clearAllMocks();
        vi.mocked(appMulti.getRoomIndex).mockResolvedValue(roomIndex());
        vi.mocked(appMulti.getMembership)
            .mockResolvedValueOnce(member())
            .mockResolvedValueOnce(
                member({
                    id: 'member-2',
                    userId: 'user-2',
                    status: 'pending',
                    encryptedRoomKey: undefined
                })
            );
        const recipientPublicKey = { type: 'recipient-public' } as unknown as CryptoKey;

        const memberRecord = await MultiRoomService.approveJoinRequest(
            'room-1',
            'user-2',
            recipientPublicKey
        );

        expect(memberRecord).toMatchObject({
            id: 'member-2',
            roomId: 'room-1',
            userId: 'user-2',
            status: 'accepted'
        });
        expect(appMulti.saveMember).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'member-2',
                roomId: 'room-1',
                userId: 'user-2',
                status: 'accepted',
                encryptedRoomKey: '1,2,3'
            })
        );
    });

    it('requires an accepted owner membership before approving a join request', async () => {
        vi.mocked(appMulti.getRoomIndex).mockResolvedValue(roomIndex());
        vi.mocked(appMulti.getMembership)
            .mockResolvedValueOnce(member({ status: 'pending' }))
            .mockResolvedValueOnce(
                member({
                    id: 'member-2',
                    userId: 'user-2',
                    status: 'pending',
                    encryptedRoomKey: undefined
                })
            );

        await expect(
            MultiRoomService.approveJoinRequest('room-1', 'user-2', {
                type: 'recipient-public'
            } as unknown as CryptoKey)
        ).rejects.toThrow('Multi membership is not accepted');
    });

    it('revokes a member by clearing their wrapped room key', async () => {
        vi.mocked(appMulti.getRoomIndex).mockResolvedValue(roomIndex());
        vi.mocked(appMulti.getMembership).mockResolvedValue(
            member({ id: 'member-2', userId: 'user-2' })
        );

        await MultiRoomService.revokeMember('room-1', 'user-2');

        expect(appMulti.saveMember).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'member-2',
                status: 'revoked',
                encryptedRoomKey: undefined
            })
        );
    });

    it('creates a pending join request without a room key', async () => {
        vi.mocked(appHttp.fetch).mockResolvedValue({
            ok: true,
            status: 200,
            json: () =>
                Promise.resolve({
                    member: member({
                        id: 'member-pending',
                        status: 'pending',
                        encryptedRoomKey: undefined
                    })
                })
        } as Response);

        const memberRecord = await MultiRoomService.requestJoin('room-1');

        expect(memberRecord).toMatchObject({
            id: 'member-pending',
            roomId: 'room-1',
            userId: 'user-1',
            status: 'pending'
        });
        expect(appMulti.saveMember).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'pending',
                encryptedRoomKey: undefined
            }),
            { origin: 'sync' }
        );
    });

    it('rejects a pending join request as the room owner', async () => {
        vi.mocked(appMulti.getRoomIndex).mockResolvedValue(roomIndex());
        vi.mocked(appMulti.getMembership).mockResolvedValue(
            member({ id: 'member-2', userId: 'user-2', status: 'pending' })
        );

        await MultiRoomService.rejectJoin('room-1', 'user-2');

        expect(appMulti.saveMember).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'member-2',
                status: 'revoked',
                encryptedRoomKey: undefined
            })
        );
    });
});

function roomIndex(overrides: Partial<MultiRoomIndexRecord> = {}): MultiRoomIndexRecord {
    const base: MultiRoomIndexRecord = {
        id: 'room-1',
        ownerUserId: 'user-1',
        visibility: 'private',
        publicName: 'Room',
        createdAt: 1,
        updatedAt: 2,
        isDeleted: false
    };
    return {
        ...base,
        ...overrides,
        isDeleted: overrides.isDeleted ?? base.isDeleted
    };
}

function member(overrides: Partial<MultiRoomMemberRecord> = {}): MultiRoomMemberRecord {
    return {
        id: 'member-1',
        roomId: 'room-1',
        userId: 'user-1',
        status: 'accepted',
        encryptedRoomKey: '1,2,3',
        createdAt: 1,
        updatedAt: 2,
        ...overrides
    };
}

function roomRecord(overrides: Partial<RoomRecord> = {}): RoomRecord {
    return {
        id: 'room-1',
        scopeType: 'room',
        scopeId: 'room-1',
        createdAt: 1,
        updatedAt: 2,
        isDeleted: false,
        data: {
            name: 'Room',
            chats: { refs: {}, folders: {} },
            characters: { refs: {}, folders: {} }
        },
        ...overrides
    };
}
