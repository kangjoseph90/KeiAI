import type { LocalUpdateClock } from '../local-updates';
import { putLocalUpdates } from '../local-updates/web';
import Dexie from 'dexie';
import { MultiWriteEventEmitter } from './events';
import type {
    IMultiAdapter,
    MultiRoomIndexRecord,
    MultiRoomMemberRecord,
    MultiTableName,
    MultiUserKeyTrustRecord,
    MultiWriteEventListener,
    MultiWriteOperation,
    MultiWriteOptions
} from './types';

class MultiDexie extends Dexie {
    localUpdates!: Dexie.Table<LocalUpdateClock, string>;
    roomIndex!: Dexie.Table<MultiRoomIndexRecord, string>;
    members!: Dexie.Table<MultiRoomMemberRecord, string>;
    userKeyTrust!: Dexie.Table<MultiUserKeyTrustRecord, string>;

    constructor() {
        super('KeiMulti');
        this.version(1).stores({
            localUpdates: 'id',
            roomIndex:
                'id, ownerUserId, [ownerUserId+localUpdatedAt], localUpdatedAt, visibility, publicName',
            members:
                'id, roomId, userId, [roomId+userId], [userId+localUpdatedAt], [roomId+localUpdatedAt], localUpdatedAt, status'
        });
        this.version(2).stores({
            roomIndex:
                'id, ownerUserId, [ownerUserId+localUpdatedAt], localUpdatedAt, visibility, publicName',
            members:
                'id, roomId, userId, [roomId+userId], [userId+localUpdatedAt], [roomId+localUpdatedAt], localUpdatedAt, status',
            userKeyTrust: 'userId, username, publicKeyFingerprint, lastSeenAt'
        });
    }
}

export const multiDB = new MultiDexie();

export class WebMultiAdapter implements IMultiAdapter {
    private readonly writeEvents = new MultiWriteEventEmitter();

    subscribeWriteEvents(listener: MultiWriteEventListener): () => void {
        return this.writeEvents.subscribe(listener);
    }

    async getLocalUpdateUpper(): Promise<number> {
        return (await multiDB.localUpdates.get('clock'))?.value ?? 0;
    }

    flush(): Promise<void> {
        return Promise.resolve();
    }

    private emitWriteEvent(
        tableName: MultiTableName,
        operation: MultiWriteOperation,
        ids: string[],
        options?: MultiWriteOptions
    ): void {
        if (ids.length === 0) return;
        this.writeEvents.emit({
            tableName,
            operation,
            ids,
            origin: options?.origin ?? 'local'
        });
    }

    async getRoomIndex(roomId: string): Promise<MultiRoomIndexRecord | null> {
        return (await multiDB.roomIndex.get(roomId)) ?? null;
    }

    async getRoomIndexes(roomIds: string[]): Promise<MultiRoomIndexRecord[]> {
        if (roomIds.length === 0) return [];
        return (await multiDB.roomIndex.bulkGet(roomIds)).filter(
            (record): record is MultiRoomIndexRecord => Boolean(record)
        );
    }

    async getRoomIndexesByOwner(ownerUserId: string): Promise<MultiRoomIndexRecord[]> {
        return await multiDB.roomIndex.where('ownerUserId').equals(ownerUserId).toArray();
    }

    async getRoomIndexesBetween(
        afterLocalUpdatedAt: number,
        throughLocalUpdatedAt: number
    ): Promise<MultiRoomIndexRecord[]> {
        return await multiDB.roomIndex
            .where('localUpdatedAt')
            .between(afterLocalUpdatedAt, throughLocalUpdatedAt, false, true)
            .toArray();
    }

    async saveRoomIndex(record: MultiRoomIndexRecord, options?: MultiWriteOptions): Promise<void> {
        const ids = await multiDB.transaction('rw', multiDB.roomIndex, multiDB.localUpdates, () =>
            putLocalUpdates(multiDB.roomIndex, multiDB.localUpdates, [record])
        );
        this.emitWriteEvent('multi_room_index', 'put', ids, options);
    }

    async saveRoomIndexes(
        records: MultiRoomIndexRecord[],
        options?: MultiWriteOptions
    ): Promise<void> {
        if (records.length === 0) return;
        const ids = await multiDB.transaction('rw', multiDB.roomIndex, multiDB.localUpdates, () =>
            putLocalUpdates(multiDB.roomIndex, multiDB.localUpdates, records)
        );
        this.emitWriteEvent('multi_room_index', 'putMany', ids, options);
    }

