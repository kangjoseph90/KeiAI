import Dexie from 'dexie';
import { clock } from '$lib/utils/clock';
import { MultiWriteEventEmitter } from './events';
import type {
    IMultiAdapter,
    MultiRoomDeleteMarkerRecord,
    MultiRoomIndexRecord,
    MultiRoomMemberRecord,
    MultiTableName,
    MultiWriteEventListener,
    MultiWriteOperation,
    MultiWriteOptions
} from './types';

class MultiDexie extends Dexie {
    roomIndex!: Dexie.Table<MultiRoomIndexRecord, string>;
    members!: Dexie.Table<MultiRoomMemberRecord, string>;
    deleteMarkers!: Dexie.Table<MultiRoomDeleteMarkerRecord, string>;

    constructor() {
        super('KeiMulti');
        this.version(1).stores({
            roomIndex:
                'id, ownerUserId, [ownerUserId+updatedAt], updatedAt, isDeleted, visibility, publicName',
            members:
                'id, roomId, userId, [roomId+userId], [userId+updatedAt], [roomId+updatedAt], updatedAt, status, isDeleted',
            deleteMarkers: 'roomId, updatedAt, attempts'
        });
    }
}

export const multiDB = new MultiDexie();

export class WebMultiAdapter implements IMultiAdapter {
    private readonly writeEvents = new MultiWriteEventEmitter();

