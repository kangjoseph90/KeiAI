// @vitest-environment node
/**
 * Merge-safety races (docs/sync-gc.md), found as counterexamples by an independent model check.
 *
 * Each test interleaves a local change, a session, or GC at a point the production code awaits,
 * against the real sync engine, safety module, Web adapter (Dexie on fake-indexeddb) and the
 * server's own arbitration and create guard. A deleted record must never come back live.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import fakeIndexedDB, { IDBKeyRange } from 'fake-indexeddb';
import { deflateSync, strToU8 } from 'fflate';
import { createRequire } from 'node:module';
import { WebDatabaseAdapter } from '$lib/adapters/db/web';
import { DataRecordSyncEngineImpl } from '$lib/services/sync/data';
import type { DataRecord, DataScope } from '$lib/adapters/db/types';

interface ServerRow {
    id: string;
    userId: string;
    kind: string;
    createdAt: number;
    updatedAt: number;
    isDeleted: boolean;
    encryptedData: string;
    encryptedDataIV: string;
    serverUpdatedAt: number;
    tombstoneAt?: number;
}

interface ServerHooks {
    assertSyncWriteTransactional(e: unknown): void;
    assertSyncWriteAllowed(e: unknown): void;
    assertSyncCreateCovered(e: unknown): void;
    applySyncRecordUpdate(record: unknown, collectionName: string): boolean;
    stampSyncRecordCreate(record: unknown): void;
}

interface Pushed {
    body: ServerRow;
    headers: Record<string, string>;
}

const h = vi.hoisted(() => ({
    db: null as unknown as WebDatabaseAdapter,
    cursors: { serverPullCursor: 0, localPushCursor: 0 },
    rows: new Map<string, ServerRow>(),
    revision: 0,
    gcHigh: 0,
    checkpoints: new Map<string, { anchor: number; heldAt: number }>(),
    sent: [] as Pushed[],
    server: null as unknown as ServerHooks,
    /** When armed, the next cursor read or decryption waits for it: a handler's first await. */
    firstAwait: null as Promise<void> | null
}));

async function pauseIfArmed(): Promise<void> {
    const paused = h.firstAwait;
    h.firstAwait = null;
    if (paused) await paused;
}

vi.mock('$lib/adapters/db', () => ({
    SYNC_TABLES: ['characters'],
    localDB: new Proxy(
        {},
        {
            get:
                (_target, key: string) =>
                (...args: unknown[]) =>
                    (h.db as unknown as Record<string, (...a: unknown[]) => unknown>)[key](...args)
        }
    )
}));

vi.mock('$lib/adapters/sync', () => ({
    syncCursorDB: {
        get: async () => {
            await pauseIfArmed();
            return { ...h.cursors };
        },
        advance: async (
            _identity: unknown,
            update: { serverPullCursor?: number; localPushCursor?: number }
        ) => {
            h.cursors.serverPullCursor = Math.max(
                h.cursors.serverPullCursor,
                update.serverPullCursor ?? 0
            );
            h.cursors.localPushCursor = Math.max(
                h.cursors.localPushCursor,
                update.localPushCursor ?? 0
            );
        }
    }
}));

vi.mock('$lib/services/session', () => ({
    hasActiveSession: () => true,
    getActiveSession: () => ({ userId: 'user', masterKey: {} })
}));

vi.mock('$lib/services/asset', () => ({ AssetService: {} }));

vi.mock('$lib/services/content/cascade', () => ({
    cascadeDeleteChildren: async () => ({ deleted: {}, assetOwners: [] }),
    cleanupCascadeAssets: async () => {}
}));

vi.mock('$lib/crypto', () => ({
    toBase64: (bytes: Uint8Array) => Buffer.from(bytes).toString('base64'),
    fromBase64: (text: string) => new Uint8Array(Buffer.from(text, 'base64')),
    encryptBytes: async (_key: unknown, bytes: Uint8Array) => ({
        ciphertext: bytes,
        iv: new Uint8Array([1])
    }),
    decryptBytes: async (_key: unknown, data: { ciphertext: Uint8Array }) => {
        await pauseIfArmed();
        return data.ciphertext;
    }
}));

