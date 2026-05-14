import Database from '@tauri-apps/plugin-sql';
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

interface MultiRoomIndexRow {
    id: string;
    ownerUserId: string;
    visibility: 'public' | 'private';
    publicName: string | null;
    createdAt: number;
    updatedAt: number;
    isDeleted: number;
}

interface MultiRoomMemberRow {
    id: string;
    roomId: string;
    userId: string;
    status: 'pending' | 'accepted' | 'revoked';
    encryptedRoomKey: string | null;
    createdAt: number;
    updatedAt: number;
    isDeleted: number;
}

interface MultiRoomDeleteMarkerRow {
    roomId: string;
    roomKey: string;
    dataDone: number;
    assetDone: number;
    createdAt: number;
    updatedAt: number;
    attempts: number;
    lastError: string | null;
}

export class TauriMultiAdapter implements IMultiAdapter {
    private readonly writeEvents = new MultiWriteEventEmitter();
    private sqlitePromise: Promise<Database> | null = null;

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

    private async getSQLite(): Promise<Database> {
        if (this.sqlitePromise) return this.sqlitePromise;

        this.sqlitePromise = (async () => {
            const db = await Database.load('sqlite:KeiLocalDB.db');
            await db.execute(`
                CREATE TABLE IF NOT EXISTS multi_room_index (
                    id         TEXT    PRIMARY KEY,
                    ownerUserId TEXT   NOT NULL,
                    visibility TEXT    NOT NULL,
                    publicName TEXT,
                    createdAt  INTEGER NOT NULL,
                    updatedAt  INTEGER NOT NULL,
                    isDeleted  INTEGER NOT NULL DEFAULT 0
                )
            `);
            await db.execute(`
                CREATE TABLE IF NOT EXISTS multi_room_members (
                    id                 TEXT    PRIMARY KEY,
                    roomId             TEXT    NOT NULL,
                    userId             TEXT    NOT NULL,
                    status             TEXT    NOT NULL,
                    encryptedRoomKey   TEXT,
                    createdAt          INTEGER NOT NULL,
                    updatedAt          INTEGER NOT NULL,
                    isDeleted          INTEGER NOT NULL DEFAULT 0
                )
            `);
            await db.execute(`
                CREATE TABLE IF NOT EXISTS multi_room_delete_markers (
                    roomId    TEXT    PRIMARY KEY,
                    roomKey   TEXT    NOT NULL,
                    dataDone  INTEGER NOT NULL DEFAULT 0,
                    assetDone INTEGER NOT NULL DEFAULT 0,
                    createdAt INTEGER NOT NULL,
                    updatedAt INTEGER NOT NULL,
                    attempts  INTEGER NOT NULL,
                    lastError TEXT
                )
            `);
            await db.execute(
                `CREATE INDEX IF NOT EXISTS idx_multi_room_index_owner_updatedAt ON multi_room_index (ownerUserId, updatedAt)`
            );
            await db.execute(
                `CREATE INDEX IF NOT EXISTS idx_multi_room_index_updatedAt ON multi_room_index (updatedAt)`
            );
            await db.execute(
                `CREATE INDEX IF NOT EXISTS idx_multi_room_members_user_updatedAt ON multi_room_members (userId, updatedAt)`
            );
            await db.execute(
                `CREATE INDEX IF NOT EXISTS idx_multi_room_members_room_updatedAt ON multi_room_members (roomId, updatedAt)`
            );
            await db.execute(
                `CREATE UNIQUE INDEX IF NOT EXISTS idx_multi_room_members_room_user ON multi_room_members (roomId, userId)`
            );
            await db.execute(
                `CREATE INDEX IF NOT EXISTS idx_multi_room_delete_markers_updatedAt ON multi_room_delete_markers (updatedAt)`
            );
            return db;
        })();

        return this.sqlitePromise;
    }

