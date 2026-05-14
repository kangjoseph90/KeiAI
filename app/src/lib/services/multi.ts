/**
 * Multi Service — Multi-room Metadata and Session Lifecycle
 *
 * Owns local multi-room metadata, membership state, room key wrapping, and
 * activation of the room portion of the in-memory session. Room-scoped content
 * stays in the normal content services and is selected by DataScope.
 */

import {
    appMulti,
    type MultiRoomIndexRecord,
    type MultiRoomMemberRecord,
    type MultiRoomMemberStatus,
    type MultiRoomVisibility
} from '$lib/adapters/multi';
import { localDB, TABLES, type RoomRecord } from '$lib/adapters/db';
import {
    fromBase64,
    exportMasterKeyRaw,
    generateMasterKey,
    unwrapKeyWithIdentity,
    wrapKeyForIdentity,
    toBase64
} from '$lib/crypto';
import { AppError } from '$lib/types/errors';
import { clock } from '$lib/utils/clock';
import { generateId } from '$lib/utils/id';
import { clearMultiRoomSession, getActiveSession, setMultiRoomSession } from './session';
import { buffer } from './content/record_buffer';
import { parseFields as parseRoomFields, type Room } from './content/room';
import { appAsset } from '$lib/adapters/asset';
import { appStorage } from '$lib/adapters/storage';
import { SyncManager } from './sync';

// ─── Domain Types ────────────────────────────────────────────────────

export interface MultiRoom {
    id: string;
    ownerUserId: string;
    visibility: MultiRoomVisibility;
    publicName?: string;
    status: MultiRoomMemberStatus;
    createdAt: number;
    updatedAt: number;
}

export interface MultiRoomMember {
    id: string;
    roomId: string;
    userId: string;
    status: MultiRoomMemberStatus;
    createdAt: number;
    updatedAt: number;
}

export interface CreateMultiRoomParams {
    visibility: MultiRoomVisibility;
    publicName?: string;
    name?: string;
}

export interface UpdateMultiRoomIndexParams {
    visibility?: MultiRoomVisibility;
    publicName?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function toMultiRoom(index: MultiRoomIndexRecord, member: MultiRoomMemberRecord): MultiRoom {
    return {
        id: index.id,
        ownerUserId: index.ownerUserId,
        visibility: index.visibility,
        publicName: index.publicName,
        status: member.status,
        createdAt: index.createdAt,
        updatedAt: Math.max(index.updatedAt, member.updatedAt)
    };
}

function toMultiRoomMember(record: MultiRoomMemberRecord): MultiRoomMember {
    return {
        id: record.id,
        roomId: record.roomId,
        userId: record.userId,
        status: record.status,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
    };
}

function assertActiveMember(
    member: MultiRoomMemberRecord | null,
    roomId: string
): MultiRoomMemberRecord {
    if (!member || member.isDeleted) {
        throw new AppError('NOT_FOUND', `Multi membership not found: ${roomId}`);
    }
    if (member.status !== 'accepted') {
        throw new AppError('INVALID_INPUT', `Multi membership is not accepted: ${roomId}`);
    }
    if (!member.encryptedRoomKey) {
        throw new AppError('INVALID_INPUT', `Room key is missing for membership: ${member.id}`);
    }
    return member;
}

async function assertRoomOwner(roomId: string, userId: string): Promise<MultiRoomIndexRecord> {
    const index = await getRoomIndex(roomId);
    if (index.ownerUserId !== userId) {
        throw new AppError('OWNERSHIP_VIOLATION', `Cannot manage shared room: ${roomId}`);
    }
    return index;
}

async function getRoomIndex(roomId: string): Promise<MultiRoomIndexRecord> {
    const index = await appMulti.getRoomIndex(roomId);
    if (!index || index.isDeleted) {
        throw new AppError('NOT_FOUND', `Multi room not found: ${roomId}`);
    }
    return index;
}

function createAcceptedMember(
    roomId: string,
    userId: string,
    encryptedRoomKey: string,
    now: number
): MultiRoomMemberRecord {
    return {
        id: generateId(),
        roomId,
        userId,
        status: 'accepted',
        encryptedRoomKey,
        createdAt: now,
        updatedAt: now,
        isDeleted: false
    };
}

// ─── Service ─────────────────────────────────────────────────────────

export class MultiRoomService {
    static async createRoom(params: CreateMultiRoomParams): Promise<Room> {
        const { userId, identityKeyPair } = getActiveSession();
        const roomId = generateId();
        const roomKey = await generateMasterKey();
        const wrappedRoomKey = await wrapKeyForIdentity(identityKeyPair.publicKey, roomKey);
        const encryptedRoomKey = toBase64(wrappedRoomKey);
        const now = clock.now();

        const index: MultiRoomIndexRecord = {
            id: roomId,
            ownerUserId: userId,
            visibility: params.visibility,
            publicName: params.publicName,
            createdAt: now,
            updatedAt: now,
            isDeleted: false
        };
        const member = createAcceptedMember(roomId, userId, encryptedRoomKey, now);
        const roomData =
            params.name !== undefined || params.publicName !== undefined
                ? { name: params.name ?? params.publicName }
                : {};
        const roomRecord: RoomRecord = {
            id: roomId,
            scopeType: 'room',
            scopeId: roomId,
            createdAt: now,
            updatedAt: now,
            isDeleted: false,
            data: roomData
        };

        await localDB.putRecord<RoomRecord>('rooms', roomRecord);
        await appMulti.saveRoomIndex(index);
        await appMulti.saveMember(member);
        setMultiRoomSession({ roomId, roomKey });
        void SyncManager.refreshRoomSync();

        return { ...parseRoomFields(roomRecord), id: roomId };
    }

