import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import Dexie from 'dexie';
import { WebDatabaseAdapter } from '$lib/adapters/db/web';
import { TauriDatabaseAdapter } from '$lib/adapters/db/tauri';
import { WebMultiAdapter, multiDB } from '$lib/adapters/multi/web';
import { TauriMultiAdapter } from '$lib/adapters/multi/tauri';
import type { DataRecord, IDatabaseAdapter } from '$lib/adapters/db';
import type {
    IMultiAdapter,
    MultiRoomIndexRecord,
    MultiRoomMemberRecord
} from '$lib/adapters/multi';

// Node 20 can still run the Web contract; Node 22+ also validates the production SQLite SQL.
const SQLiteDatabase = await import('node:sqlite')
    .then((module) => module.DatabaseSync)
    .catch(() => null);

// Run the production SQL against real SQLite, mocking only the Tauri transport.
const sqlite = vi.hoisted(() => ({ db: null as DatabaseSync | null }));
vi.mock('@tauri-apps/plugin-sql', () => ({
    default: {
        load: async () => ({
            execute: async (query: string, values: SQLInputValue[] = []) => {
                const db = sqlite.db!;
                if (values.length === 0) {
                    db.exec(query);
                    return { rowsAffected: 0 };
                }
                const bindings = Object.fromEntries(values.map((value, i) => [`$${i + 1}`, value]));
                return { rowsAffected: Number(db.prepare(query).run(bindings).changes) };
            },
            select: async (query: string, values: SQLInputValue[] = []) => {
                const bindings = Object.fromEntries(values.map((value, i) => [`$${i + 1}`, value]));
                return values.length
                    ? sqlite.db!.prepare(query).all(bindings)
                    : sqlite.db!.prepare(query).all();
            }
        })
    }
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }));

const scope = { scopeType: 'user' as const, scopeId: 'owner' };
const record = (id: string, updatedAt = 100): DataRecord => ({
    id,
    ...scope,
    createdAt: 1,
    updatedAt,
    isDeleted: false,
    data: { a: 1, b: 2 }
});
const room = (id: string, updatedAt = 100): MultiRoomIndexRecord => ({
    id,
    ownerUserId: 'owner',
    visibility: 'private',
    createdAt: 1,
    updatedAt
});
const member = (id: string, updatedAt = 100): MultiRoomMemberRecord => ({
    id,
    roomId: 'room',
    userId: 'owner',
    status: 'accepted',
    createdAt: 1,
    updatedAt
});

