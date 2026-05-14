/**
 * Multi Sync Service
 *
 * Syncs plaintext multi-room metadata with PocketBase:
 * - multi_room_index
 * - multi_room_members
 *
 * This data is not E2EE. Room content and assets stay in DataSync/AssetSync.
 */

import { pb } from '$lib/adapters/pb';
import {
    appMulti,
    type MultiRoomIndexRecord,
    type MultiRoomMemberRecord,
    type MultiWriteEvent
} from '$lib/adapters/multi';
import { appKV } from '$lib/adapters/kv';
import { getActiveSession, hasActiveSession } from '../session';
import { BaseSyncEngine } from './base';
import { createLogger } from '$lib/adapters/logger';
import { isErrorCode } from '$lib/types/errors';

type MultiCollection = 'multi_room_index' | 'multi_room_members';

type RealtimeEvent = {
    action: string;
    record: Record<string, unknown>;
};

const logger = createLogger('sync:multi');
const SYNC_KEY_PREFIX = 'lastSync_multi_meta_';
const PAGE_SIZE = 200;
const CHUNK_SIZE = 100;

export class MultiSyncEngine extends BaseSyncEngine {
    private subscribed = false;
    private syncing = false;
    private pendingQueue: Array<() => Promise<void>> = [];

    constructor() {
        super();
    }

    get isSubscribed(): boolean {
        return this.subscribed;
    }

    async syncAll(): Promise<void> {
        await this.trigger();
    }

    async subscribeRealtime(): Promise<void> {
        if (!pb.authStore.isValid || !hasActiveSession()) return;

        await this.unsubscribeRealtime();
        await pb.collection('multi_room_index').subscribe('*', (event) => {
            void this.handleRealtimeEvent('multi_room_index', event as unknown as RealtimeEvent);
        });
        await pb.collection('multi_room_members').subscribe('*', (event) => {
            void this.handleRealtimeEvent('multi_room_members', event as unknown as RealtimeEvent);
        });
        this.subscribed = true;
    }

    async unsubscribeRealtime(): Promise<void> {
        for (const collection of ['multi_room_index', 'multi_room_members'] as const) {
            try {
                await pb.collection(collection).unsubscribe('*');
            } catch {
                // Already unsubscribed or offline.
            }
        }
        this.subscribed = false;
    }

    async resetCursor(userId: string): Promise<void> {
        await appKV.remove(`${SYNC_KEY_PREFIX}${userId}`);
    }

    protected override async performSync(): Promise<void> {
        if (!pb.authStore.isValid || !hasActiveSession()) return;
        const { userId } = getActiveSession();

        this.syncing = true;
        try {
            await this.syncMeta(userId);
        } finally {
            this.syncing = false;
            void this.flushPendingQueue();
        }
    }

    private async syncMeta(userId: string): Promise<void> {
        const syncKey = `${SYNC_KEY_PREFIX}${userId}`;
        const lastSyncTime = Number.parseInt((await appKV.get(syncKey)) || '0', 10) || 0;
        let nextCursor = lastSyncTime;
        let cursorSafeToAdvance = true;
        let syncError: unknown = null;
        let correctionError: unknown = null;

        try {
            const pulledIndexCursor = await this.pullRoomIndexes(lastSyncTime);
            const pulledMemberCursor = await this.pullMembers(lastSyncTime);
            nextCursor = Math.max(nextCursor, pulledIndexCursor, pulledMemberCursor);
        } catch (error) {
            cursorSafeToAdvance = false;
            syncError = error;
            logger.error('Failed to pull multi metadata', error);
        }

        try {
            const pushedCursor = await this.pushLocalChanges(userId, lastSyncTime - 1, false);
            nextCursor = Math.max(nextCursor, pushedCursor);
        } catch (error) {
            correctionError = error;
        }

        if (cursorSafeToAdvance && !correctionError && nextCursor > lastSyncTime) {
            await appKV.set(syncKey, nextCursor.toString());
        }

        if (syncError) throw syncError;
        if (correctionError) throw correctionError;
    }

    private async pullRoomIndexes(sinceUpdatedAt: number): Promise<number> {
        let page = 1;
        let nextCursor = sinceUpdatedAt;

        while (true) {
            const result = await pb.collection('multi_room_index').getList(page, PAGE_SIZE, {
                filter: pb.filter('updatedAt >= {:since}', { since: sinceUpdatedAt }),
                sort: 'updatedAt'
            });

            for (const item of result.items) {
                const remote = this.pbToRoomIndex(item as unknown as Record<string, unknown>);
                const local = await appMulti.getRoomIndex(remote.id);
                if (!local || remote.updatedAt > local.updatedAt) {
                    await appMulti.saveRoomIndex(remote, { origin: 'sync' });
                } else if (local.updatedAt > remote.updatedAt) {
                    await this.pushRoomIndexes([local], false);
                }
                nextCursor = Math.max(nextCursor, remote.updatedAt);
            }

            if (result.page >= result.totalPages) break;
            page++;
        }

        return nextCursor;
    }

