// @vitest-environment node
/**
 * Sync lifecycle against a real PocketBase (docs/sync-gc.md): bootstrap, adoption, GC,
 * conflicts and their resolution, interruption, and room rejoin.
 *
 * Every device runs the real DataRecordSyncEngine, safety module, Web adapter (Dexie on its
 * own fake-indexeddb) and Web Crypto against the real hooks. Run with `pnpm test:pb`, which
 * starts two throwaway servers; without them this file is skipped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import PocketBase from 'pocketbase';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { WebDatabaseAdapter } from '$lib/adapters/db/web';
import { DataRecordSyncEngineImpl, type SyncConflict } from '$lib/services/sync/data';
import { normalizeUrl } from '$lib/utils/url';
import type { DataRecord, DataScope } from '$lib/adapters/db/types';
import type {
    SyncCursorIdentity,
    SyncCursorState,
    SyncCursorStream,
    SyncCursorUpdate
} from '$lib/adapters/sync/types';

const SERVERS = [process.env.KEI_PB_URL, process.env.KEI_PB_URL_2];
const DATA_DIRS = [process.env.KEI_PB_DATA, process.env.KEI_PB_DATA_2];
const ADMIN = {
    email: process.env.KEI_PB_ADMIN_EMAIL,
    password: process.env.KEI_PB_ADMIN_PASSWORD
};

interface Session {
    userId: string;
    masterKey: CryptoKey;
    identityKeyPair: CryptoKeyPair;
    roomId?: string;
    roomKey?: CryptoKey;
}

interface Device {
    name: string;
    db: WebDatabaseAdapter;
    cursors: Map<string, SyncCursorIdentity & SyncCursorState>;
    pb: PocketBase;
    engine: DataRecordSyncEngineImpl;
    session: Session;
}

const h = vi.hoisted(() => ({ device: null as unknown as Device }));

function current(): Device {
    if (!h.device) throw new Error('No active device');
    return h.device;
}

vi.mock('$lib/adapters/pb', () => ({
    pb: new Proxy(
        {},
        {
            get(_target, key: string) {
                const pb = current().pb as unknown as Record<string, unknown>;
                const value = pb[key];
                return typeof value === 'function' ? value.bind(pb) : value;
            }
        }
    )
}));

vi.mock('$lib/adapters/db', async () => {
    const types = await vi.importActual<object>('$lib/adapters/db/types');
    return {
        ...types,
        localDB: new Proxy(
            {},
            {
                get(_target, key: string) {
                    const db = current().db as unknown as Record<string, unknown>;
                    const value = db[key];
                    return typeof value === 'function' ? value.bind(db) : value;
                }
            }
        )
    };
});

vi.mock('$lib/adapters/sync', () => {
    const keyOf = (identity: SyncCursorIdentity) =>
        [
            identity.serverUrl,
            identity.userId,
            identity.stream,
            identity.scopeType,
            identity.scopeId
        ].join('|');
    const remove = (match: (row: SyncCursorIdentity) => boolean) => {
        for (const [key, row] of current().cursors) if (match(row)) current().cursors.delete(key);
    };
    return {
        syncCursorDB: {
            get: async (identity: SyncCursorIdentity) => {
                const row = current().cursors.get(keyOf(identity));
                return {
                    serverPullCursor: row?.serverPullCursor ?? 0,
                    localPushCursor: row?.localPushCursor ?? 0
                };
            },
            advance: async (identity: SyncCursorIdentity, update: SyncCursorUpdate) => {
                const row = current().cursors.get(keyOf(identity));
                current().cursors.set(keyOf(identity), {
                    ...identity,
                    serverPullCursor: Math.max(
                        row?.serverPullCursor ?? 0,
                        update.serverPullCursor ?? 0
                    ),
                    localPushCursor: Math.max(
                        row?.localPushCursor ?? 0,
                        update.localPushCursor ?? 0
                    )
                });
            },
            delete: async (identity: SyncCursorIdentity) => {
                current().cursors.delete(keyOf(identity));
            },
            deleteByStream: async (query: {
                serverUrl: string;
                userId: string;
                stream: SyncCursorStream;
            }) =>
                remove(
                    (row) =>
                        row.serverUrl === query.serverUrl &&
                        row.userId === query.userId &&
                        row.stream === query.stream
                ),
            deleteByScope: async (userId: string, stream: SyncCursorStream, scope: DataScope) =>
                remove(
                    (row) =>
                        row.userId === userId &&
                        row.stream === stream &&
                        row.scopeType === scope.scopeType &&
                        row.scopeId === scope.scopeId
                ),
            deleteByUser: async (userId: string) => remove((row) => row.userId === userId)
        }
    };
});

vi.mock('$lib/services/session', () => ({
    hasActiveSession: () => true,
    getActiveSession: () => current().session
}));

vi.mock('$lib/services/asset', () => ({
    AssetService: {
        delete: async () => {},
        markLocal: async () => {},
        markRemote: async () => {},
        deleteScopeAssets: async () => {}
    }
}));

vi.mock('$lib/services/content/cascade', () => ({
    cascadeDeleteChildren: async () => ({ deleted: {}, assetOwners: [] }),
    cleanupCascadeAssets: async () => {}
}));

vi.mock('$lib/adapters/logger', () => ({
    createLogger: () => ({
        debug() {},
        info() {},
        warn() {},
        // Set KEI_PB_DEBUG to see the engine's errors while investigating a failure.
        error: (...args: unknown[]) => {
            if (process.env.KEI_PB_DEBUG) {
                console.error(
                    ...args.map((arg) =>
                        (arg as { response?: unknown })?.response
                            ? JSON.stringify((arg as { response: unknown }).response)
                            : arg
                    )
                );
            }
        }
    })
}));

interface User {
    id: string;
    username: string;
    password: string;
    masterKey: CryptoKey;
}

let sequence = 0;
const unique = (prefix: string) =>
    `${prefix}${Date.now().toString(36)}${(++sequence).toString(36)}`.slice(0, 15).padEnd(15, '0');

async function createUser(serverUrl: string, user?: User): Promise<User> {
    const created: User = user ?? {
        id: unique('u'),
        username: unique('user'),
        password: 'Passw0rd!123456',
        masterKey: await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
            'encrypt',
            'decrypt'
        ])
    };
    const pb = new PocketBase(serverUrl);
    await pb.collection('users').create({
        id: created.id,
        username: created.username,
        password: created.password,
        passwordConfirm: created.password,
        encryptedProfile: 'profile',
        encryptedProfileIV: 'iv'
    });
    return created;
}

async function createDevice(name: string, serverUrl: string, user: User): Promise<Device> {
    // Each device gets its own IndexedDB; Dexie captures the factory at construction.
    Dexie.dependencies.indexedDB = new IDBFactory();
    Dexie.dependencies.IDBKeyRange = IDBKeyRange;
    const db = new WebDatabaseAdapter();
    await db.getLocalUpdatedAt();
    const device: Device = {
        name,
        db,
        cursors: new Map(),
        pb: await signIn(serverUrl, user),
        engine: new DataRecordSyncEngineImpl(),
        session: {
            userId: user.id,
            masterKey: user.masterKey,
            identityKeyPair: {} as CryptoKeyPair
        }
    };
    devices.push(device);
    return device;
}

async function signIn(serverUrl: string, user: User): Promise<PocketBase> {
    const pb = new PocketBase(serverUrl);
    pb.autoCancellation(false);
    await pb.collection('users').authWithPassword(user.username, user.password);
    return pb;
}

const devices: Device[] = [];

beforeEach(() => {
    idTag = Math.random().toString(36).slice(2, 6);
});

afterEach(async () => {
    vi.restoreAllMocks();
    for (const device of devices.splice(0)) {
        device.engine.stop();
        (device.db as unknown as { db: Dexie }).db.close();
    }
});

async function on<T>(device: Device, action: () => Promise<T>): Promise<T> {
    const previous = h.device;
    h.device = device;
    try {
        return await action();
    } finally {
        h.device = previous;
    }
}

async function sync(device: Device): Promise<string> {
    await on(device, () => device.engine.trigger());
    return device.engine.getState().state;
}

function failCommit(device: Device): void {
    const send = device.pb.send.bind(device.pb);
    vi.spyOn(device.pb, 'send').mockImplementation(async (path, options) => {
        if (path === '/api/sync/commit') throw new Error('connection lost');
        return send(path, options);
    });
}

/** The server applies the commit, but its response never arrives. */
function loseCommitResponse(device: Device): void {
    const send = device.pb.send.bind(device.pb);
    vi.spyOn(device.pb, 'send').mockImplementation(async (path, options) => {
        const response = await send(path, options);
        if (path === '/api/sync/commit') throw new Error('connection lost');
        return response;
    });
}