    subscribeWriteEvents(listener: MultiWriteEventListener): () => void {
        return this.writeEvents.subscribe(listener);
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
            (record): record is MultiRoomIndexRecord => Boolean(record && !record.isDeleted)
        );
    }

    async getRoomIndexesByOwner(ownerUserId: string): Promise<MultiRoomIndexRecord[]> {
        return await multiDB.roomIndex.where('ownerUserId').equals(ownerUserId).toArray();
    }

    async getRoomIndexesSince(sinceUpdatedAt: number): Promise<MultiRoomIndexRecord[]> {
        return await multiDB.roomIndex.where('updatedAt').above(sinceUpdatedAt).toArray();
    }

    async saveRoomIndex(record: MultiRoomIndexRecord, options?: MultiWriteOptions): Promise<void> {
        await multiDB.roomIndex.put(record);
        this.emitWriteEvent('multi_room_index', 'put', [record.id], options);
    }

    async saveRoomIndexes(
        records: MultiRoomIndexRecord[],
        options?: MultiWriteOptions
    ): Promise<void> {
        if (records.length === 0) return;
        await multiDB.roomIndex.bulkPut(records);
        this.emitWriteEvent(
            'multi_room_index',
            'putMany',
            records.map((record) => record.id),
            options
        );
    }

    async deleteRoomIndex(roomId: string, options?: MultiWriteOptions): Promise<void> {
        const record = await this.getRoomIndex(roomId);
        if (!record) return;
        await multiDB.roomIndex.put({
            ...record,
            updatedAt: clock.now(),
            isDeleted: true
        });
        this.emitWriteEvent('multi_room_index', 'softDelete', [roomId], options);
    }

    async getMember(id: string): Promise<MultiRoomMemberRecord | null> {
        return (await multiDB.members.get(id)) ?? null;
    }

    async getMembersByUser(userId: string): Promise<MultiRoomMemberRecord[]> {
        return await multiDB.members
            .where('userId')
            .equals(userId)
            .filter((record) => !record.isDeleted)
            .toArray();
    }

    async getMembersByRoom(roomId: string): Promise<MultiRoomMemberRecord[]> {
        return await multiDB.members
            .where('roomId')
            .equals(roomId)
            .filter((record) => !record.isDeleted)
            .toArray();
    }

    async getMembersByRoomsSince(
        roomIds: string[],
        sinceUpdatedAt: number
    ): Promise<MultiRoomMemberRecord[]> {
        if (roomIds.length === 0) return [];
        const roomIdSet = new Set(roomIds);
        return await multiDB.members
            .where('updatedAt')
            .above(sinceUpdatedAt)
            .filter((record) => roomIdSet.has(record.roomId))
            .toArray();
    }

    async getMembership(roomId: string, userId: string): Promise<MultiRoomMemberRecord | null> {
        return (
            (await multiDB.members.where('[roomId+userId]').equals([roomId, userId]).first()) ??
            null
        );
    }

    async getMembersSince(
        userId: string,
        sinceUpdatedAt: number
    ): Promise<MultiRoomMemberRecord[]> {
        return await multiDB.members
            .where('[userId+updatedAt]')
            .between([userId, sinceUpdatedAt], [userId, Dexie.maxKey], false, true)
            .toArray();
    }

    async saveMember(record: MultiRoomMemberRecord, options?: MultiWriteOptions): Promise<void> {
        await multiDB.members.put(record);
        this.emitWriteEvent('multi_room_members', 'put', [record.id], options);
    }

    async saveMembers(
        records: MultiRoomMemberRecord[],
        options?: MultiWriteOptions
    ): Promise<void> {
        if (records.length === 0) return;
        await multiDB.members.bulkPut(records);
        this.emitWriteEvent(
            'multi_room_members',
            'putMany',
            records.map((record) => record.id),
            options
        );
    }

    async deleteMember(id: string, options?: MultiWriteOptions): Promise<void> {
        const record = await this.getMember(id);
        if (!record) return;
        await multiDB.members.put({
            ...record,
            updatedAt: clock.now(),
            isDeleted: true
        });
        this.emitWriteEvent('multi_room_members', 'softDelete', [id], options);
    }

    async deleteMembersByRoom(roomId: string, options?: MultiWriteOptions): Promise<void> {
        const members = await multiDB.members.where('roomId').equals(roomId).toArray();
        if (members.length === 0) return;

        const now = clock.now();
        const updatedMembers = members.map((m) => ({
            ...m,
            updatedAt: now,
            isDeleted: true
        }));

        await multiDB.members.bulkPut(updatedMembers);
        this.emitWriteEvent(
            'multi_room_members',
            'softDelete',
            updatedMembers.map((m) => m.id),
            options
        );
    }

    async getDeleteMarkers(): Promise<MultiRoomDeleteMarkerRecord[]> {
        return await multiDB.deleteMarkers.orderBy('updatedAt').toArray();
    }

    async getDeleteMarker(roomId: string): Promise<MultiRoomDeleteMarkerRecord | null> {
        return (await multiDB.deleteMarkers.get(roomId)) ?? null;
    }

    async saveDeleteMarker(record: MultiRoomDeleteMarkerRecord): Promise<void> {
        await multiDB.deleteMarkers.put(record);
    }

    async deleteDeleteMarker(roomId: string): Promise<void> {
        await multiDB.deleteMarkers.delete(roomId);
    }

    async purgeRoomLocal(roomId: string, options?: MultiWriteOptions): Promise<void> {
        const members = await multiDB.members.where('roomId').equals(roomId).toArray();
        await multiDB.transaction(
            'rw',
            multiDB.roomIndex,
            multiDB.members,
            multiDB.deleteMarkers,
            async () => {
                await multiDB.roomIndex.delete(roomId);
                await multiDB.members.where('roomId').equals(roomId).delete();
                await multiDB.deleteMarkers.delete(roomId);
            }
        );
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

        await multiDB.transaction(
            'rw',
            multiDB.roomIndex,
            multiDB.members,
            multiDB.deleteMarkers,
            async () => {
                await multiDB.members.where('userId').equals(userId).delete();

                for (const roomId of roomIds) {
                    const remaining = await multiDB.members.where('roomId').equals(roomId).count();
                    if (remaining === 0) {
                        await multiDB.roomIndex.delete(roomId);
                        await multiDB.deleteMarkers.delete(roomId);
                        orphanedRoomIds.push(roomId);
                    }
                }
            }
        );

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

export const webMulti = new WebMultiAdapter();