/** One server: committed rows, a revision counter, the GC watermark, and checkpoints. */
vi.mock('$lib/adapters/pb', () => {
    const coverage = (pullCursor: number, ids: string[]) =>
        Math.max(
            pullCursor,
            ...ids.filter((id) => h.checkpoints.has(id)).map((id) => h.checkpoints.get(id)!.anchor)
        );
    const facade = (data: ServerRow, old: ServerRow | undefined) => ({
        id: data.id,
        original: () =>
            old ? { id: data.id, get: (key: string) => old[key as keyof ServerRow] } : null,
        get: (key: string) => data[key as keyof ServerRow],
        set: (key: string, value: unknown) => {
            (data as unknown as Record<string, unknown>)[key] = value;
        },
        getBool: (key: string) => !!data[key as keyof ServerRow],
        getString: (key: string) => String(data[key as keyof ServerRow]),
        collection: () => ({ name: 'records' })
    });
    const app = {
        isTransactional: () => true,
        db: () => ({
            newQuery: () => ({
                bind() {
                    return this;
                },
                one(row: { gcHigh: number; lineage: string }) {
                    row.gcHigh = h.gcHigh;
                    row.lineage = LINEAGE;
                }
            })
        })
    };
    return {
        pb: {
            baseUrl: 'https://server.example',
            authStore: { isValid: true },
            filter: (_template: string, params: unknown) => JSON.stringify(params),
            collection: () => ({
                getList: async (_page: number, _size: number, options: { filter: string }) => {
                    const { after, through } = JSON.parse(options.filter) as {
                        after: number;
                        through: number;
                    };
                    return {
                        items: [...h.rows.values()]
                            .filter(
                                (row) =>
                                    row.serverUpdatedAt > after && row.serverUpdatedAt <= through
                            )
                            .sort((a, b) => a.serverUpdatedAt - b.serverUpdatedAt)
                            .map((row) => structuredClone(row))
                    };
                }
            }),
            send: async (path: string, options: { body: Record<string, unknown> }) => {
                if (path === '/api/now') return { now: h.revision };
                const body = options.body as {
                    pullCursor: number;
                    checkpoints: string[];
                    serverUpper: number;
                    inherit: string[];
                    checkpoint?: string;
                };
                if (path === '/api/sync/handshake') {
                    const known = body.checkpoints.filter((id) => h.checkpoints.has(id));
                    return {
                        gcHigh: h.gcHigh,
                        coverage: coverage(body.pullCursor, known),
                        known,
                        lineage: LINEAGE,
                        initializing: null,
                        hasRecords: true
                    };
                }
                if (path === '/api/sync/commit') {
                    if (h.gcHigh > coverage(body.pullCursor, body.checkpoints)) {
                        throw { response: { code: 'sync_unsafe' } };
                    }
                    const heldAt = ++h.revision;
                    if (body.checkpoint) {
                        h.checkpoints.set(body.checkpoint, { anchor: body.serverUpper, heldAt });
                    }
                    for (const id of body.inherit) {
                        if (!h.checkpoints.has(id)) h.checkpoints.set(id, { anchor: 0, heldAt });
                    }
                    return {
                        checkpoints: [...h.checkpoints]
                            .filter(
                                ([, k]) =>
                                    k.heldAt > body.pullCursor && k.heldAt <= body.serverUpper
                            )
                            .map(([id]) => id)
                    };
                }
                throw new Error(`Unexpected request ${path}`);
            },
            createBatch: () => {
                const pending: Pushed[] = [];
                return {
                    collection: () => ({
                        upsert: (body: ServerRow, options: { headers: Record<string, string> }) =>
                            pending.push({ body, headers: options.headers })
                    }),
                    send: async () =>
                        pending.map(({ body, headers }) => {
                            h.sent.push(structuredClone({ body, headers }));
                            const old = h.rows.get(body.id);
                            const data = structuredClone(body);
                            const record = facade(data, old);
                            const requestInfo = () => ({
                                headers: {
                                    x_kei_sync_coverage: headers['X-Kei-Sync-Coverage'],
                                    x_kei_sync_lineage: headers['X-Kei-Sync-Lineage']
                                }
                            });
                            h.server.assertSyncWriteTransactional({ app });
                            h.server.assertSyncWriteAllowed({ app, record, requestInfo });
                            if (!old) {
                                h.server.assertSyncCreateCovered({ app, record, requestInfo });
                                h.server.stampSyncRecordCreate(record);
                            }
                            const accepted = old
                                ? h.server.applySyncRecordUpdate(record, 'records')
                                : true;
                            if (accepted) {
                                data.serverUpdatedAt = ++h.revision;
                                h.rows.set(body.id, data);
                            }
                            return { status: 200, body: structuredClone(h.rows.get(body.id)) };
                        })
                };
            }
        }
    };
});