/** The nth Push batch fails; the others go through. */
function failBatch(device: Device, nth: number): void {
    const send = device.pb.send.bind(device.pb);
    let batches = 0;
    vi.spyOn(device.pb, 'send').mockImplementation(async (path, options) => {
        if (path === '/api/batch' && ++batches === nth) throw new Error('quota exceeded');
        return send(path, options);
    });
}

/** Make time pass for local retention and checkpoint issuance without moving the clock. */
async function age(device: Device, table: 'characters' | 'syncCheckpoints', patch: object) {
    const db = (device.db as unknown as { db: Dexie }).db;
    await db.table(table).toCollection().modify(patch);
}

/** Restart: a fresh engine on the same storage, as after an app restart. */
function restart(device: Device): void {
    device.engine.stop();
    device.engine = new DataRecordSyncEngineImpl();
}

function conflicts(device: Device): SyncConflict[] {
    let list: SyncConflict[] = [];
    device.engine.subscribeConflicts((value) => (list = value))();
    return list;
}

const userScope = (device: Device): DataScope => ({
    scopeType: 'user',
    scopeId: device.session.userId
});

/** PocketBase record ids are 15 characters of [a-z0-9], unique across the whole server. */
let idTag = '';
const rid = (name: string) => (idTag + name.replace(/[^a-z0-9]/g, '')).slice(0, 15).padEnd(15, '0');

async function remove(device: Device, id: string): Promise<void> {
    await device.db.softDeleteRecord('characters', rid(id));
}

let version = Date.now();
async function write(
    device: Device,
    id: string,
    name: string,
    scope = userScope(device)
): Promise<void> {
    const record: DataRecord = {
        id: rid(id),
        ...scope,
        createdAt: 1,
        updatedAt: ++version,
        isDeleted: false,
        data: { name }
    };
    await device.db.putRecord('characters', record);
}

async function names(device: Device, scope = userScope(device)): Promise<string[]> {
    const records = await device.db.getAll<DataRecord>('characters', scope);
    return records.map((record) => String(record.data.name)).sort();
}

function serverDb(server: number): DatabaseSync {
    const db = new DatabaseSync(join(DATA_DIRS[server]!, 'data.db'));
    db.exec('PRAGMA busy_timeout = 5000');
    return db;
}