for (const platform of ['Web', 'Tauri'] as const) {
    describe.skipIf(platform === 'Tauri' && !SQLiteDatabase)(
        `${platform} local change sequences`,
        () => {
            let db: IDatabaseAdapter;
            let multi: IMultiAdapter;
            const newDB = () =>
                platform === 'Web' ? new WebDatabaseAdapter() : new TauriDatabaseAdapter();
            const newMulti = () =>
                platform === 'Web' ? new WebMultiAdapter() : new TauriMultiAdapter();

            beforeEach(async () => {
                await Dexie.delete('KeiLocalDB');
                multiDB.close();
                await Dexie.delete('KeiMulti');
                if (platform === 'Web') await multiDB.open();
                sqlite.db = SQLiteDatabase ? new SQLiteDatabase(':memory:') : null;
                db = newDB();
                multi = newMulti();
            });
            afterEach(async () => {
                sqlite.db?.close();
                sqlite.db = null;
                await Dexie.delete('KeiLocalDB');
                multiDB.close();
                await Dexie.delete('KeiMulti');
            });

            it('selects imported low-LWW records after the previous Push cursor, including tombstones', async () => {
                await db.putRecord('characters', record('first', 10000));
                const cursor = await db.getLocalUpdateUpper();
                await db.putRecords(
                    'characters',
                    [record('imported', 2), { ...record('deleted', 1), isDeleted: true }],
                    { origin: 'sync' }
                );
                const upper = await db.getLocalUpdateUpper();
                const changes = await db.getUnsyncedChanges('characters', scope, cursor, upper);
                expect(changes.map((r) => r.id).sort()).toEqual(['deleted', 'imported']);
                expect(changes.every((r) => r.localUpdatedAt! > cursor)).toBe(true);
                expect(changes.map((r) => r.updatedAt).sort()).toEqual([1, 2]);
                expect(
                    await db.getUnsyncedChanges(
                        'characters',
                        { ...scope, scopeId: 'other' },
                        cursor,
                        upper
                    )
                ).toEqual([]);
            });

            it('ignores caller metadata and identical deliveries without changing canonical versions', async () => {
                const input = { ...record('same'), localUpdatedAt: 900000 };
                await db.putRecord('characters', input, { origin: 'sync' });
                const before = await db.getRecord('characters', input.id);
                expect(before?.localUpdatedAt).toBeLessThan(900000);
                await db.putRecords(
                    'characters',
                    [{ ...input, localUpdatedAt: 999999, data: { b: 2, a: 1 } }],
                    { origin: 'sync' }
                );
                expect(await db.getRecord('characters', input.id)).toEqual(before);
                expect(await db.getLocalUpdateUpper()).toBe(before!.localUpdatedAt);
                await db.putRecord('characters', { ...input, data: { a: 3 } }, { origin: 'sync' });
                const after = await db.getRecord('characters', input.id);
                expect(after?.localUpdatedAt).toBeGreaterThan(before!.localUpdatedAt!);
                expect(after?.updatedAt).toBe(input.updatedAt);
                expect(input.localUpdatedAt).toBe(900000);
            });

            it('stamps every soft-delete path once and keeps already deleted rows unchanged', async () => {
                await db.putRecords(
                    'messages',
                    ['single', 'index', 'compound'].map((id) => ({ ...record(id), chatId: id }))
                );
                const cursor = await db.getLocalUpdateUpper();
                await db.softDeleteRecord('messages', 'single');
                await db.softDeleteByIndex('messages', 'chatId', 'index');
                await db.softDeleteByCompoundIndex('messages', '[scopeType+scopeId]', [
                    'user',
                    'owner'
                ]);
                const upper = await db.getLocalUpdateUpper();
                const changed = await db.getUnsyncedChanges('messages', scope, cursor, upper);
                expect(changed).toHaveLength(3);
                expect(changed.every((r) => r.isDeleted && r.localUpdatedAt! > cursor)).toBe(true);
                await db.softDeleteRecord('messages', 'single');
                await db.softDeleteByIndex('messages', 'chatId', 'index');
                await db.softDeleteByCompoundIndex('messages', '[scopeType+scopeId]', [
                    'user',
                    'owner'
                ]);
                expect(await db.getLocalUpdateUpper()).toBe(upper);
            });

            it('serializes concurrent writes from separate adapter instances without reusing sequences', async () => {
                const other = newDB();
                await Promise.all(
                    Array.from({ length: 8 }, (_, i) =>
                        (i % 2 ? db : other).putRecord('characters', record(`concurrent-${i}`))
                    )
                );
                const upper = await db.getLocalUpdateUpper();
                const rows = await db.getUnsyncedChanges('characters', scope, 0, upper);
                expect(rows).toHaveLength(8);
                expect(new Set(rows.map((row) => row.localUpdatedAt)).size).toBe(8);
                expect(Math.max(...rows.map((row) => row.localUpdatedAt!))).toBe(upper);
            });

            it('rolls back both the record and its sequence on transaction failure', async () => {
                const before = await db.getLocalUpdateUpper();
                await expect(
                    db.transaction(['characters'], 'rw', async () => {
                        await db.putRecord('characters', record('rollback'));
                        throw new Error('rollback');
                    })
                ).rejects.toThrow('rollback');
                expect(await db.getRecord('characters', 'rollback')).toBeUndefined();
                expect(await db.getLocalUpdateUpper()).toBe(before);
            });

            it('keeps the sequence after reopening adapters, purging rows, and moving wall time backwards', async () => {
                await db.putRecord('characters', record('gone'));
                const cursor = await db.getLocalUpdateUpper();
                await db.deleteRecord('characters', 'gone');
                db = newDB();
                const wall = vi.spyOn(Date, 'now').mockReturnValue(1);
                try {
                    await db.putRecord('settings', record('new', 1));
                    expect((await db.getRecord('settings', 'new'))?.localUpdatedAt).toBeGreaterThan(
                        cursor
                    );
                } finally {
                    wall.mockRestore();
                }
            });

            it('scans both multi metadata tables by local sequence and preserves duplicate inactive memberships', async () => {
                await multi.saveRoomIndex(room('room', 10000));
                await multi.saveMember({ ...member('first', 10000), userId: 'someone-else' });
                const cursor = await multi.getLocalUpdateUpper();
                await multi.saveRoomIndexes(
                    [{ ...room('room', 2), publicName: 'imported', localUpdatedAt: 900000 }],
                    { origin: 'sync' }
                );
                const incoming = {
                    ...member('inactive', 1),
                    status: 'revoked' as const,
                    localUpdatedAt: 900000
                };
                await multi.saveMembers([incoming], { origin: 'sync' });
                const upper = await multi.getLocalUpdateUpper();
                expect((await multi.getRoomIndexesBetween(cursor, upper)).map((r) => r.id)).toEqual(
                    ['room']
                );
                expect(
                    (await multi.getMembersByRoomsBetween(['room'], cursor, upper)).map((r) => r.id)
                ).toEqual(['inactive']);
                expect(
                    (await multi.getMembersBetween('owner', cursor, upper)).map((r) => r.id)
                ).toEqual(['inactive']);
                const before = await multi.getMember('inactive');
                await multi.saveMember(incoming, { origin: 'sync' });
                await multi.saveRoomIndex(
                    { ...room('room', 2), publicName: 'imported' },
                    { origin: 'sync' }
                );
                expect(await multi.getMember('inactive')).toEqual(before);
                expect(await multi.getLocalUpdateUpper()).toBe(upper);
                multi = newMulti();
                expect(await multi.getLocalUpdateUpper()).toBe(upper);
                await multi.purgeRoomLocal('room');
                await multi.saveRoomIndex(room('next'));
                expect((await multi.getRoomIndex('next'))?.localUpdatedAt).toBeGreaterThan(upper);
            });
        }
    );
}
