import Dexie, { type Table } from 'dexie';
import type {
    ISyncCursorAdapter,
    SyncCursorIdentity,
    SyncCursorRecord,
    SyncCursorState,
    SyncCursorStreamQuery,
    SyncCursorUpdate
} from './types';

type SyncCursorPrimaryKey = [string, string, string, string, string];

class SyncCursorDexie extends Dexie {
    cursors!: Table<SyncCursorRecord, SyncCursorPrimaryKey>;

    constructor() {
        super('KeiSyncCursors');
        this.version(1).stores({
            cursors:
                '[serverUrl+userId+stream+scopeType+scopeId], [serverUrl+userId+stream], userId'
        });
    }
}

function primaryKey(identity: SyncCursorIdentity): SyncCursorPrimaryKey {
    return [
        identity.serverUrl,
        identity.userId,
        identity.stream,
        identity.scopeType,
        identity.scopeId
    ];
}

export class WebSyncCursorAdapter implements ISyncCursorAdapter {
    private readonly db = new SyncCursorDexie();

    async get(identity: SyncCursorIdentity): Promise<SyncCursorState> {
        const record = await this.db.cursors.get(primaryKey(identity));
        return {
            serverPullCursor: record?.serverPullCursor ?? 0,
            localPushCursor: record?.localPushCursor ?? 0
        };
    }

    async advance(identity: SyncCursorIdentity, update: SyncCursorUpdate): Promise<void> {
        await this.db.transaction('rw', this.db.cursors, async () => {
            const existing = await this.db.cursors.get(primaryKey(identity));
            await this.db.cursors.put({
                ...identity,
                serverPullCursor: Math.max(
                    existing?.serverPullCursor ?? 0,
                    update.serverPullCursor ?? 0
                ),
                localPushCursor: Math.max(
                    existing?.localPushCursor ?? 0,
                    update.localPushCursor ?? 0
                )
            });
        });
    }

    async delete(identity: SyncCursorIdentity): Promise<void> {
        await this.db.cursors.delete(primaryKey(identity));
    }

    async deleteByStream(query: SyncCursorStreamQuery): Promise<void> {
        await this.db.cursors
            .where('[serverUrl+userId+stream]')
            .equals([query.serverUrl, query.userId, query.stream])
            .delete();
    }

    async deleteByUser(userId: string): Promise<void> {
        await this.db.cursors.where('userId').equals(userId).delete();
    }
}