interface ScopeRow {
    gcHigh: number;
    lineage: string;
    initToken: string;
}

function serverScope(server: number, scope: DataScope): ScopeRow | undefined {
    const db = serverDb(server);
    try {
        return db
            .prepare(
                'SELECT gcHigh, lineage, initToken FROM sync_scopes WHERE scopeType = ? AND scopeId = ?'
            )
            .get(scope.scopeType, scope.scopeId) as ScopeRow | undefined;
    } finally {
        db.close();
    }
}

function expireLease(server: number, scope: DataScope): void {
    const db = serverDb(server);
    db.prepare('UPDATE sync_scopes SET initAt = 1 WHERE scopeType = ? AND scopeId = ?').run(
        scope.scopeType,
        scope.scopeId
    );
    db.close();
}

function serverRow(server: number, id: string): { isDeleted: number; lineage: string } | undefined {
    const db = serverDb(server);
    try {
        return db.prepare('SELECT isDeleted, lineage FROM records WHERE id = ?').get(rid(id)) as
            | { isDeleted: number; lineage: string }
            | undefined;
    } finally {
        db.close();
    }
}

/** Expire a server tombstone and run the real GC cron until it is collected. */
async function collectOnServer(server: number, id: string): Promise<void> {
    const db = serverDb(server);
    db.prepare('UPDATE records SET tombstoneAt = 1 WHERE id = ?').run(rid(id));
    db.close();
    const admin = new PocketBase(SERVERS[server]);
    await admin.collection('_superusers').authWithPassword(ADMIN.email!, ADMIN.password!);
    await admin.send('/api/crons/tombstone-gc', { method: 'POST' });
    await vi.waitFor(() => expect(serverRow(server, id)).toBeUndefined(), { timeout: 10_000 });
}