    private async pullMembers(sinceUpdatedAt: number): Promise<number> {
        let page = 1;
        let nextCursor = sinceUpdatedAt;

        while (true) {
            const result = await pb.collection('multi_room_members').getList(page, PAGE_SIZE, {
                filter: pb.filter('updatedAt >= {:since}', { since: sinceUpdatedAt }),
                sort: 'updatedAt'
            });

            for (const item of result.items) {
                const remote = this.pbToMember(item as unknown as Record<string, unknown>);
                const local = await appMulti.getMember(remote.id);
                if (!local || remote.updatedAt > local.updatedAt) {
                    await appMulti.saveMember(remote, { origin: 'sync' });
                } else if (local.updatedAt > remote.updatedAt) {
                    await this.pushMembers([local], false);
                }
                nextCursor = Math.max(nextCursor, remote.updatedAt);
            }

            if (result.page >= result.totalPages) break;
            page++;
        }

        return nextCursor;
    }

    private async pushLocalChanges(
        userId: string,
        sinceUpdatedAt: number,
        swallowErrors: boolean
    ): Promise<number> {
        let nextCursor = sinceUpdatedAt;
        const ownedRoomIndexes = await appMulti.getRoomIndexesByOwner(userId);
        const ownedRoomIds = ownedRoomIndexes.map((room) => room.id);
        const changedIndexes = (await appMulti.getRoomIndexesSince(sinceUpdatedAt)).filter(
            (index) => index.ownerUserId === userId
        );
        const ownMemberships = await appMulti.getMembersSince(userId, sinceUpdatedAt);
        const ownedRoomMemberships = await appMulti.getMembersByRoomsSince(
            ownedRoomIds,
            sinceUpdatedAt
        );
        const memberById = new Map<string, MultiRoomMemberRecord>();
        for (const member of ownMemberships) memberById.set(member.id, member);
        for (const member of ownedRoomMemberships) memberById.set(member.id, member);

        if (changedIndexes.length > 0) {
            await this.pushRoomIndexes(changedIndexes, swallowErrors);
            for (const record of changedIndexes)
                nextCursor = Math.max(nextCursor, record.updatedAt);
        }

        const changedMembers = [...memberById.values()];
        if (changedMembers.length > 0) {
            await this.pushMembers(changedMembers, swallowErrors);
            for (const record of changedMembers)
                nextCursor = Math.max(nextCursor, record.updatedAt);
        }

        return nextCursor;
    }

    private async pushRoomIndexes(
        records: MultiRoomIndexRecord[],
        swallowErrors = true
    ): Promise<void> {
        await this.pushBatch('multi_room_index', records, this.roomIndexToPb, swallowErrors);
    }

    private async pushMembers(
        records: MultiRoomMemberRecord[],
        swallowErrors = true
    ): Promise<void> {
        await this.pushBatch('multi_room_members', records, this.memberToPb, swallowErrors);
    }

    private async pushBatch<TRecord>(
        collection: MultiCollection,
        records: TRecord[],
        serialize: (record: TRecord) => Record<string, unknown>,
        swallowErrors: boolean
    ): Promise<void> {
        for (let i = 0; i < records.length; i += CHUNK_SIZE) {
            const chunk = records.slice(i, i + CHUNK_SIZE);
            const batch = pb.createBatch();
            for (const record of chunk) {
                batch.collection(collection).upsert(serialize(record));
            }
            try {
                await batch.send({ requestKey: null });
            } catch (error) {
                logger.error(`Failed to push ${collection}`, error);
                if (!swallowErrors) throw error;
            }
        }
    }

    async handleLocalWrite(event: MultiWriteEvent): Promise<void> {
        if (event.origin !== 'local') return;
        if (!pb.authStore.isValid || !hasActiveSession()) return;

        const task = () => this.pushEvent(event);
        if (this.syncing) {
            this.pendingQueue.push(task);
        } else {
            void task();
        }
    }

    private async pushEvent(event: MultiWriteEvent): Promise<void> {
        if (event.ids.length === 0) return;
        if (event.tableName === 'multi_room_index') {
            const records = await Promise.all(event.ids.map((id) => appMulti.getRoomIndex(id)));
            await this.pushWritableRoomIndexes(records.filter(this.isRoomIndex));
            return;
        }

        const records = await Promise.all(event.ids.map((id) => appMulti.getMember(id)));
        await this.pushWritableMembers(records.filter(this.isMember));
    }