    private toRoomIndex(row: MultiRoomIndexRow): MultiRoomIndexRecord {
        return {
            id: row.id,
            ownerUserId: row.ownerUserId,
            visibility: row.visibility,
            publicName: row.publicName ?? undefined,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            isDeleted: row.isDeleted === 1
        };
    }

    private toMember(row: MultiRoomMemberRow): MultiRoomMemberRecord {
        return {
            id: row.id,
            roomId: row.roomId,
            userId: row.userId,
            status: row.status,
            encryptedRoomKey: row.encryptedRoomKey ?? undefined,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            isDeleted: row.isDeleted === 1
        };
    }

    private toDeleteMarker(row: MultiRoomDeleteMarkerRow): MultiRoomDeleteMarkerRecord {
        return {
            roomId: row.roomId,
            roomKey: row.roomKey,
            dataDone: row.dataDone === 1,
            assetDone: row.assetDone === 1,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            attempts: row.attempts,
            lastError: row.lastError ?? undefined
        };
    }

    private async writeRoomIndex(record: MultiRoomIndexRecord): Promise<void> {
        const db = await this.getSQLite();
        await db.execute(
            `INSERT OR REPLACE INTO multi_room_index
             (id, ownerUserId, visibility, publicName, createdAt, updatedAt, isDeleted)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                record.id,
                record.ownerUserId,
                record.visibility,
                record.publicName ?? null,
                record.createdAt,
                record.updatedAt,
                record.isDeleted ? 1 : 0
            ]
        );
    }

    private async writeMember(record: MultiRoomMemberRecord): Promise<void> {
        const db = await this.getSQLite();
        await db.execute(
            `INSERT OR REPLACE INTO multi_room_members
             (id, roomId, userId, status, encryptedRoomKey, createdAt, updatedAt, isDeleted)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                record.id,
                record.roomId,
                record.userId,
                record.status,
                record.encryptedRoomKey ?? null,
                record.createdAt,
                record.updatedAt,
                record.isDeleted ? 1 : 0
            ]
        );
    }

    private async writeDeleteMarker(record: MultiRoomDeleteMarkerRecord): Promise<void> {
        const db = await this.getSQLite();
        await db.execute(
            `INSERT OR REPLACE INTO multi_room_delete_markers
             (roomId, roomKey, dataDone, assetDone, createdAt, updatedAt, attempts, lastError)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                record.roomId,
                record.roomKey,
                record.dataDone ? 1 : 0,
                record.assetDone ? 1 : 0,
                record.createdAt,
                record.updatedAt,
                record.attempts,
                record.lastError ?? null
            ]
        );
    }

    async getRoomIndex(roomId: string): Promise<MultiRoomIndexRecord | null> {
        const db = await this.getSQLite();
        const rows = await db.select<MultiRoomIndexRow[]>(
            `SELECT * FROM multi_room_index WHERE id = $1`,
            [roomId]
        );
        return rows[0] ? this.toRoomIndex(rows[0]) : null;
    }

    async getRoomIndexes(roomIds: string[]): Promise<MultiRoomIndexRecord[]> {
        if (roomIds.length === 0) return [];
        const records: MultiRoomIndexRecord[] = [];
        for (const roomId of roomIds) {
            const record = await this.getRoomIndex(roomId);
            if (record && !record.isDeleted) records.push(record);
        }
        return records;
    }

    async getRoomIndexesByOwner(ownerUserId: string): Promise<MultiRoomIndexRecord[]> {
        const db = await this.getSQLite();
        const rows = await db.select<MultiRoomIndexRow[]>(
            `SELECT * FROM multi_room_index WHERE ownerUserId = $1`,
            [ownerUserId]
        );
        return rows.map((row) => this.toRoomIndex(row));
    }

    async getRoomIndexesSince(sinceUpdatedAt: number): Promise<MultiRoomIndexRecord[]> {
        const db = await this.getSQLite();
        const rows = await db.select<MultiRoomIndexRow[]>(
            `SELECT * FROM multi_room_index WHERE updatedAt > $1`,
            [sinceUpdatedAt]
        );
        return rows.map((row) => this.toRoomIndex(row));
    }

    async saveRoomIndex(record: MultiRoomIndexRecord, options?: MultiWriteOptions): Promise<void> {
        await this.writeRoomIndex(record);
        this.emitWriteEvent('multi_room_index', 'put', [record.id], options);
    }

    async saveRoomIndexes(
        records: MultiRoomIndexRecord[],
        options?: MultiWriteOptions
    ): Promise<void> {
        if (records.length === 0) return;
        for (const record of records) {
            await this.writeRoomIndex(record);
        }
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
        await this.writeRoomIndex({
            ...record,
            updatedAt: clock.now(),
            isDeleted: true
        });
        this.emitWriteEvent('multi_room_index', 'softDelete', [roomId], options);
    }

    async getMember(id: string): Promise<MultiRoomMemberRecord | null> {
        const db = await this.getSQLite();
        const rows = await db.select<MultiRoomMemberRow[]>(
            `SELECT * FROM multi_room_members WHERE id = $1`,
            [id]
        );
        return rows[0] ? this.toMember(rows[0]) : null;
    }

    async getMembersByUser(userId: string): Promise<MultiRoomMemberRecord[]> {
        const db = await this.getSQLite();
        const rows = await db.select<MultiRoomMemberRow[]>(
            `SELECT * FROM multi_room_members WHERE userId = $1 AND isDeleted = 0`,
            [userId]
        );
        return rows.map((row) => this.toMember(row));
    }

    async getMembersByRoom(roomId: string): Promise<MultiRoomMemberRecord[]> {
        const db = await this.getSQLite();
        const rows = await db.select<MultiRoomMemberRow[]>(
            `SELECT * FROM multi_room_members WHERE roomId = $1 AND isDeleted = 0`,
            [roomId]
        );
        return rows.map((row) => this.toMember(row));
    }

    async getMembersByRoomsSince(
        roomIds: string[],
        sinceUpdatedAt: number
    ): Promise<MultiRoomMemberRecord[]> {
        if (roomIds.length === 0) return [];
        const records: MultiRoomMemberRecord[] = [];
        for (const roomId of roomIds) {
            const db = await this.getSQLite();
            const rows = await db.select<MultiRoomMemberRow[]>(
                `SELECT * FROM multi_room_members WHERE roomId = $1 AND updatedAt > $2`,
                [roomId, sinceUpdatedAt]
            );
            records.push(...rows.map((row) => this.toMember(row)));
        }
        return records;
    }

    async getMembership(roomId: string, userId: string): Promise<MultiRoomMemberRecord | null> {
        const db = await this.getSQLite();
        const rows = await db.select<MultiRoomMemberRow[]>(
            `SELECT * FROM multi_room_members WHERE roomId = $1 AND userId = $2`,
            [roomId, userId]
        );
        return rows[0] ? this.toMember(rows[0]) : null;
    }

    async getMembersSince(
        userId: string,
        sinceUpdatedAt: number
    ): Promise<MultiRoomMemberRecord[]> {
        const db = await this.getSQLite();
        const rows = await db.select<MultiRoomMemberRow[]>(
            `SELECT * FROM multi_room_members WHERE userId = $1 AND updatedAt > $2`,
            [userId, sinceUpdatedAt]
        );
        return rows.map((row) => this.toMember(row));
    }

    async saveMember(record: MultiRoomMemberRecord, options?: MultiWriteOptions): Promise<void> {
        await this.writeMember(record);
        this.emitWriteEvent('multi_room_members', 'put', [record.id], options);
    }

    async saveMembers(
        records: MultiRoomMemberRecord[],
        options?: MultiWriteOptions
    ): Promise<void> {
        if (records.length === 0) return;
        for (const record of records) {
            await this.writeMember(record);
        }
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
        await this.writeMember({
            ...record,
            updatedAt: clock.now(),
            isDeleted: true
        });
        this.emitWriteEvent('multi_room_members', 'softDelete', [id], options);
    }

    async deleteMembersByRoom(roomId: string, options?: MultiWriteOptions): Promise<void> {
        const db = await this.getSQLite();
        const rows = await db.select<MultiRoomMemberRow[]>(
            `SELECT * FROM multi_room_members WHERE roomId = $1`,
            [roomId]
        );
        if (rows.length === 0) return;

        const now = clock.now();
        for (const row of rows) {
            const record = this.toMember(row);
            await this.writeMember({
                ...record,
                updatedAt: now,
                isDeleted: true
            });
        }

        this.emitWriteEvent(
            'multi_room_members',
            'softDelete',
            rows.map((row) => row.id),
            options
        );
    }

    async getDeleteMarkers(): Promise<MultiRoomDeleteMarkerRecord[]> {
        const db = await this.getSQLite();
        const rows = await db.select<MultiRoomDeleteMarkerRow[]>(
            `SELECT * FROM multi_room_delete_markers ORDER BY updatedAt ASC`
        );
        return rows.map((row) => this.toDeleteMarker(row));
    }

    async getDeleteMarker(roomId: string): Promise<MultiRoomDeleteMarkerRecord | null> {
        const db = await this.getSQLite();
        const rows = await db.select<MultiRoomDeleteMarkerRow[]>(
            `SELECT * FROM multi_room_delete_markers WHERE roomId = $1`,
            [roomId]
        );
        return rows[0] ? this.toDeleteMarker(rows[0]) : null;
    }

    async saveDeleteMarker(record: MultiRoomDeleteMarkerRecord): Promise<void> {
        await this.writeDeleteMarker(record);
    }

    async deleteDeleteMarker(roomId: string): Promise<void> {
        const db = await this.getSQLite();
        await db.execute(`DELETE FROM multi_room_delete_markers WHERE roomId = $1`, [roomId]);
    }

    async purgeRoomLocal(roomId: string, options?: MultiWriteOptions): Promise<void> {
        const db = await this.getSQLite();
        const memberRows = await db.select<MultiRoomMemberRow[]>(
            `SELECT * FROM multi_room_members WHERE roomId = $1`,
            [roomId]
        );
        const members = memberRows.map((row) => this.toMember(row));
        await db.execute(`DELETE FROM multi_room_members WHERE roomId = $1`, [roomId]);
        await db.execute(`DELETE FROM multi_room_index WHERE id = $1`, [roomId]);
        await db.execute(`DELETE FROM multi_room_delete_markers WHERE roomId = $1`, [roomId]);
        this.emitWriteEvent(
            'multi_room_members',
            'purge',
            members.map((member) => member.id),
            options
        );
        this.emitWriteEvent('multi_room_index', 'purge', [roomId], options);
    }

    async purgeUserLocal(userId: string, options?: MultiWriteOptions): Promise<void> {
        const db = await this.getSQLite();
        const memberRows = await db.select<MultiRoomMemberRow[]>(
            `SELECT * FROM multi_room_members WHERE userId = $1`,
            [userId]
        );
        const memberships = memberRows.map((row) => this.toMember(row));
        if (memberships.length === 0) return;

        const roomIds = [...new Set(memberships.map((member) => member.roomId))];
        const orphanedRoomIds: string[] = [];

        await db.execute(`DELETE FROM multi_room_members WHERE userId = $1`, [userId]);

        for (const roomId of roomIds) {
            const rows = await db.select<Array<{ count: number }>>(
                `SELECT COUNT(*) as count FROM multi_room_members WHERE roomId = $1`,
                [roomId]
            );
            if ((rows[0]?.count ?? 0) === 0) {
                await db.execute(`DELETE FROM multi_room_index WHERE id = $1`, [roomId]);
                await db.execute(`DELETE FROM multi_room_delete_markers WHERE roomId = $1`, [
                    roomId
                ]);
                orphanedRoomIds.push(roomId);
            }
        }

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

export const tauriMulti = new TauriMultiAdapter();