    async getMember(id: string): Promise<MultiRoomMemberRecord | null> {
        return (await multiDB.members.get(id)) ?? null;
    }

    async getMembersByUser(userId: string): Promise<MultiRoomMemberRecord[]> {
        return await multiDB.members.where('userId').equals(userId).toArray();
    }

    async getMembersByRoom(roomId: string): Promise<MultiRoomMemberRecord[]> {
        return await multiDB.members.where('roomId').equals(roomId).toArray();
    }

    async getMembersByRoomsBetween(
        roomIds: string[],
        afterLocalUpdatedAt: number,
        throughLocalUpdatedAt: number
    ): Promise<MultiRoomMemberRecord[]> {
        if (roomIds.length === 0) return [];
        const roomIdSet = new Set(roomIds);
        return await multiDB.members
            .where('localUpdatedAt')
            .between(afterLocalUpdatedAt, throughLocalUpdatedAt, false, true)
            .filter((record) => roomIdSet.has(record.roomId))
            .toArray();
    }

    async getMembership(roomId: string, userId: string): Promise<MultiRoomMemberRecord | null> {
        return (
            (await multiDB.members.where('[roomId+userId]').equals([roomId, userId]).first()) ??
            null
        );
    }

    async getMembersBetween(
        userId: string,
        afterLocalUpdatedAt: number,
        throughLocalUpdatedAt: number
    ): Promise<MultiRoomMemberRecord[]> {
        return await multiDB.members
            .where('[userId+localUpdatedAt]')
            .between([userId, afterLocalUpdatedAt], [userId, throughLocalUpdatedAt], false, true)
            .toArray();
    }

    async saveMember(record: MultiRoomMemberRecord, options?: MultiWriteOptions): Promise<void> {
        const ids = await multiDB.transaction('rw', multiDB.members, multiDB.localUpdates, () =>
            putLocalUpdates(multiDB.members, multiDB.localUpdates, [record])
        );
        this.emitWriteEvent('multi_room_members', 'put', ids, options);
    }

    async saveMembers(
        records: MultiRoomMemberRecord[],
        options?: MultiWriteOptions
    ): Promise<void> {
        if (records.length === 0) return;
        const ids = await multiDB.transaction('rw', multiDB.members, multiDB.localUpdates, () =>
            putLocalUpdates(multiDB.members, multiDB.localUpdates, records)
        );
        this.emitWriteEvent('multi_room_members', 'putMany', ids, options);
    }

    async getUserKeyTrust(userId: string): Promise<MultiUserKeyTrustRecord | null> {
        return (await multiDB.userKeyTrust.get(userId)) ?? null;
    }

    async saveUserKeyTrust(record: MultiUserKeyTrustRecord): Promise<void> {
        await multiDB.userKeyTrust.put(record);
    }

    async purgeRoomLocal(roomId: string, options?: MultiWriteOptions): Promise<void> {
        const members = await multiDB.members.where('roomId').equals(roomId).toArray();
        await multiDB.transaction('rw', multiDB.roomIndex, multiDB.members, async () => {
            await multiDB.roomIndex.delete(roomId);
            await multiDB.members.where('roomId').equals(roomId).delete();
        });
        this.emitWriteEvent(
            'multi_room_members',
            'purge',
            members.map((member) => member.id),
            options
        );
        this.emitWriteEvent('multi_room_index', 'purge', [roomId], options);
    }

    async purgeUserLocal(userId: string, options?: MultiWriteOptions): Promise<void> {
        const memberships = await multiDB.members.where('userId').equals(userId).toArray();
        if (memberships.length === 0) return;

        const roomIds = [...new Set(memberships.map((member) => member.roomId))];
        const orphanedRoomIds: string[] = [];

        await multiDB.transaction('rw', multiDB.roomIndex, multiDB.members, async () => {
            await multiDB.members.where('userId').equals(userId).delete();

            for (const roomId of roomIds) {
                const remaining = await multiDB.members.where('roomId').equals(roomId).count();
                if (remaining === 0) {
                    await multiDB.roomIndex.delete(roomId);
                    orphanedRoomIds.push(roomId);
                }
            }
        });

        this.emitWriteEvent(
            'multi_room_members',
            'purge',
            memberships.map((member) => member.id),
            options
        );
        if (orphanedRoomIds.length > 0) {
            this.emitWriteEvent('multi_room_index', 'purge', orphanedRoomIds, options);
        }
    }
}