describe.skipIf(!SERVERS[0] || !SERVERS[1] || !DATA_DIRS[0] || !ADMIN.email)(
    'sync lifecycle on a real PocketBase',
    () => {
        it('bootstraps an empty server from local data and lets new devices adopt it', async () => {
            const user = await createUser(SERVERS[0]!);
            const a = await createDevice('A', SERVERS[0]!, user);
            // Local data written before the account had any server state.
            await write(a, 'r1', 'one');
            await write(a, 'r2', 'two');

            expect(await sync(a)).toBe('idle');
            const lineage = (await a.db.getSyncScopeState(userScope(a))).lineage;
            expect(lineage).toBeTruthy();
            expect(serverScope(0, userScope(a))).toMatchObject({ lineage, initToken: '' });
            expect(serverRow(0, 'r1')).toMatchObject({ isDeleted: 0, lineage });

            const b = await createDevice('B', SERVERS[0]!, user);
            expect(await sync(b)).toBe('idle');
            expect(await names(b)).toEqual(['one', 'two']);
            expect((await b.db.getSyncScopeState(userScope(b))).lineage).toBe(lineage);

            // Both edit offline; same lineage and nothing collected: a normal LWW merge.
            await write(a, 'r1', 'one-a');
            await write(b, 'r2', 'two-b');
            await write(b, 'r3', 'three-b');
            for (const device of [a, b, a]) expect(await sync(device)).toBe('idle');
            expect(await names(a)).toEqual(['one-a', 'three-b', 'two-b']);
            expect(await names(b)).toEqual(['one-a', 'three-b', 'two-b']);
            expect(conflicts(a)).toEqual([]);
            expect(conflicts(b)).toEqual([]);

            // An account that never had data initializes just as quietly.
            const empty = await createDevice('E', SERVERS[0]!, await createUser(SERVERS[0]!));
            expect(await sync(empty)).toBe('idle');
            expect(serverScope(0, userScope(empty))?.lineage).toBeTruthy();
        });

        it('adopts collected deletions on a new device and refuses a stale one until it chooses', async () => {
            const user = await createUser(SERVERS[0]!);
            const a = await createDevice('A', SERVERS[0]!, user);
            await write(a, 'gone', 'gone');
            await write(a, 'kept', 'kept');
            await sync(a);
            const stale = await createDevice('Stale', SERVERS[0]!, user);
            await sync(stale);
            expect(await names(stale)).toEqual(['gone', 'kept']);

            // While the stale device is away, the deletion is synced and collected on the server.
            await remove(a, 'gone');
            expect(await sync(a)).toBe('idle');
            await collectOnServer(0, 'gone');
            expect(serverScope(0, userScope(a))!.gcHigh).toBeGreaterThan(0);

            const c = await createDevice('C', SERVERS[0]!, user);
            expect(await sync(c)).toBe('idle');
            expect(await names(c)).toEqual(['kept']);
            expect(await c.db.getSyncGcHigh(userScope(c))).toBeGreaterThan(0);
            expect(await sync(c)).toBe('idle');

            // The stale device still holds the deleted record live: no merge, no resurrection.
            expect(await sync(stale)).toBe('unsafe_merge');
            expect(serverRow(0, 'gone')).toBeUndefined();
            const [conflict] = conflicts(stale);
            expect(conflict).toMatchObject({ kind: 'unsafe', serverUrl: SERVERS[0] });

            // Cancel: nothing changes, and sync stays stopped.
            expect(await sync(stale)).toBe('unsafe_merge');
            expect(await names(stale)).toEqual(['gone', 'kept']);

            // Keep the server: one resolution at a time, then the device adopts the server.
            const first = on(stale, () => stale.engine.resolveConflict(conflict, 'server'));
            await expect(
                on(stale, () => stale.engine.resolveConflict(conflict, 'server'))
            ).rejects.toThrow(/already being resolved/);
            await first;
            expect(await names(stale)).toEqual(['kept']);
            expect(conflicts(stale)).toEqual([]);
            expect(await sync(stale)).toBe('idle');
            expect(serverRow(0, 'gone')).toBeUndefined();
        });

        it('overwrites the server under a new lineage and makes older devices choose again', async () => {
            const user = await createUser(SERVERS[0]!);
            const a = await createDevice('A', SERVERS[0]!, user);
            await write(a, 'x', 'x');
            await write(a, 'y', 'y');
            await sync(a);
            const b = await createDevice('B', SERVERS[0]!, user);
            await sync(b);
            await remove(b, 'y');
            await sync(b);
            await collectOnServer(0, 'y');

            // A never learned of y's deletion and chooses its own copy.
            await write(a, 'a-only', 'a-only');
            expect(await sync(a)).toBe('unsafe_merge');
            const before = serverScope(0, userScope(a))!.lineage;
            await on(a, () => a.engine.resolveConflict(conflicts(a)[0], 'local'));
            const after = serverScope(0, userScope(a))!;
            expect(after.lineage).not.toBe(before);
            expect(after.initToken).toBe('');
            expect((await a.db.getSyncScopeState(userScope(a))).lineage).toBe(after.lineage);
            expect(serverRow(0, 'y')).toMatchObject({ isDeleted: 0, lineage: after.lineage });
            expect(serverRow(0, 'a-only')?.lineage).toBe(after.lineage);

            // B still holds a session verified before the overwrite: the server refuses its
            // buffered Push of the replaced lineage.
            await write(b, 'b-live', 'b-live');
            await expect(
                on(b, () =>
                    (
                        b.engine as unknown as {
                            pushBufferedWrites(writes: unknown[]): Promise<void>;
                        }
                    ).pushBufferedWrites([{ bucket: 'characters', id: rid('b-live') }])
                )
            ).rejects.toMatchObject({ code: 'SYNC_UNSAFE' });
            expect(serverRow(0, 'b-live')).toBeUndefined();

            // B holds the replaced lineage: it may not merge its state back.
            await write(b, 'b-only', 'b-only');
            expect(await sync(b)).toBe('unsafe_merge');
            expect(serverRow(0, 'b-only')).toBeUndefined();
            await on(b, () => b.engine.resolveConflict(conflicts(b)[0], 'server'));
            expect(await names(b)).toEqual(['a-only', 'x', 'y']);
            expect(await sync(b)).toBe('idle');
        });

        it('bootstraps an empty second server after client GC, and a same-lineage device follows', async () => {
            const user = await createUser(SERVERS[0]!);
            await createUser(SERVERS[1]!, user);
            const a = await createDevice('A', SERVERS[0]!, user);
            await write(a, 'r1', 'one');
            await write(a, 'r2', 'two');
            await sync(a);
            const b = await createDevice('B', SERVERS[0]!, user);
            await sync(b);
            await remove(a, 'r2');
            await sync(a);
            // A day later A issues a newer checkpoint; B inherits it through the server.
            await age(a, 'syncCheckpoints', { createdAt: 1 });
            expect(await sync(a)).toBe('idle');
            // After retention A collects its pushed tombstone.
            await age(a, 'characters', { tombstoneAt: 1 });
            expect(await sync(a)).toBe('idle');
            expect(await a.db.getRecord('characters', rid('r2'))).toBeUndefined();
            expect(await a.db.getSyncGcHigh(userScope(a))).toBeGreaterThan(0);
            expect(await sync(b)).toBe('idle');

            a.pb = await signIn(SERVERS[1]!, user);
            expect(await sync(a)).toBe('idle');
            const second = serverScope(1, userScope(a))!;
            expect(second.gcHigh).toBeGreaterThan(0);
            expect(second.lineage).toBe((await a.db.getSyncScopeState(userScope(a))).lineage);

            b.pb = await signIn(SERVERS[1]!, user);
            expect(await sync(b)).toBe('idle');
            expect(conflicts(b)).toEqual([]);
            expect(await names(b)).toEqual(['one']);
        });

        it('restarts an interrupted bootstrap or adoption instead of using the partial replica', async () => {
            const user = await createUser(SERVERS[0]!);
            const g = await createDevice('G', SERVERS[0]!, user);
            await write(g, 'r1', 'one');
            // The connection drops after the bootstrap pushed, before its commit.
            failCommit(g);
            expect(await sync(g)).toBe('network_error');
            vi.restoreAllMocks();
            expect(serverScope(0, userScope(g))!.initToken).not.toBe('');

            // Another device must not adopt the partial server state.
            const h2 = await createDevice('H', SERVERS[0]!, user);
            expect(await sync(h2)).toBe('server_initializing');
            expect(await names(h2)).toEqual([]);

            restart(g);
            expect(await sync(g)).toBe('idle');
            expect(serverScope(0, userScope(g))!.initToken).toBe('');

            restart(h2);
            failCommit(h2);
            expect(await sync(h2)).toBe('network_error');
            vi.restoreAllMocks();
            expect((await h2.db.getSyncScopeState(userScope(h2))).adopting).toBeTruthy();

            restart(h2);
            expect(await sync(h2)).toBe('idle');
            expect((await h2.db.getSyncScopeState(userScope(h2))).adopting).toBeNull();
            expect(await names(h2)).toEqual(['one']);
        });

        it('keeps the lease when a bootstrap Push fails partway', async () => {
            const user = await createUser(SERVERS[0]!);
            const g = await createDevice('G', SERVERS[0]!, user);
            // More than one Push batch; the deletion lands in the batch that fails.
            for (let i = 0; i < 100; i++) await write(g, `r${i}z`, `n${i}`);
            await write(g, 'gone', 'gone');
            await remove(g, 'gone');
            failBatch(g, 2);
            expect(await sync(g)).not.toBe('idle');
            vi.restoreAllMocks();
            expect(serverScope(0, userScope(g))!.initToken).not.toBe('');
            expect(serverRow(0, 'gone')).toBeUndefined();

            const h2 = await createDevice('H', SERVERS[0]!, user);
            expect(await sync(h2)).toBe('server_initializing');
            expect(await names(h2)).toEqual([]);

            restart(g);
            expect(await sync(g)).toBe('idle');
            expect(serverRow(0, 'gone')).toMatchObject({ isDeleted: 1 });
            expect(await sync(h2)).toBe('idle');
            expect(await names(h2)).toHaveLength(100);
        });

        it('lets only the bootstrapping device resume a stale lease', async () => {
            const user = await createUser(SERVERS[0]!);
            await createUser(SERVERS[1]!, user);
            const a = await createDevice('A', SERVERS[0]!, user);
            await write(a, 'x', 'x');
            await sync(a);
            const b = await createDevice('B', SERVERS[0]!, user);
            await sync(b);
            // A deletes x and moves to an empty server; its bootstrap is cut off before commit.
            await remove(a, 'x');
            await sync(a);
            a.pb = await signIn(SERVERS[1]!, user);
            failCommit(a);
            expect(await sync(a)).toBe('network_error');
            vi.restoreAllMocks();
            expect(serverRow(1, 'x')).toMatchObject({ isDeleted: 1 });
            expireLease(1, userScope(a));

            // B shares the lineage but never learned of the deletion: it must not take over.
            b.pb = await signIn(SERVERS[1]!, user);
            expect(await sync(b)).toBe('unsafe_merge');
            expect(serverRow(1, 'x')).toMatchObject({ isDeleted: 1 });
            // The lease cannot be adopted: the dialog offers only keeping this device.
            expect(conflicts(b)[0]).toMatchObject({ serverInitializing: true });

            restart(a);
            expect(await sync(a)).toBe('idle');
            expect(serverScope(1, userScope(a))!.initToken).toBe('');
        });

        it('recognizes its own bootstrap when the commit response was lost', async () => {
            const user = await createUser(SERVERS[0]!);
            const g = await createDevice('G', SERVERS[0]!, user);
            await write(g, 'r1', 'one');
            loseCommitResponse(g);
            expect(await sync(g)).toBe('network_error');
            vi.restoreAllMocks();
            const server = serverScope(0, userScope(g))!;
            expect(server.initToken).toBe('');

            restart(g);
            expect(await sync(g)).toBe('idle');
            expect(conflicts(g)).toEqual([]);
            expect(await g.db.getSyncScopeState(userScope(g))).toEqual({
                lineage: server.lineage,
                adopting: null,
                bootstrapping: null
            });
        });

        it('drops a realtime merge that was in flight when the replica was replaced', async () => {
            const user = await createUser(SERVERS[0]!);
            const a = await createDevice('A', SERVERS[0]!, user);
            await write(a, 'x', 'x');
            await sync(a);
            const b = await createDevice('B', SERVERS[0]!, user);
            await sync(b);
            await write(b, 'b-only', 'b-only');
            await sync(b);
            const stale = await b.pb.collection('records').getOne(rid('b-only'));

            // A new device keeps its own data: the server is replaced without any GC.
            const c = await createDevice('C', SERVERS[0]!, user);
            await write(c, 'c-only', 'c-only');
            expect(await sync(c)).toBe('init_required');
            await on(c, () => c.engine.resolveConflict(conflicts(c)[0], 'local'));
            expect(serverScope(0, userScope(c))!.gcHigh).toBe(0);

            // B receives an event of the old lineage and is still decrypting it...
            const engine = b.engine as unknown as {
                pbToLocalRecord(...args: unknown[]): Promise<unknown>;
                handleRealtimeEvent(...args: unknown[]): Promise<void>;
            };
            const decode = engine.pbToLocalRecord.bind(engine);
            let release!: () => void;
            const held = new Promise<void>((resolve) => (release = resolve));
            let first = true;
            vi.spyOn(engine, 'pbToLocalRecord').mockImplementation(async (...args) => {
                if (first) {
                    first = false;
                    await held;
                }
                return decode(...args);
            });
            await on(b, async () => {
                const merging = engine.handleRealtimeEvent('records', normalizeUrl(SERVERS[0]!), {
                    action: 'update',
                    record: stale
                });
                // ...while it adopts the replaced server.
                expect(await sync(b)).toBe('unsafe_merge');
                await b.engine.resolveConflict(conflicts(b)[0], 'server');
                release();
                await merging;
            });
            expect(await names(b)).toEqual(['c-only']);
            expect(await b.db.getRecord('characters', rid('b-only'))).toBeUndefined();
        });

        it('keeps a local write made while an empty device was planning adoption', async () => {
            const user = await createUser(SERVERS[0]!);
            const source = await createDevice('Source', SERVERS[0]!, user);
            await write(source, 'server', 'server');
            await sync(source);
            const fresh = await createDevice('Fresh', SERVERS[0]!, user);
            const send = fresh.pb.send.bind(fresh.pb);
            let written = false;
            vi.spyOn(fresh.pb, 'send').mockImplementation(async (path, options) => {
                const response = await send(path, options);
                if (path === '/api/sync/handshake' && !written) {
                    written = true;
                    await write(fresh, 'newlocal', 'newlocal');
                }
                return response;
            });
            expect(await sync(fresh)).toBe('idle');
            expect(written).toBe(true);
            expect(await names(fresh)).toEqual(['newlocal', 'server']);
            expect(serverRow(0, 'newlocal')).toMatchObject({ isDeleted: 0 });
        });

        it('does not adopt automatically once GC emptied a replica that knows deletions', async () => {
            const user = await createUser(SERVERS[0]!);
            await createUser(SERVERS[1]!, user);
            const a = await createDevice('A', SERVERS[0]!, user);
            await write(a, 'x', 'x');
            await sync(a);
            a.pb = await signIn(SERVERS[1]!, user);
            expect(await sync(a)).toBe('idle');
            // Back on the first server, A deletes x and collects the tombstone.
            a.pb = await signIn(SERVERS[0]!, user);
            restart(a);
            await remove(a, 'x');
            await sync(a);
            await age(a, 'characters', { tombstoneAt: 1 });
            expect(await sync(a)).toBe('idle');
            expect(await a.db.hasScopeRecords(userScope(a))).toBe(false);
            const gcHigh = await a.db.getSyncGcHigh(userScope(a));
            expect(gcHigh).toBeGreaterThan(0);

            // The second server still holds x live and cannot prove A's deletion.
            a.pb = await signIn(SERVERS[1]!, user);
            restart(a);
            expect(await sync(a)).toBe('unsafe_merge');
            expect(await names(a)).toEqual([]);
            expect(await a.db.getSyncGcHigh(userScope(a))).toBe(gcHigh);
        });

        it('keeps an overwritten lineage apart even when the overwrite response was lost', async () => {
            const user = await createUser(SERVERS[0]!);
            await createUser(SERVERS[1]!, user);
            const a = await createDevice('A', SERVERS[0]!, user);
            await write(a, 'x', 'x');
            await sync(a);
            a.pb = await signIn(SERVERS[1]!, user);
            await sync(a);
            const b = await createDevice('B', SERVERS[1]!, user);
            await sync(b);
            await write(b, 'y', 'old-lineage-only');
            await sync(b);
            // Another device replaces the first server; A keeps its own copy over it.
            const c = await createDevice('C', SERVERS[0]!, user);
            await write(c, 'c-only', 'c-only');
            expect(await sync(c)).toBe('init_required');
            await on(c, () => c.engine.resolveConflict(conflicts(c)[0], 'local'));
            a.pb = await signIn(SERVERS[0]!, user);
            restart(a);
            expect(await sync(a)).toBe('unsafe_merge');
            loseCommitResponse(a);
            await expect(
                on(a, () => a.engine.resolveConflict(conflicts(a)[0], 'local'))
            ).rejects.toThrow();
            vi.restoreAllMocks();
            const lineage = serverScope(0, userScope(a))!.lineage;
            expect((await a.db.getSyncScopeState(userScope(a))).lineage).toBe(lineage);

            // A's replica is the new lineage: the second server's old one does not merge in.
            a.pb = await signIn(SERVERS[1]!, user);
            restart(a);
            expect(await sync(a)).toBe('unsafe_merge');
            expect(await names(a)).toEqual(['x']);
            a.pb = await signIn(SERVERS[0]!, user);
            restart(a);
            expect(await sync(a)).toBe('idle');
            expect((await a.db.getSyncScopeState(userScope(a))).bootstrapping).toBeNull();
            expect(serverRow(0, 'y')).toBeUndefined();
        });

        it('lets a replacement wait for a buffered Push in flight instead of sending after it', async () => {
            const user = await createUser(SERVERS[0]!);
            const a = await createDevice('A', SERVERS[0]!, user);
            await write(a, 'x', 'x');
            await write(a, 'y', 'server-y');
            await sync(a);
            const b = await createDevice('B', SERVERS[0]!, user);
            await sync(b);
            await write(a, 'y', 'in-flight');
            const engine = a.engine as unknown as {
                pushBufferedWrites(writes: unknown[]): Promise<void>;
                localToPbRecord(...args: unknown[]): Promise<Record<string, unknown>>;
            };
            const encode = engine.localToPbRecord.bind(engine);
            let ready!: () => void;
            let release!: () => void;
            const paused = new Promise<void>((resolve) => (ready = resolve));
            const resume = new Promise<void>((resolve) => (release = resolve));
            let first = true;
            vi.spyOn(engine, 'localToPbRecord').mockImplementation(async (...args) => {
                const payload = await encode(...args);
                if (first) {
                    first = false;
                    ready();
                    await resume;
                }
                return payload;
            });
            await on(a, async () => {
                const flushing = engine.pushBufferedWrites([
                    { bucket: 'characters', id: rid('y') }
                ]);
                await paused;
                await remove(b, 'x');
                await sync(b);
                await collectOnServer(0, 'x');
                expect(await sync(a)).toBe('unsafe_merge');
                let adopted = false;
                const resolving = a.engine
                    .resolveConflict(conflicts(a)[0], 'server')
                    .then(() => (adopted = true));
                // The adoption does not read the server while a Push of the old replica is
                // in flight.
                await new Promise((resolve) => setTimeout(resolve, 200));
                expect(adopted).toBe(false);
                release();
                await flushing;
                await resolving;
            });
            // The Push landed before the adoption read the server, so it is part of the
            // adopted state; nothing of the old replica arrives afterwards.
            const after = await names(a);
            expect(after).toEqual(['in-flight']);
            expect(await sync(a)).toBe('idle');
            expect(await names(a)).toEqual(after);
        });

        it('refuses to apply a conflict resolution twice', async () => {
            const user = await createUser(SERVERS[0]!);
            const source = await createDevice('Source', SERVERS[0]!, user);
            await write(source, 'x', 'server-x');
            await sync(source);
            const a = await createDevice('A', SERVERS[0]!, user);
            await write(a, 'y', 'original-local');
            expect(await sync(a)).toBe('init_required');
            const conflict = conflicts(a)[0];
            await on(a, () => a.engine.resolveConflict(conflict, 'server'));
            await write(a, 'y', 'edit-after-resolution');
            await expect(
                on(a, () => a.engine.resolveConflict(conflict, 'server'))
            ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
            expect(await names(a)).toEqual(['edit-after-resolution', 'server-x']);
        });

        it('keeps the gate closed until an adoption is durably recorded', async () => {
            const user = await createUser(SERVERS[0]!);
            const source = await createDevice('Source', SERVERS[0]!, user);
            await write(source, 'x', 'server-x');
            await sync(source);
            const a = await createDevice('A', SERVERS[0]!, user);
            const save = a.db.setSyncScopeState.bind(a.db);
            vi.spyOn(a.db, 'setSyncScopeState').mockImplementation(async (scope, state) => {
                if (state.lineage !== null && !state.adopting) throw new Error('storage failure');
                return save(scope, state);
            });
            expect(await sync(a)).toBe('network_error');
            vi.restoreAllMocks();
            expect((await a.db.getSyncScopeState(userScope(a))).adopting).toBeTruthy();
            await write(a, 'y', 'held');
            await on(a, () =>
                (
                    a.engine as unknown as { pushBufferedWrites(writes: unknown[]): Promise<void> }
                ).pushBufferedWrites([{ bucket: 'characters', id: rid('y') }])
            ).catch(() => undefined);
            expect(serverRow(0, 'y')).toBeUndefined();
            restart(a);
            expect(await sync(a)).toBe('idle');
            expect((await a.db.getSyncScopeState(userScope(a))).adopting).toBeNull();
        });

        it('does not take over a lease it lost the race for', async () => {
            const user = await createUser(SERVERS[0]!);
            await createUser(SERVERS[1]!, user);
            const a = await createDevice('A', SERVERS[0]!, user);
            await write(a, 'x', 'x');
            await write(a, 'y', 'y');
            await sync(a);
            const b = await createDevice('B', SERVERS[0]!, user);
            await sync(b);
            await remove(b, 'x');
            await sync(b);
            await age(b, 'characters', { tombstoneAt: 1 });
            await sync(b);
            expect(await b.db.getSyncGcHigh(userScope(b))).toBeGreaterThan(0);
            a.pb = await signIn(SERVERS[1]!, user);
            restart(a);
            b.pb = await signIn(SERVERS[1]!, user);
            restart(b);
            // Both see the empty second server; B wins the initialization and is cut off.
            const send = a.pb.send.bind(a.pb);
            let raced = false;
            vi.spyOn(a.pb, 'send').mockImplementation(async (path, options) => {
                if (path === '/api/sync/bootstrap' && !raced) {
                    raced = true;
                    failCommit(b);
                    expect(await sync(b)).toBe('network_error');
                }
                return send(path, options);
            });
            expect(await sync(a)).not.toBe('idle');
            vi.restoreAllMocks();

            expect(await sync(a)).toBe('server_initializing');
            expect(serverRow(1, 'x')).toBeUndefined();
            restart(b);
            expect(await sync(b)).toBe('idle');
            expect(serverRow(1, 'x')).toBeUndefined();
            expect(serverRow(1, 'y')).toMatchObject({ isDeleted: 0 });
        });

        it('keeps records an automatic adoption kept when it is interrupted', async () => {
            const user = await createUser(SERVERS[0]!);
            const source = await createDevice('Source', SERVERS[0]!, user);
            await write(source, 'x', 'server-x');
            await sync(source);
            const a = await createDevice('A', SERVERS[0]!, user);
            const send = a.pb.send.bind(a.pb);
            let written = false;
            let failed = false;
            vi.spyOn(a.pb, 'send').mockImplementation(async (path, options) => {
                if (path === '/api/sync/adopt' && !failed) {
                    failed = true;
                    throw new Error('connection lost');
                }
                const response = await send(path, options);
                if (path === '/api/sync/handshake' && !written) {
                    written = true;
                    await write(a, 'y', 'new-local');
                }
                return response;
            });
            // Interrupted before the server's knowledge was taken over: started again.
            expect(await sync(a)).toBe('network_error');
            vi.restoreAllMocks();
            restart(a);
            // Interrupted after it, while pulling: continued.
            failCommit(a);
            await write(a, 'z', 'during-adoption');
            expect(await sync(a)).toBe('network_error');
            expect((await a.db.getSyncScopeState(userScope(a))).adopting?.adopted).toBeTruthy();
            vi.restoreAllMocks();
            restart(a);
            expect(await sync(a)).toBe('idle');
            expect(await names(a)).toEqual(['during-adoption', 'new-local', 'server-x']);
            expect(serverRow(0, 'y')).toMatchObject({ isDeleted: 0 });
            expect(serverRow(0, 'z')).toMatchObject({ isDeleted: 0 });
        });

        it('drops a merge authorized for a room replica that was purged meanwhile', async () => {
            const user = await createUser(SERVERS[0]!);
            const a = await createDevice('A', SERVERS[0]!, user);
            const roomId = unique('room');
            const now = Date.now();
            await a.pb.collection('multi_room_index').create({
                id: roomId,
                ownerUserId: user.id,
                visibility: 'private',
                createdAt: now,
                updatedAt: now
            });
            await a.pb.collection('multi_room_members').create({
                roomId,
                userId: user.id,
                status: 'accepted',
                createdAt: now,
                updatedAt: now
            });
            const roomKey = await crypto.subtle.generateKey(
                { name: 'AES-GCM', length: 256 },
                true,
                ['encrypt', 'decrypt']
            );
            const room: DataScope = { scopeType: 'room', scopeId: roomId };
            a.session = { ...a.session, roomId, roomKey };
            await write(a, 'x', 'old-x', room);
            await sync(a);
            const old = await a.pb.collection('multi_room_records').getOne(rid('x'));
            const engine = a.engine as unknown as {
                pbToLocalRecord(...args: unknown[]): Promise<unknown>;
                handleRealtimeEvent(...args: unknown[]): Promise<void>;
            };
            const decode = engine.pbToLocalRecord.bind(engine);
            let release!: () => void;
            let ready!: () => void;
            const held = new Promise<void>((resolve) => (release = resolve));
            const started = new Promise<void>((resolve) => (ready = resolve));
            let first = true;
            vi.spyOn(engine, 'pbToLocalRecord').mockImplementation(async (...args) => {
                if (first) {
                    first = false;
                    ready();
                    await held;
                }
                return decode(...args);
            });

            await on(a, async () => {
                // A room event of the old replica is still decrypting...
                const merging = engine.handleRealtimeEvent(
                    'multi_room_records',
                    normalizeUrl(SERVERS[0]!),
                    { action: 'update', record: old }
                );
                await started;
                // ...while another device replaces the room and A leaves it.
                const c = await createDevice('C', SERVERS[0]!, user);
                c.session = { ...c.session, roomId, roomKey };
                await write(c, 'y', 'new-y', room);
                expect(await sync(c)).toBe('init_required');
                await on(c, () =>
                    c.engine.resolveConflict(
                        conflicts(c).find(({ scope }) => scope.scopeType === 'room')!,
                        'local'
                    )
                );
                a.session = { ...a.session, roomId: undefined, roomKey: undefined };
                const { MultiRoomService } = await import('$lib/services/multi');
                const { DataRecordSyncEngine } = await import('$lib/services/sync');
                // The service purges through the app's engine; here that is A's.
                vi.spyOn(DataRecordSyncEngine, 'discardReplica').mockImplementation((scope) =>
                    a.engine.discardReplica(scope)
                );
                await MultiRoomService.purgeLocalRoomContent(roomId);
                // The event resumes only after the purge.
                release();
                await merging;
            });
            expect(await a.db.hasScopeRecords(room)).toBe(false);

            // Rejoining adopts the room afresh; the old event is not part of it.
            a.session = { ...a.session, roomId, roomKey };
            expect(await sync(a)).toBe('idle');
            expect(await names(a, room)).toEqual(['new-y']);
            expect(serverRow(0, 'x')).toBeUndefined();
        });

        it('re-adopts a purged room on rejoin while the user scope keeps syncing', async () => {
            const user = await createUser(SERVERS[0]!);
            const a = await createDevice('A', SERVERS[0]!, user);
            const roomId = unique('room');
            const now = Date.now();
            await a.pb.collection('multi_room_index').create({
                id: roomId,
                ownerUserId: user.id,
                visibility: 'private',
                createdAt: now,
                updatedAt: now
            });
            await a.pb.collection('multi_room_members').create({
                roomId,
                userId: user.id,
                status: 'accepted',
                createdAt: now,
                updatedAt: now
            });
            const roomKey = await crypto.subtle.generateKey(
                { name: 'AES-GCM', length: 256 },
                true,
                ['encrypt', 'decrypt']
            );
            const room: DataScope = { scopeType: 'room', scopeId: roomId };
            a.session = { ...a.session, roomId, roomKey };
            await write(a, 'room-1', 'room-one', room);
            await write(a, 'room-2', 'room-two', room);
            await remove(a, 'room-2');
            expect(await sync(a)).toBe('idle');

            const b = await createDevice('B', SERVERS[0]!, user);
            b.session = { ...b.session, roomId, roomKey };
            expect(await sync(b)).toBe('idle');
            await write(b, 'mine', 'mine');
            expect(await names(b, room)).toEqual(['room-one']);

            // Leaving purges the room locally (MultiRoomService.purgeLocalRoomContent): the
            // replica is discarded, and its tombstone forgotten.
            await b.db.setSyncScopeState(room, {
                lineage: null,
                adopting: null,
                bootstrapping: null
            });
            await b.db.deleteByScope('characters', room);
            await on(b, async () => {
                const { syncCursorDB } = await import('$lib/adapters/sync');
                await syncCursorDB.deleteByScope(user.id, 'records', room);
            });
            expect(await b.db.getSyncGcHigh(room)).toBeGreaterThan(0);

            await write(b, 'mine-2', 'mine-2');
            expect(await sync(b)).toBe('idle');
            expect(conflicts(b)).toEqual([]);
            expect(await names(b, room)).toEqual(['room-one']);
            expect(serverRow(0, 'mine-2')).toMatchObject({ isDeleted: 0 });
        });
    }
);