const require = createRequire(import.meta.url);
const LINEAGE = 'lineage-1';
const scope: DataScope = { scopeType: 'user', scopeId: 'user' };
const DAY = 24 * 60 * 60 * 1000;

const local = (id = 'x', updatedAt = 1, value = 'old'): DataRecord => ({
    id,
    ...scope,
    createdAt: 1,
    updatedAt,
    isDeleted: false,
    data: { value }
});

function remote(id = 'x', updatedAt = 1, value = 'old'): void {
    h.rows.set(id, {
        id,
        userId: 'user',
        kind: 'characters',
        createdAt: 1,
        updatedAt,
        isDeleted: false,
        encryptedData: Buffer.from(
            deflateSync(strToU8(JSON.stringify({ data: { value } })))
        ).toString('base64'),
        encryptedDataIV: 'AQ==',
        serverUpdatedAt: ++h.revision
    });
}

/** Run `before` right before the next local transaction opens, then let it proceed. */
function beforeNextTransaction(before: () => Promise<void>): void {
    const real = h.db.transaction.bind(h.db);
    vi.spyOn(h.db, 'transaction').mockImplementationOnce(async (tables, mode, callback) => {
        await before();
        return real(tables, mode, callback);
    });
}

const serverRow = (id: string) => h.rows.get(id);
const localRow = (id: string) => h.db.getRecord('characters', id);

beforeEach(async () => {
    Dexie.dependencies.indexedDB = fakeIndexedDB;
    Dexie.dependencies.IDBKeyRange = IDBKeyRange;
    await Dexie.delete('KeiLocalDB');
    h.db = new WebDatabaseAdapter();
    await h.db.setSyncScopeState(scope, { lineage: LINEAGE, adopting: null, bootstrapping: null });
    h.cursors = { serverPullCursor: 0, localPushCursor: 0 };
    h.rows.clear();
    h.revision = 0;
    h.gcHigh = 0;
    h.checkpoints.clear();
    h.sent = [];
    h.firstAwait = null;
    h.server = require('../../../../pocketbase/pb_hooks/keiai.js') as ServerHooks;
    Object.assign(globalThis, {
        DynamicModel: class {
            constructor(value: object) {
                Object.assign(this, value);
            }
        },
        ApiError: class extends Error {
            constructor(
                public status: number,
                message: string
            ) {
                super(message);
            }
        }
    });
});

afterEach(async () => {
    vi.restoreAllMocks();
    (h.db as unknown as { db: Dexie }).db.close();
    await Dexie.delete('KeiLocalDB');
});

it('Pull merges a local deletion committed before its write instead of overwriting it', async () => {
    await h.db.putRecord('characters', local());
    remote('x', 2, 'new');
    const engine = new DataRecordSyncEngineImpl();
    // The remote version wins against the live record Pull would have seen earlier.
    beforeNextTransaction(() => h.db.softDeleteRecord('characters', 'x'));

    await engine.trigger();

    expect((await localRow('x'))?.isDeleted).toBe(true);
    // The deletion is not lost: it reaches the server and the cursor never passes it unsent.
    expect(serverRow('x')?.isDeleted).toBe(true);
    expect(engine.getState().state).toBe('idle');
});

it('Push responses merge a local deletion committed before their write', async () => {
    await h.db.putRecord('characters', local());
    remote('x', 2, 'server');
    const engine = new DataRecordSyncEngineImpl();
    const outgoing = (await localRow('x'))!;
    beforeNextTransaction(() => h.db.softDeleteRecord('characters', 'x'));

    await (
        engine as unknown as {
            pushChanges(...args: unknown[]): Promise<void>;
        }
    ).pushChanges(
        { scope, key: {}, collection: 'records', ownerField: 'userId' },
        'https://server.example',
        [{ table: 'characters', record: outgoing }],
        { coverage: 0, lineage: LINEAGE, epoch: 0 },
        false
    );

    expect((await localRow('x'))?.isDeleted).toBe(true);
});

