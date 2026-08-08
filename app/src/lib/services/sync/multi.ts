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
import { syncCursorDB } from '$lib/adapters/sync';
import { MultiRoomService } from '$lib/services';
import { getActiveSession } from '../session';
import { BaseRecordSyncEngine, type BufferedRecordWrite } from './base';
import { createLogger } from '$lib/adapters/logger';
import { clock } from '$lib/utils/clock';
import {
    normalizeTimestamp,
    PAGE_SIZE,
    CHUNK_SIZE,
    getServerNow,
    getSyncCursorIdentity,
    isReadyToSync,
    type RealtimeEvent
} from './utils';
import { normalizeUrl } from '$lib/utils/url';

type MultiCollection = 'multi_room_index' | 'multi_room_members';

const logger = createLogger('sync:multi');

export class MultiRecordSyncEngineImpl extends BaseRecordSyncEngine<
    MultiWriteEvent,
    MultiCollection
> {
    private subscribed = false;

    constructor() {
        super();
    }

    get isSubscribed(): boolean {
        return this.subscribed;
    }

    async subscribeRealtime(): Promise<void> {
        if (!isReadyToSync()) return;

        await this.unsubscribeRealtime();

        try {
            await pb.collection('multi_room_index').subscribe('*', (event) => {
                void this.handleRealtimeEvent(
                    'multi_room_index',
                    event as unknown as RealtimeEvent
                );
            });
            await pb.collection('multi_room_members').subscribe('*', (event) => {
                void this.handleRealtimeEvent(
                    'multi_room_members',
                    event as unknown as RealtimeEvent
                );
            });
        } catch (err) {
            await this.unsubscribeRealtime();
            throw err;
        }

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
        await syncCursorDB.deleteByStream({
            serverUrl: normalizeUrl(pb.baseUrl),
            userId,
            stream: 'multi_meta'
        });
    }

    protected override async syncRecords(): Promise<void> {
        if (!isReadyToSync()) return;
        const { userId } = getActiveSession();
        const localUpper = clock.now();
        const serverUpper = await getServerNow();

        await this.syncMeta(userId, localUpper, serverUpper);
    }

    private async syncMeta(userId: string, localUpper: number, serverUpper: number): Promise<void> {
        const cursorIdentity = getSyncCursorIdentity('multi_meta', userId, {
            scopeType: 'user',
            scopeId: userId
        });
        const cursors = await syncCursorDB.get(cursorIdentity);
        const pullCursor = cursors.serverPullCursor;
        const pushCursor = cursors.localPushCursor;
        let syncError: unknown = null;
        let pushError: unknown = null;

        try {
            await this.pullRoomIndexes(pullCursor, serverUpper);
            await this.pullMembers(pullCursor, serverUpper);
        } catch (error) {
            syncError = error;
            logger.error('Failed to pull multi metadata', error);
        }

        try {
            await this.pushLocalChanges(userId, pushCursor, localUpper, false);
        } catch (error) {
            pushError = error;
        }

        const nextPullCursor = !syncError && serverUpper > pullCursor ? serverUpper : undefined;
        const nextPushCursor = !pushError && localUpper > pushCursor ? localUpper : undefined;
        if (nextPullCursor !== undefined || nextPushCursor !== undefined) {
            await syncCursorDB.advance(cursorIdentity, {
                serverPullCursor: nextPullCursor,
                localPushCursor: nextPushCursor
            });
        }

        if (syncError) throw syncError;
        if (pushError) throw pushError;
    }

    private async pullRoomIndexes(
        afterServerUpdatedAt: number,
        throughServerUpdatedAt: number
    ): Promise<void> {
        let page = 1;

        while (true) {
            const result = await pb.collection('multi_room_index').getList(page, PAGE_SIZE, {
                filter: pb.filter('serverUpdatedAt > {:after} && serverUpdatedAt <= {:through}', {
                    after: afterServerUpdatedAt,
                    through: throughServerUpdatedAt
                }),
                sort: 'serverUpdatedAt,id'
            });

            for (const item of result.items) {
                const raw = item as unknown as Record<string, unknown>;
                const updatedAt = normalizeTimestamp(raw.updatedAt, raw.updated);
                const roomId = raw.id as string;
                clock.observe(updatedAt);

                if (raw.isDeleted) {
                    // Endpoint tombstone — hard delete locally
                    await this.purgeDeletedRoom(roomId);
                } else {
                    const remote = this.pbToRoomIndex(raw);
                    const local = await appMulti.getRoomIndex(remote.id);
                    if (!local) {
                        await appMulti.saveRoomIndex(remote, { origin: 'sync' });
                    } else if (remote.updatedAt > local.updatedAt) {
                        // Both live — LWW remote wins
                        await appMulti.saveRoomIndex(remote, { origin: 'sync' });
                    } else if (local.updatedAt > remote.updatedAt) {
                        // Both live — LWW local wins
                        await this.pushWritableRoomIndexes([local], false);
                    }
                }
            }

            if (result.page >= result.totalPages) break;
            page++;
        }
    }

    private async pullMembers(
        afterServerUpdatedAt: number,
        throughServerUpdatedAt: number
    ): Promise<void> {
        let page = 1;

        while (true) {
            const result = await pb.collection('multi_room_members').getList(page, PAGE_SIZE, {
                filter: pb.filter('serverUpdatedAt > {:after} && serverUpdatedAt <= {:through}', {
                    after: afterServerUpdatedAt,
                    through: throughServerUpdatedAt
                }),
                sort: 'serverUpdatedAt,id'
            });

            for (const item of result.items) {
                const remote = this.pbToMember(item as unknown as Record<string, unknown>);
                clock.observe(remote.updatedAt);
                const local = await appMulti.getMember(remote.id);
                const shouldSave =
                    !local ||
                    remote.updatedAt > local.updatedAt ||
                    (this.isOwnInactiveMembership(remote) && remote.updatedAt >= local.updatedAt);
                if (shouldSave) {
                    await appMulti.saveMember(remote, { origin: 'sync' });
                    await this.ensureRoomIndexForMember(remote);
                } else if (local.updatedAt > remote.updatedAt) {
                    await this.pushWritableMembers([local], false);
                }
            }

            if (result.page >= result.totalPages) break;
            page++;
        }
    }

    private async pushLocalChanges(
        userId: string,
        afterUpdatedAt: number,
        throughUpdatedAt: number,
        continueOnError: boolean
    ): Promise<void> {
        const ownedRoomIndexes = await appMulti.getRoomIndexesByOwner(userId);
        const activeOwnedRoomIds = ownedRoomIndexes.map((room) => room.id);
        const changedIndexes = (
            await appMulti.getRoomIndexesBetween(afterUpdatedAt, throughUpdatedAt)
        ).filter((index) => index.ownerUserId === userId);
        const ownedRoomMemberships = await appMulti.getMembersByRoomsBetween(
            activeOwnedRoomIds,
            afterUpdatedAt,
            throughUpdatedAt
        );
        const memberById = new Map<string, MultiRoomMemberRecord>();
        for (const member of ownedRoomMemberships) memberById.set(member.id, member);

        if (changedIndexes.length > 0) {
            await this.pushRoomIndexes(changedIndexes, continueOnError);
        }

        const changedMembers = [...memberById.values()];
        if (changedMembers.length > 0) {
            await this.pushMembers(changedMembers, continueOnError);
        }
    }

    private async pushRoomIndexes(
        records: MultiRoomIndexRecord[],
        continueOnError = true
    ): Promise<void> {
        await this.pushBatch('multi_room_index', records, this.roomIndexToPb, continueOnError);
    }

    private async pushMembers(
        records: MultiRoomMemberRecord[],
        continueOnError = true
    ): Promise<void> {
        await this.pushBatch('multi_room_members', records, this.memberToPb, continueOnError);
    }

    private async pushBatch<TRecord>(
        collection: MultiCollection,
        records: TRecord[],
        serialize: (record: TRecord) => Record<string, unknown>,
        continueOnError: boolean
    ): Promise<void> {
        for (let i = 0; i < records.length; i += CHUNK_SIZE) {
            const chunk = records.slice(i, i + CHUNK_SIZE);
            const batch = pb.createBatch();
            for (const record of chunk) {
                batch.collection(collection).upsert(serialize(record));
            }
            try {
                const results = await batch.send({ requestKey: null });
                for (const result of results) {
                    if (result.status < 200 || result.status >= 300 || !result.body) continue;
                    const raw = result.body as Record<string, unknown>;

                    if (collection === 'multi_room_index') {
                        if (raw.isDeleted) {
                            const roomId = raw.id as string;
                            await this.purgeDeletedRoom(roomId);
                            continue;
                        }

                        const remote = this.pbToRoomIndex(raw);
                        const local = await appMulti.getRoomIndex(remote.id);
                        if (!local || remote.updatedAt > local.updatedAt) {
                            await appMulti.saveRoomIndex(remote, { origin: 'sync' });
                        }
                        continue;
                    }

                    const remote = this.pbToMember(raw);
                    const local = await appMulti.getMember(remote.id);
                    const serverIsCanonical =
                        !local ||
                        remote.updatedAt > local.updatedAt ||
                        (this.isOwnInactiveMembership(remote) &&
                            remote.updatedAt >= local.updatedAt);
                    if (serverIsCanonical) {
                        await appMulti.saveMember(remote, { origin: 'sync' });
                        await this.ensureRoomIndexForMember(remote);
                    }
                }
            } catch (error) {
                logger.error(`Failed to push ${collection}`, error);
                if (!continueOnError) throw error;
            }
        }
    }

    protected override getBufferedWrites(
        event: MultiWriteEvent
    ): BufferedRecordWrite<MultiCollection>[] {
        if (event.origin !== 'local') return [];
        if (event.operation === 'purge') return [];
        return event.ids.map((id) => ({ bucket: event.tableName, id }));
    }

    protected override async pushBufferedWrites(
        writes: BufferedRecordWrite<MultiCollection>[]
    ): Promise<void> {
        if (!isReadyToSync()) return;

        const roomIndexIds = new Set<string>();
        const memberIds = new Set<string>();
        for (const write of writes) {
            if (write.bucket === 'multi_room_index') {
                roomIndexIds.add(write.id);
            } else {
                memberIds.add(write.id);
            }
        }

        if (roomIndexIds.size > 0) {
            const records = await Promise.all(
                [...roomIndexIds].map((id) => appMulti.getRoomIndex(id))
            );
            await this.pushWritableRoomIndexes(
                records.filter((r): r is MultiRoomIndexRecord => r !== null),
                false
            );
        }

        if (memberIds.size > 0) {
            const records = await Promise.all([...memberIds].map((id) => appMulti.getMember(id)));
            await this.pushWritableMembers(
                records.filter((r): r is MultiRoomMemberRecord => r !== null),
                false
            );
        }
    }

    private async pushWritableRoomIndexes(
        records: MultiRoomIndexRecord[],
        continueOnError = true
    ): Promise<void> {
        const { userId } = getActiveSession();
        await this.pushRoomIndexes(
            records.filter((record) => record.ownerUserId === userId),
            continueOnError
        );
    }

    private async pushWritableMembers(
        records: MultiRoomMemberRecord[],
        continueOnError = true
    ): Promise<void> {
        const { userId } = getActiveSession();
        const ownedRooms = await appMulti.getRoomIndexesByOwner(userId);
        const activeOwnedRoomIds = new Set(ownedRooms.map((room) => room.id));
        await this.pushMembers(
            records.filter((record) => activeOwnedRoomIds.has(record.roomId)),
            continueOnError
        );
    }

    private async handleRealtimeEvent(
        collection: MultiCollection,
        event: RealtimeEvent
    ): Promise<void> {
        try {
            if (!isReadyToSync()) return;
            if (collection === 'multi_room_index') {
                const raw = event.record;
                const updatedAt = normalizeTimestamp(raw.updatedAt, raw.updated);
                const roomId = raw.id as string;
                clock.observe(updatedAt);

                if (raw.isDeleted) {
                    // Endpoint tombstone — hard delete locally
                    await this.purgeDeletedRoom(roomId);
                } else {
                    const remote = this.pbToRoomIndex(raw);
                    const local = await appMulti.getRoomIndex(remote.id);
                    if (!local) {
                        await appMulti.saveRoomIndex(remote, { origin: 'sync' });
                    } else if (remote.updatedAt > local.updatedAt) {
                        await appMulti.saveRoomIndex(remote, { origin: 'sync' });
                    } else if (local.updatedAt > remote.updatedAt) {
                        void this.pushWritableRoomIndexes([local]);
                    }
                }
                return;
            }

            const remote = this.pbToMember(event.record);
            clock.observe(remote.updatedAt);
            const local = await appMulti.getMember(remote.id);
            const shouldSave =
                !local ||
                remote.updatedAt > local.updatedAt ||
                (this.isOwnInactiveMembership(remote) && remote.updatedAt >= local.updatedAt);
            if (shouldSave) {
                await appMulti.saveMember(remote, { origin: 'sync' });
                await this.ensureRoomIndexForMember(remote);
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
            createdAt: normalizeTimestamp(record.createdAt, record.created),
            updatedAt: normalizeTimestamp(record.updatedAt, record.updated)
        };
    }

    private pbToMember(record: Record<string, unknown>): MultiRoomMemberRecord {
        return {
            id: record.id as string,
            roomId: record.roomId as string,
            userId: record.userId as string,
            status: record.status as MultiRoomMemberRecord['status'],
            encryptedRoomKey: (record.encryptedRoomKey as string | undefined) || undefined,
            createdAt: normalizeTimestamp(record.createdAt, record.created),
            updatedAt: normalizeTimestamp(record.updatedAt, record.updated)
        };
    }

    private roomIndexToPb(record: MultiRoomIndexRecord): Record<string, unknown> {
        return {
            id: record.id,
            ownerUserId: record.ownerUserId,
            visibility: record.visibility,
            publicName: record.publicName,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt
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
            updatedAt: record.updatedAt
        };
    }

    private isOwnInactiveMembership(record: MultiRoomMemberRecord): boolean {
        const { userId } = getActiveSession();
        return record.userId === userId && record.status !== 'accepted';
    }

    private async ensureRoomIndexForMember(record: MultiRoomMemberRecord): Promise<void> {
        const { userId } = getActiveSession();
        if (record.userId !== userId || record.status !== 'accepted') return;

        const local = await appMulti.getRoomIndex(record.roomId);
        if (local) return;

        try {
            const raw = (await pb.collection('multi_room_index').getOne(record.roomId, {
                requestKey: null
            })) as unknown as Record<string, unknown>;
            if (!raw.isDeleted) {
                const remote = this.pbToRoomIndex(raw);
                await appMulti.saveRoomIndex(remote, { origin: 'sync' });
            }
        } catch (error) {
            logger.warn(`Failed to bootstrap multi room index: ${record.roomId}`, error);
        }
    }

    private async purgeDeletedRoom(roomId: string): Promise<void> {
        await appMulti.purgeRoomLocal(roomId, { origin: 'sync' });
        await MultiRoomService.purgeLocalRoomContent(roomId);
    }
}

export const MultiRecordSyncEngine = new MultiRecordSyncEngineImpl();
