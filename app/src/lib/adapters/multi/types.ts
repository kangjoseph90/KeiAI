/**
 * Multi-room metadata adapter.
 *
 * Stores only local plaintext metadata needed to discover rooms, track membership,
 * and route encrypted room keys. Room content stays in the normal content DB.
 */

import type { DatabaseMutationOrigin } from '$lib/adapters/db';

export type MultiRoomVisibility = 'public' | 'private';
export type MultiRoomMemberStatus = 'pending' | 'accepted' | 'revoked' | 'left';

export interface MultiRoomIndexRecord {
    id: string; // roomId
    ownerUserId: string;
    visibility: MultiRoomVisibility;
    publicName?: string;
    createdAt: number;
    updatedAt: number;
}

export interface MultiRoomMemberRecord {
    id: string; // membershipId
    roomId: string;
    userId: string;
    status: MultiRoomMemberStatus;
    encryptedRoomKey?: string;
    createdAt: number;
    updatedAt: number;
}

export interface MultiUserKeyTrustRecord {
    userId: string;
    username?: string;
    publicKeyFingerprint: string;
    firstSeenAt: number;
    lastSeenAt: number;
}

export type MultiTableName = 'multi_room_index' | 'multi_room_members';

export type MultiWriteOperation = 'put' | 'putMany' | 'purge';

export interface MultiWriteOptions {
    origin?: DatabaseMutationOrigin;
}

export interface MultiWriteEvent {
    tableName: MultiTableName;
    operation: MultiWriteOperation;
    ids: string[];
    origin: DatabaseMutationOrigin;
}

export type MultiWriteEventListener = (events: MultiWriteEvent[]) => void;

export interface IMultiAdapter {
    subscribeWriteEvents(listener: MultiWriteEventListener): () => void;
    flush(): Promise<void>;

    getRoomIndex(roomId: string): Promise<MultiRoomIndexRecord | null>;
    getRoomIndexes(roomIds: string[]): Promise<MultiRoomIndexRecord[]>;
    getRoomIndexesByOwner(ownerUserId: string): Promise<MultiRoomIndexRecord[]>;
    getRoomIndexesSince(sinceUpdatedAt: number): Promise<MultiRoomIndexRecord[]>;
    saveRoomIndex(record: MultiRoomIndexRecord, options?: MultiWriteOptions): Promise<void>;
    saveRoomIndexes(records: MultiRoomIndexRecord[], options?: MultiWriteOptions): Promise<void>;

    getMember(id: string): Promise<MultiRoomMemberRecord | null>;
    getMembersByUser(userId: string): Promise<MultiRoomMemberRecord[]>;
    getMembersByRoom(roomId: string): Promise<MultiRoomMemberRecord[]>;
    getMembersByRoomsSince(
        roomIds: string[],
        sinceUpdatedAt: number
    ): Promise<MultiRoomMemberRecord[]>;
    getMembership(roomId: string, userId: string): Promise<MultiRoomMemberRecord | null>;
    getMembersSince(userId: string, sinceUpdatedAt: number): Promise<MultiRoomMemberRecord[]>;
    saveMember(record: MultiRoomMemberRecord, options?: MultiWriteOptions): Promise<void>;
    saveMembers(records: MultiRoomMemberRecord[], options?: MultiWriteOptions): Promise<void>;

    getUserKeyTrust(userId: string): Promise<MultiUserKeyTrustRecord | null>;
    saveUserKeyTrust(record: MultiUserKeyTrustRecord): Promise<void>;

    /** Remove all local metadata for a room. This is cache cleanup, not a server delete intent. */
    purgeRoomLocal(roomId: string, options?: MultiWriteOptions): Promise<void>;

    /** Remove a user's local memberships and any room indexes that become unreferenced. */
    purgeUserLocal(userId: string, options?: MultiWriteOptions): Promise<void>;
}