it('a buffered Push reads its records after taking coverage, so a later deletion is what it sends', async () => {
    await h.db.putRecord('characters', local());
    remote();
    const engine = new DataRecordSyncEngineImpl();
    await engine.trigger();
    const start = Date.now();
    const wall = vi.spyOn(Date, 'now').mockReturnValue(start);
    // Pause the flush after it took coverage; delete x, sync it, and let the server collect it.
    const realGcHigh = h.db.getSyncGcHigh.bind(h.db);
    vi.spyOn(h.db, 'getSyncGcHigh').mockImplementationOnce(async (gcScope) => {
        wall.mockReturnValue(start + 2 * DAY);
        await h.db.softDeleteRecord('characters', 'x');
        await engine.trigger();
        expect(serverRow('x')?.isDeleted).toBe(true);
        wall.mockReturnValue(start + 33 * DAY);
        h.gcHigh = serverRow('x')!.serverUpdatedAt;
        h.rows.delete('x');
        return realGcHigh(gcScope);
    });

    await (
        engine as unknown as { pushBufferedWrites(writes: unknown[]): Promise<void> }
    ).pushBufferedWrites([{ bucket: 'characters', id: 'x' }]);

    expect(serverRow('x')?.isDeleted ?? true).toBe(true);
    expect(h.sent.at(-1)?.body.isDeleted).toBe(true);
});

it('Realtime keeps the coverage it had on arrival, so an event older than a local GC is refused', async () => {
    await h.db.putRecord('characters', local());
    remote();
    const engine = new DataRecordSyncEngineImpl();
    await engine.trigger();
    const event = { action: 'update', record: structuredClone(serverRow('x')) };
    const start = Date.now();
    let release!: () => void;
    h.firstAwait = new Promise<void>((resolve) => (release = resolve));

    // The handler stops at its first await. Meanwhile x is deleted, synced, and collected.
    const handled = (
        engine as unknown as {
            handleRealtimeEvent(...args: unknown[]): Promise<void>;
        }
    ).handleRealtimeEvent('records', 'https://server.example', event);
    expect(h.firstAwait).toBeNull();
    await h.db.softDeleteRecord('characters', 'x');
    await engine.trigger();
    vi.spyOn(Date, 'now').mockReturnValue(start + 31 * DAY);
    await h.db.collectTombstones(scope, {
        receivedThrough: Date.now() - 30 * DAY,
        throughLocalUpdatedAt: h.cursors.localPushCursor
    });
    expect(await localRow('x')).toBeUndefined();
    release();
    await handled;

    expect(await localRow('x')).toBeUndefined();
});

it('a full session stops before Push once its Pull safety check fails', async () => {
    await h.db.putRecord('characters', local());
    await h.db.putRecord('characters', local('y', 10, 'outgoing'));
    remote('incoming', 2, 'incoming');
    const engine = new DataRecordSyncEngineImpl();
    // A purge forgets a deletion the server never received, beyond the session's coverage.
    beforeNextTransaction(async () => {
        await h.db.softDeleteRecord('characters', 'x');
        await h.db.deleteRecord('characters', 'x');
    });

    await engine.trigger();

    expect(engine.getState().state).toBe('unsafe_merge');
    expect(await localRow('incoming')).toBeUndefined();
    expect(serverRow('y')).toBeUndefined();
});

it('a buffered Push sends nothing once the local watermark exceeds the cached coverage', async () => {
    await h.db.putRecord('characters', local());
    remote();
    const engine = new DataRecordSyncEngineImpl();
    await engine.trigger();
    await h.db.softDeleteRecord('characters', 'x');
    await h.db.deleteRecord('characters', 'x');
    expect(await h.db.getSyncGcHigh(scope)).toBeGreaterThan(h.cursors.localPushCursor);
    await h.db.putRecord('characters', local('y', 10, 'moved'));

    await (
        engine as unknown as { pushBufferedWrites(writes: unknown[]): Promise<void> }
    ).pushBufferedWrites([{ bucket: 'characters', id: 'y' }]);
    // The gate asked for a full session, which must refuse the unproven merge.
    await engine.trigger();

    expect(serverRow('y')).toBeUndefined();
    expect(engine.getState().state).toBe('unsafe_merge');
});