    private async pushWritableRoomIndexes(records: MultiRoomIndexRecord[]): Promise<void> {
        const { userId } = getActiveSession();
        await this.pushRoomIndexes(records.filter((record) => record.ownerUserId === userId));
    }

    private async pushWritableMembers(records: MultiRoomMemberRecord[]): Promise<void> {
        const { userId } = getActiveSession();
        const ownedRooms = await appMulti.getRoomIndexesByOwner(userId);
        const ownedRoomIds = new Set(ownedRooms.map((room) => room.id));
        await this.pushMembers(
            records.filter((record) => record.userId === userId || ownedRoomIds.has(record.roomId))
        );
    }

    private async flushPendingQueue(): Promise<void> {
        const tasks = this.pendingQueue.splice(0);
        for (const task of tasks) {
            await task();
        }
    }

    private async handleRealtimeEvent(
        collection: MultiCollection,
        event: RealtimeEvent
    ): Promise<void> {
        try {
            if (!hasActiveSession()) return;
            if (collection === 'multi_room_index') {
                const remote = this.pbToRoomIndex(event.record);
                const local = await appMulti.getRoomIndex(remote.id);
                if (!local || remote.updatedAt > local.updatedAt) {
                    await appMulti.saveRoomIndex(remote, { origin: 'sync' });
                } else if (local.updatedAt > remote.updatedAt) {
                    void this.pushWritableRoomIndexes([local]);
                }
                return;
            }

            const remote = this.pbToMember(event.record);
            const local = await appMulti.getMember(remote.id);
            if (!local || remote.updatedAt > local.updatedAt) {
                await appMulti.saveMember(remote, { origin: 'sync' });
            } else if (local.updatedAt > remote.updatedAt) {
                void this.pushWritableMembers([local]);
            }
        } catch (error) {
            logger.error(`Realtime event error for ${collection}`, error);
        }
    }

    private pbToRoomIndex(record: Record<string, unknown>): MultiRoomIndexRecord {
        return {
            id: record.id as string,
            ownerUserId: record.ownerUserId as string,
            visibility: record.visibility as MultiRoomIndexRecord['visibility'],
            publicName: (record.publicName as string | undefined) || undefined,
            createdAt: this.normalizeTimestamp(record.createdAt, record.created),
            updatedAt: this.normalizeTimestamp(record.updatedAt, record.updated),
            isDeleted: Boolean(record.isDeleted)
        };
    }

    private pbToMember(record: Record<string, unknown>): MultiRoomMemberRecord {
        return {
            id: record.id as string,
            roomId: record.roomId as string,
            userId: record.userId as string,
            status: record.status as MultiRoomMemberRecord['status'],
            encryptedRoomKey: (record.encryptedRoomKey as string | undefined) || undefined,
            createdAt: this.normalizeTimestamp(record.createdAt, record.created),
            updatedAt: this.normalizeTimestamp(record.updatedAt, record.updated),
            isDeleted: Boolean(record.isDeleted)
        };
    }

    private roomIndexToPb(record: MultiRoomIndexRecord): Record<string, unknown> {
        return {
            id: record.id,
            ownerUserId: record.ownerUserId,
            visibility: record.visibility,
            publicName: record.publicName,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            isDeleted: record.isDeleted
        };
    }

    private memberToPb(record: MultiRoomMemberRecord): Record<string, unknown> {
        return {
            id: record.id,
            roomId: record.roomId,
            userId: record.userId,
            status: record.status,
            encryptedRoomKey: record.encryptedRoomKey,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            isDeleted: record.isDeleted
        };
    }

    private isRoomIndex(record: MultiRoomIndexRecord | null): record is MultiRoomIndexRecord {
        return record !== null;
    }

    private isMember(record: MultiRoomMemberRecord | null): record is MultiRoomMemberRecord {
        return record !== null;
    }

    protected override isAuthError(error: unknown): boolean {
        if (isErrorCode(error, 'NOT_AUTHENTICATED') || isErrorCode(error, 'SESSION_EXPIRED')) {
            return true;
        }

        const status = (error as { status?: unknown })?.status;
        return status === 401 || status === 403;
    }

    protected override isQuotaError(error: unknown): boolean {
        if (isErrorCode(error, 'QUOTA_EXCEEDED')) return true;

        const status = (error as { status?: unknown })?.status;
        return status === 402 || status === 413;
    }
}

export const MultiSyncService = new MultiSyncEngine();