    static async openRoom(roomId: string): Promise<MultiRoom> {
        const { userId, identityKeyPair } = getActiveSession();
        const [index, membership] = await Promise.all([
            getRoomIndex(roomId),
            appMulti.getMembership(roomId, userId)
        ]);
        const member = assertActiveMember(membership, roomId);
        const roomKey = await unwrapKeyWithIdentity(
            identityKeyPair.privateKey,
            fromBase64(member.encryptedRoomKey!)
        );
        setMultiRoomSession({ roomId, roomKey });
        void SyncManager.refreshRoomSync();
        return toMultiRoom(index, member);
    }

    static closeRoom(): void {
        clearMultiRoomSession();
        void SyncManager.refreshRoomSync();
    }

    static async getIndex(roomId: string): Promise<MultiRoom> {
        const { userId } = getActiveSession();
        const [index, membership] = await Promise.all([
            getRoomIndex(roomId),
            appMulti.getMembership(roomId, userId)
        ]);
        if (!membership || membership.isDeleted) {
            throw new AppError('NOT_FOUND', `Multi membership not found: ${roomId}`);
        }
        return toMultiRoom(index, membership);
    }

    static async listRooms(): Promise<Room[]> {
        const { userId } = getActiveSession();
        await buffer.flushTable('rooms');

        const memberships = await appMulti.getMembersByUser(userId);
        const roomIds = memberships.filter((m) => m.status === 'accepted').map((m) => m.roomId);

        const records = await Promise.all(
            roomIds.map((member) => buffer.get<RoomRecord>('rooms', member))
        );

        return records
            .filter((record): record is RoomRecord =>
                Boolean(
                    record &&
                    !record.isDeleted &&
                    record.scopeType === 'room' &&
                    record.scopeId === record.id
                )
            )
            .map((record) => ({ ...parseRoomFields(record), id: record.id }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    static async listIndexes(): Promise<MultiRoom[]> {
        const { userId } = getActiveSession();
        const memberships = await appMulti.getMembersByUser(userId);
        const indexes = await appMulti.getRoomIndexes(memberships.map((member) => member.roomId));
        const indexById = new Map(indexes.map((index) => [index.id, index]));
        return memberships
            .map((member) => {
                const index = indexById.get(member.roomId);
                return index ? toMultiRoom(index, member) : null;
            })
            .filter((room): room is MultiRoom => room !== null)
            .sort((a, b) => b.updatedAt - a.updatedAt);
    }

    static async updateIndex(
        roomId: string,
        changes: UpdateMultiRoomIndexParams
    ): Promise<MultiRoom> {
        const { userId } = getActiveSession();
        const [index, membership] = await Promise.all([
            getRoomIndex(roomId),
            appMulti.getMembership(roomId, userId)
        ]);
        if (index.ownerUserId !== userId) {
            throw new AppError('OWNERSHIP_VIOLATION', `Cannot update shared room: ${roomId}`);
        }
        if (!membership || membership.isDeleted) {
            throw new AppError('NOT_FOUND', `Multi membership not found: ${roomId}`);
        }

        const updated: MultiRoomIndexRecord = { ...index, updatedAt: clock.now() };
        if (changes.visibility !== undefined) {
            updated.visibility = changes.visibility;
        }
        if ('publicName' in changes) {
            updated.publicName = changes.publicName;
        }
        await appMulti.saveRoomIndex(updated);
        return toMultiRoom(updated, membership);
    }

    static async inviteMember(
        roomId: string,
        recipientUserId: string,
        recipientPublicKey: CryptoKey
    ): Promise<MultiRoomMember> {
        const { userId, roomId: activeRoomId, roomKey } = getActiveSession();
        await assertRoomOwner(roomId, userId);
        if (recipientUserId === userId) {
            throw new AppError('INVALID_INPUT', 'Cannot invite yourself to your own room');
        }
        if (activeRoomId !== roomId || !roomKey) {
            throw new AppError('INVALID_INPUT', `Multi room is not open: ${roomId}`);
        }

        const id = generateId();
        const now = clock.now();
        const existing = await appMulti.getMembership(roomId, recipientUserId);
        const wrappedRoomKey = await wrapKeyForIdentity(recipientPublicKey, roomKey);

        const member: MultiRoomMemberRecord = {
            id: existing?.id ?? id,
            roomId,
            userId: recipientUserId,
            status: 'accepted',
            encryptedRoomKey: toBase64(wrappedRoomKey),
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            isDeleted: false
        };

        await appMulti.saveMember(member);
        return toMultiRoomMember(member);
    }

    static async revokeMember(roomId: string, targetUserId: string): Promise<void> {
        const { userId } = getActiveSession();
        await assertRoomOwner(roomId, userId);
        if (targetUserId === userId) {
            throw new AppError('INVALID_INPUT', 'Cannot revoke the room owner');
        }
        const member = await appMulti.getMembership(roomId, targetUserId);
        if (!member || member.isDeleted) {
            throw new AppError('NOT_FOUND', `Multi membership not found: ${targetUserId}`);
        }

        await appMulti.saveMember({
            ...member,
            status: 'revoked',
            encryptedRoomKey: undefined,
            updatedAt: clock.now(),
            isDeleted: false
        });
    }

    static async requestJoin(roomId: string): Promise<MultiRoomMember> {
        const { userId } = getActiveSession();
        await getRoomIndex(roomId);

        const id = generateId();
        const now = clock.now();
        const existing = await appMulti.getMembership(roomId, userId);

        if (existing && !existing.isDeleted && existing.status === 'accepted') {
            return toMultiRoomMember(existing);
        }

        const member: MultiRoomMemberRecord = {
            id: existing?.id ?? id,
            roomId,
            userId,
            status: 'pending',
            encryptedRoomKey: undefined,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            isDeleted: false
        };

        await appMulti.saveMember(member);
        return toMultiRoomMember(member);
    }

    static async rejectJoin(roomId: string, targetUserId: string): Promise<void> {
        const { userId } = getActiveSession();
        await assertRoomOwner(roomId, userId);

        const member = await appMulti.getMembership(roomId, targetUserId);
        if (!member || member.isDeleted) {
            throw new AppError('NOT_FOUND', `Multi membership not found: ${targetUserId}`);
        }
        if (member.status !== 'pending') {
            throw new AppError('INVALID_INPUT', `Multi membership is not pending: ${targetUserId}`);
        }

        await appMulti.saveMember({
            ...member,
            status: 'revoked',
            encryptedRoomKey: undefined,
            updatedAt: clock.now(),
            isDeleted: false
        });
    }

    static async listMembers(roomId: string): Promise<MultiRoomMember[]> {
        const { userId } = getActiveSession();
        const membership = await appMulti.getMembership(roomId, userId);
        assertActiveMember(membership, roomId);
        return (await appMulti.getMembersByRoom(roomId))
            .map(toMultiRoomMember)
            .sort((a, b) => a.createdAt - b.createdAt);
    }

    // Unlike deleteUser, deleteRoom is not destructive, but only soft deletes and expect to be synced
    static async deleteRoom(roomId: string): Promise<void> {
        const {
            userId,
            identityKeyPair,
            roomId: activeRoomId,
            roomKey: activeRoomKey
        } = getActiveSession();
        await assertRoomOwner(roomId, userId);
        const roomKey =
            activeRoomId === roomId && activeRoomKey
                ? activeRoomKey
                : await this.getRoomKey(roomId, userId, identityKeyPair.privateKey);
        const rawRoomKey = await exportMasterKeyRaw(roomKey);
        const encodedRoomKey = toBase64(rawRoomKey);
        rawRoomKey.fill(0);

        const now = clock.now();
        await appMulti.saveDeleteMarker({
            roomId,
            roomKey: encodedRoomKey,
            dataDone: false,
            assetDone: false,
            createdAt: now,
            updatedAt: now,
            attempts: 0
        });

        // Purge all asset artifacts for this room
        const roomScope = { scopeType: 'room' as const, scopeId: roomId };
        const [assets, registry] = await Promise.all([
            appAsset.getAllAssets(roomScope),
            appAsset.getAllRegistry(roomScope)
        ]);

        // Soft delete all asset records
        for (const asset of assets) {
            await appAsset.softDeleteAsset(asset.id);
        }

        const ids = new Set<string>([...assets.map((r) => r.id), ...registry.map((r) => r.id)]);
        for (const id of ids) {
            await appStorage.delete(`assets/${id}`).catch(() => undefined);
            await appAsset.deleteRegistry(id, { origin: 'sync' }).catch(() => undefined);
        }

        await Promise.all(TABLES.map((table) => buffer.flushTable(table)));
        const dbPromises = TABLES.map((table) =>
            localDB.softDeleteByIndex(table, 'scopeId', roomId)
        );

        await Promise.all([
            ...dbPromises,
            appMulti.deleteRoomIndex(roomId),
            appMulti.deleteMembersByRoom(roomId)
        ]);

        if (activeRoomId === roomId || !activeRoomKey) {
            clearMultiRoomSession();
            void SyncManager.refreshRoomSync();
        }
    }

    private static async getRoomKey(
        roomId: string,
        userId: string,
        privateKey: CryptoKey
    ): Promise<CryptoKey> {
        const membership = await appMulti.getMembership(roomId, userId);
        const member = assertActiveMember(membership, roomId);
        return unwrapKeyWithIdentity(privateKey, fromBase64(member.encryptedRoomKey!));
    }

    static async leaveRoom(roomId: string): Promise<void> {
        const { userId, roomId: activeRoomId } = getActiveSession();
        const member = await appMulti.getMembership(roomId, userId);
        if (!member || member.isDeleted) return;
        await appMulti.deleteMember(member.id);
        if (activeRoomId === roomId) {
            clearMultiRoomSession();
            void SyncManager.refreshRoomSync();
        }
    }
}
