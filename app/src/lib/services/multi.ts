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
    fingerprintIdentityPublicKey,
    generateMasterKey,
    importPublicKey,
    unwrapKeyWithIdentity,
    wrapKeyForIdentity,
    toBase64,
    exportPublicKey
} from '$lib/crypto';
import { AppError } from '$lib/types/errors';
import { clock } from '$lib/utils/clock';
import { generateId } from '$lib/utils/id';
import { clearMultiRoomSession, getActiveSession, setMultiRoomSession } from './session';
import { buffer } from './content/record_buffer';
import { parseFields as parseRoomFields, type Room } from './content/room';
import { appHttp } from '$lib/adapters/http';
import { pb } from '$lib/adapters/pb';
import { MultiRecordSyncEngine, SyncManager } from './sync';
import { buildUrl } from '$lib/utils/url';
import { createLogger } from '$lib/adapters/logger';
import { AssetService } from './asset';

const logger = createLogger('service:multi');

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

export interface PublicMultiRoom {
    id: string;
    ownerUserId: string;
    visibility: 'public';
    publicName?: string;
    createdAt: number;
    updatedAt: number;
}

export interface UserPublicKey {
    userId: string;
    username: string;
    identityPublicKey: JsonWebKey;
}

export interface UserKeyTrust {
    userId: string;
    username?: string;
    publicKeyFingerprint: string;
    firstSeenAt: number;
    lastSeenAt: number;
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

type MultiRoomApiResponse = {
    room?: MultiRoomIndexRecord;
    rooms?: PublicMultiRoom[];
    member?: MultiRoomMemberRecord;
    user?: UserPublicKey;
    error?: string;
};

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
    if (!member) {
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
    if (!index) {
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
        updatedAt: now
    };
}

function authHeaders(): Record<string, string> {
    return pb.authStore.token ? { Authorization: pb.authStore.token } : {};
}

async function multiRoomApi(
    method: 'POST' | 'DELETE',
    path: string,
    allowNotFound = false
): Promise<MultiRoomApiResponse> {
    const response = await appHttp.fetch(buildUrl(pb.baseUrl, path), {
        method,
        headers: authHeaders()
    });
    const body = (await response.json().catch(() => ({}))) as MultiRoomApiResponse;
    if (response.status === 404 && allowNotFound) return body;
    if (!response.ok) {
        throw new AppError(
            response.status === 401 || response.status === 403
                ? 'NOT_AUTHENTICATED'
                : 'NETWORK_ERROR',
            body.error ?? `Multi-room API failed: ${response.status}`
        );
    }
    return body;
}

async function getJson<T>(path: string): Promise<T> {
    const response = await appHttp.fetch(buildUrl(pb.baseUrl, path), {
        method: 'GET',
        headers: authHeaders()
    });
    const body = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) {
        throw new AppError(
            response.status === 401 || response.status === 403
                ? 'NOT_AUTHENTICATED'
                : response.status === 404
                  ? 'NOT_FOUND'
                  : 'NETWORK_ERROR',
            body.error ?? `Multi-room API failed: ${response.status}`
        );
    }
    return body;
}

// ─── Service ─────────────────────────────────────────────────────────

export class MultiRoomService {
    static async searchPublicRooms(name = ''): Promise<PublicMultiRoom[]> {
        const params = name.trim() ? `?name=${encodeURIComponent(name.trim())}` : '';
        const result = await getJson<{ rooms?: PublicMultiRoom[] }>(
            `/api/multi-rooms/search${params}`
        );
        return result.rooms ?? [];
    }

    static async getUserPublicKey(userId: string): Promise<UserPublicKey> {
        const result = await getJson<UserPublicKey>(
            `/api/users/${encodeURIComponent(userId)}/public-key`
        );
        return result;
    }

    static async getUserKeyTrust(userId: string): Promise<UserKeyTrust | null> {
        return await appMulti.getUserKeyTrust(userId);
    }

    static async trustUserPublicKey(user: UserPublicKey, fingerprint: string): Promise<void> {
        const existing = await appMulti.getUserKeyTrust(user.userId);
        const now = clock.now();
        await appMulti.saveUserKeyTrust({
            userId: user.userId,
            username: user.username,
            publicKeyFingerprint: fingerprint,
            firstSeenAt: existing?.firstSeenAt ?? now,
            lastSeenAt: now
        });
    }

    static async fingerprintUserPublicKey(user: UserPublicKey): Promise<string> {
        return fingerprintIdentityPublicKey(user.identityPublicKey);
    }

    static async getOwnPublicKeyFingerprint(): Promise<string> {
        const { identityKeyPair } = getActiveSession();
        return fingerprintIdentityPublicKey(await exportPublicKey(identityKeyPair.publicKey));
    }

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
            updatedAt: now
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

        await appMulti.saveRoomIndex(index);
        await appMulti.saveMember(member);
        setMultiRoomSession({ roomId, roomKey });
        await MultiRecordSyncEngine.trigger();
        await localDB.putRecord<RoomRecord>('rooms', roomRecord);
        void SyncManager.refreshRoomSync();

        return {
            ...parseRoomFields(roomRecord),
            id: roomId,
            scopeType: roomRecord.scopeType,
            scopeId: roomRecord.scopeId
        };
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
        await SyncManager.refreshRoomSync();
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
        if (!membership) {
            throw new AppError('NOT_FOUND', `Multi membership not found: ${roomId}`);
        }
        return toMultiRoom(index, membership);
    }

    static async listRooms(): Promise<Room[]> {
        const { userId } = getActiveSession();
        await buffer.flushTable('rooms');

        const memberships = await appMulti.getMembersByUser(userId);
        const roomIds = memberships.filter((m) => m.status === 'accepted').map((m) => m.roomId);

        const [indexes, records] = await Promise.all([
            appMulti.getRoomIndexes(roomIds),
            Promise.all(roomIds.map((roomId) => buffer.get<RoomRecord>('rooms', roomId)))
        ]);
        const indexById = new Map(indexes.map((index) => [index.id, index]));

        const rooms: Room[] = [];
        for (let i = 0; i < roomIds.length; i++) {
            const roomId = roomIds[i];
            const record = records[i];
            if (
                record &&
                !record.isDeleted &&
                record.scopeType === 'room' &&
                record.scopeId === record.id
            ) {
                rooms.push({
                    ...parseRoomFields(record),
                    id: record.id,
                    scopeType: record.scopeType,
                    scopeId: record.scopeId
                });
                continue;
            }

            const meta = indexById.get(roomId);
            if (meta) {
                rooms.push({
                    name: meta.publicName ?? meta.id,
                    chats: { refs: {}, folders: {} },
                    characters: { refs: {}, folders: {} },
                    id: meta.id,
                    scopeType: 'room' as const,
                    scopeId: meta.id
                });
            }
        }

        return rooms.sort((a, b) => a.name.localeCompare(b.name));
    }

    static async listIndexes(): Promise<MultiRoom[]> {
        const { userId } = getActiveSession();
        const memberships = await appMulti.getMembersByUser(userId);
        const acceptedMemberships = memberships.filter((member) => member.status === 'accepted');
        const indexes = await appMulti.getRoomIndexes(
            acceptedMemberships.map((member) => member.roomId)
        );
        const indexById = new Map(indexes.map((index) => [index.id, index]));
        return acceptedMemberships
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
        if (!membership) {
            throw new AppError('NOT_FOUND', `Multi membership not found: ${roomId}`);
        }

        const hasChange =
            (changes.visibility !== undefined && changes.visibility !== index.visibility) ||
            ('publicName' in changes && changes.publicName !== index.publicName);
        if (!hasChange) {
            return toMultiRoom(index, membership);
        }

        const updated: MultiRoomIndexRecord = { ...index, updatedAt: clock.now() };
        if (changes.visibility !== undefined) {
            updated.visibility = changes.visibility;
        }
        if ('publicName' in changes) {
            updated.publicName = changes.publicName;
        }
        await appMulti.saveRoomIndex(updated);
        await MultiRecordSyncEngine.trigger();
        return toMultiRoom(updated, membership);
    }

    static async approveJoinRequest(
        roomId: string,
        recipientUserId: string,
        recipientPublicKey: CryptoKey
    ): Promise<MultiRoomMember> {
        const { userId, identityKeyPair } = getActiveSession();
        await assertRoomOwner(roomId, userId);
        if (recipientUserId === userId) {
            throw new AppError('INVALID_INPUT', 'Cannot approve your own join request');
        }

        const now = clock.now();
        const [ownerMembership, existing] = await Promise.all([
            appMulti.getMembership(roomId, userId),
            appMulti.getMembership(roomId, recipientUserId)
        ]);
        const ownerMember = assertActiveMember(ownerMembership, roomId);
        if (!existing || existing.status !== 'pending') {
            throw new AppError(
                'INVALID_INPUT',
                `Multi membership is not pending: ${recipientUserId}`
            );
        }
        const roomKey = await unwrapKeyWithIdentity(
            identityKeyPair.privateKey,
            fromBase64(ownerMember.encryptedRoomKey!)
        );
        const wrappedRoomKey = await wrapKeyForIdentity(recipientPublicKey, roomKey);

        const member: MultiRoomMemberRecord = {
            id: existing.id,
            roomId,
            userId: recipientUserId,
            status: 'accepted',
            encryptedRoomKey: toBase64(wrappedRoomKey),
            createdAt: existing.createdAt,
            updatedAt: now
        };

        await appMulti.saveMember(member);
        await MultiRecordSyncEngine.trigger();
        return toMultiRoomMember(member);
    }

    static async importUserPublicKey(user: UserPublicKey): Promise<CryptoKey> {
        return importPublicKey(user.identityPublicKey);
    }

    static async revokeMember(roomId: string, targetUserId: string): Promise<void> {
        const { userId } = getActiveSession();
        await assertRoomOwner(roomId, userId);
        if (targetUserId === userId) {
            throw new AppError('INVALID_INPUT', 'Cannot revoke the room owner');
        }
        const member = await appMulti.getMembership(roomId, targetUserId);
        if (!member) {
            throw new AppError('NOT_FOUND', `Multi membership not found: ${targetUserId}`);
        }

        await appMulti.saveMember({
            ...member,
            status: 'revoked',
            encryptedRoomKey: undefined,
            updatedAt: clock.now()
        });
        await MultiRecordSyncEngine.trigger();
    }

    static async requestJoin(roomId: string): Promise<MultiRoomMember> {
        const result = await multiRoomApi(
            'POST',
            `/api/multi-rooms/${encodeURIComponent(roomId)}/join-request`
        );
        if (!result.member) {
            throw new AppError('NETWORK_ERROR', 'Join request did not return a membership.');
        }
        const member = result.member;
        await appMulti.saveMember(member, { origin: 'sync' });
        return toMultiRoomMember(member);
    }

    static async rejectJoin(roomId: string, targetUserId: string): Promise<void> {
        const { userId } = getActiveSession();
        await assertRoomOwner(roomId, userId);

        const member = await appMulti.getMembership(roomId, targetUserId);
        if (!member) {
            throw new AppError('NOT_FOUND', `Multi membership not found: ${targetUserId}`);
        }
        if (member.status !== 'pending') {
            throw new AppError('INVALID_INPUT', `Multi membership is not pending: ${targetUserId}`);
        }

        await appMulti.saveMember({
            ...member,
            status: 'revoked',
            encryptedRoomKey: undefined,
            updatedAt: clock.now()
        });
        await MultiRecordSyncEngine.trigger();
    }

    static async listMembers(roomId: string): Promise<MultiRoomMember[]> {
        const { userId } = getActiveSession();
        const membership = await appMulti.getMembership(roomId, userId);
        assertActiveMember(membership, roomId);
        return (await appMulti.getMembersByRoom(roomId))
            .map(toMultiRoomMember)
            .sort((a, b) => a.createdAt - b.createdAt);
    }

    static async deleteRoom(roomId: string): Promise<void> {
        const { userId } = getActiveSession();
        await assertRoomOwner(roomId, userId);
        await multiRoomApi('DELETE', `/api/multi-rooms/${encodeURIComponent(roomId)}`, true);
        await appMulti.purgeRoomLocal(roomId, { origin: 'sync' });
        await this.purgeLocalRoomContent(roomId);
    }

    static async purgeInaccessibleRoomContent(): Promise<void> {
        const { userId } = getActiveSession();
        const memberships = await appMulti.getMembersByUser(userId);
        const roomIds = Array.from(new Set(memberships.map((member) => member.roomId)));
        const indexes = await appMulti.getRoomIndexes(roomIds);
        const accessibleRoomIds = new Set(indexes.map((index) => index.id));
        const purgeRoomIds = new Set<string>();

        for (const member of memberships) {
            if (member.status !== 'accepted' || !accessibleRoomIds.has(member.roomId)) {
                purgeRoomIds.add(member.roomId);
            }
        }

        for (const roomId of purgeRoomIds) {
            try {
                await this.purgeLocalRoomContent(roomId);
            } catch (error) {
                logger.error(`Failed to purge inaccessible multi room content: ${roomId}`, error);
            }
        }
    }

    static async purgeLocalRoomContent(roomId: string): Promise<void> {
        const roomScope = { scopeType: 'room' as const, scopeId: roomId };
        await AssetService.deleteScopeAssets(roomScope);

        await Promise.all(TABLES.map((table) => buffer.flushTable(table)));
        await Promise.all(TABLES.map((table) => localDB.deleteByIndex(table, 'scopeId', roomId)));

        if (getActiveSession().roomId === roomId) {
            clearMultiRoomSession();
            void SyncManager.refreshRoomSync();
        }
    }

    static async leaveRoom(roomId: string): Promise<void> {
        const { userId } = getActiveSession();
        const result = await multiRoomApi(
            'POST',
            `/api/multi-rooms/${encodeURIComponent(roomId)}/leave`,
            true
        );
        if (result.member) {
            await appMulti.saveMember(result.member, { origin: 'sync' });
        } else {
            // Room already deleted or membership gone — mark local as left
            const local = await appMulti.getMembership(roomId, userId);
            if (local && local.status !== 'left') {
                await appMulti.saveMember(
                    {
                        ...local,
                        status: 'left',
                        encryptedRoomKey: undefined,
                        updatedAt: clock.now()
                    },
                    { origin: 'sync' }
                );
            }
        }
        await this.purgeLocalRoomContent(roomId);
    }
}
