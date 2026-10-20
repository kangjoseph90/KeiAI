import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { deflateSync, strToU8 } from 'fflate';
import { WebDatabaseAdapter } from '$lib/adapters/db/web';
import { localDB, type DataRecord } from '$lib/adapters/db';
import { syncCursorDB } from '$lib/adapters/sync';
import { pb } from '$lib/adapters/pb';
import { encryptBytes, toBase64 } from '$lib/crypto';

const harness = vi.hoisted(() => ({
    key: undefined as CryptoKey | undefined,
    engine: undefined as { stop(): Promise<void> } | undefined
}));

const assetMock = vi.hoisted(() => ({
    getRemoteAssets: vi.fn(),
    load: vi.fn(),
    markLocalBatch: vi.fn(),
    markRemoteBatch: vi.fn(),
    stopEviction: vi.fn(),
    resumeEviction: vi.fn()
}));
const userMock = vi.hoisted(() => ({ getUser: vi.fn(), updateConnections: vi.fn() }));
const authMock = vi.hoisted(() => ({
    persistPbAuth: vi.fn(),
    restorePbAuth: vi.fn(),
    stopAutoRefresh: vi.fn(),
    startAutoRefresh: vi.fn()
}));
const httpMock = vi.hoisted(() => ({
    fetch: vi.fn(),
    configureProxy: vi.fn(),
    getProxyConfig: vi.fn(() => ({ mode: 'direct' as const }))
}));

vi.mock('$lib/services/session', () => ({
    hasActiveSession: () => true,
    getActiveSession: () => ({ userId: 'migrationuser01', masterKey: harness.key })
}));
vi.mock('$lib/services/asset', () => ({ AssetService: assetMock }));
vi.mock('$lib/services/content/cascade', () => ({
    cascadeDeleteChildren: vi.fn(),
    cleanupCascadeAssets: vi.fn()
}));
vi.mock('$lib/services/user', () => ({ UserService: userMock }));
vi.mock('$lib/services/auth', () => ({ AuthService: authMock }));
vi.mock('$lib/adapters/http', () => ({ appHttp: httpMock }));
vi.mock('$lib/services/sync', () => ({
    SyncManager: {
        stopAutoSync: () => harness.engine?.stop(),
        startAutoSync: vi.fn()
    }
}));

import { ConnectionService } from '$lib/services/connection/service';
import { DataRecordSyncEngineImpl } from '$lib/services/sync/data';

function record(id: string, updatedAt: number, name: string): DataRecord {
    return {
        id,
        scopeType: 'user',
        scopeId: 'migrationuser01',
        createdAt: 1,
        updatedAt,
        isDeleted: false,
        data: { name }
    };
}

async function toRemote(value: DataRecord): Promise<Record<string, unknown> & { id: string }> {
    const encrypted = await encryptBytes(
        harness.key!,
        deflateSync(strToU8(JSON.stringify({ data: value.data })))
    );
    return {
        id: value.id,
        userId: value.scopeId,
        kind: 'characters',
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
        isDeleted: value.isDeleted,
        assetEntries: '',
        serverUpdatedAt: 50,
        encryptedData: toBase64(encrypted.ciphertext),
        encryptedDataIV: toBase64(encrypted.iv)
    };
}

describe('connection transition with in-flight data sync', () => {
    let db: WebDatabaseAdapter;
    let engine: DataRecordSyncEngineImpl;

    beforeEach(async () => {
        vi.clearAllMocks();
        await Dexie.delete('KeiLocalDB');
        await Dexie.delete('KeiSyncCursors');
        db = new WebDatabaseAdapter();
        engine = new DataRecordSyncEngineImpl();
        harness.engine = engine;
        harness.key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
            'encrypt',
            'decrypt'
        ]);
        Object.assign(pb, { baseUrl: 'https://old.example.test' });
        Object.assign(pb.authStore, { isValid: true });
        vi.spyOn(localDB, 'getRecord').mockImplementation(db.getRecord.bind(db));
        vi.spyOn(localDB, 'putRecord').mockImplementation(db.putRecord.bind(db));
        vi.spyOn(localDB, 'putRecords').mockImplementation(db.putRecords.bind(db));
        vi.spyOn(localDB, 'getLocalUpdatedAt').mockImplementation(db.getLocalUpdatedAt.bind(db));
        vi.spyOn(localDB, 'getUnsyncedChanges').mockImplementation(db.getUnsyncedChanges.bind(db));
        vi.spyOn(localDB, 'transaction').mockImplementation(db.transaction.bind(db));
        userMock.getUser.mockImplementation(async () => ({
            id: 'migrationuser01',
            connections: {
                server: { mode: 'custom', customUrl: pb.baseUrl },
                proxy: { mode: 'off' }
            }
        }));
        userMock.updateConnections.mockImplementation(async (_id, connections) => ({
            id: 'migrationuser01',
            connections
        }));
        authMock.persistPbAuth.mockResolvedValue(undefined);
        // Both destinations have a saved, valid token for this portable identity.
        authMock.restorePbAuth.mockResolvedValue(true);
        assetMock.getRemoteAssets.mockResolvedValue([]);
        assetMock.markLocalBatch.mockResolvedValue(undefined);
        assetMock.markRemoteBatch.mockResolvedValue(undefined);
        httpMock.fetch.mockImplementation(
            async () => new Response(JSON.stringify({ app: 'keiai', protocol: 1 }), { status: 200 })
        );
    });

    afterEach(async () => {
        await engine.stop();
        harness.engine = undefined;
        vi.restoreAllMocks();
        await Dexie.delete('KeiLocalDB');
        await Dexie.delete('KeiSyncCursors');
    });

    it('finishes old-server sync before applying the destination runtime', async () => {
        const local = record('migrationrecord', 20, 'local-newer');
        const oldRemote = await toRemote(record('migrationrecord', 10, 'old-server-value'));
        await db.putRecord('characters', local);

        const oldServerWrites: Record<string, unknown>[] = [];
        const destinationWrites: Record<string, unknown>[] = [];
        let oldPullStarted!: () => void;
        let releaseOldPull!: () => void;
        const oldPullStartedPromise = new Promise<void>((resolve) => {
            oldPullStarted = resolve;
        });
        const oldPullGate = new Promise<void>((resolve) => {
            releaseOldPull = resolve;
        });
        let firstOldPull = true;
        vi.mocked(pb.send).mockImplementation(async () => ({ now: 100 }));
        vi.mocked(pb.filter).mockImplementation((_template, params) => JSON.stringify(params));
        vi.mocked(pb.collection).mockImplementation(
            (collection) =>
                ({
                    getList: async (
                        page: number,
                        _perPage: number,
                        options: { filter: string }
                    ) => {
                        if (pb.baseUrl === 'https://old.example.test') {
                            if (firstOldPull) {
                                firstOldPull = false;
                                oldPullStarted();
                                await oldPullGate;
                            }
                            const { after, through } = JSON.parse(options.filter) as {
                                after: number;
                                through: number;
                            };
                            const serverUpdatedAt = oldRemote.serverUpdatedAt as number;
                            const items =
                                serverUpdatedAt > after && serverUpdatedAt <= through
                                    ? [structuredClone(oldRemote)]
                                    : [];
                            return { items: page === 1 ? items : [], page, totalPages: 1 };
                        }
                        return { items: [], page, totalPages: 1 };
                    }
                }) as ReturnType<typeof pb.collection>
        );
        Object.assign(pb, {
            createBatch: () => {
                const writes: Record<string, unknown>[] = [];
                return {
                    collection: () => ({
                        upsert: (value: Record<string, unknown>) => writes.push(value)
                    }),
                    send: async () => {
                        const target =
                            pb.baseUrl === 'https://old.example.test'
                                ? oldServerWrites
                                : destinationWrites;
                        target.push(...writes);
                        return writes.map((write) => ({
                            status: 200,
                            body: { ...write, serverUpdatedAt: 75 }
                        }));
                    }
                };
            }
        });

        const syncPromise = engine.trigger();
        await oldPullStartedPromise;
        const transition = ConnectionService.changeServerConnection({
            mode: 'custom',
            customUrl: 'https://new.example.test'
        });
        await vi.waitFor(() => expect(ConnectionService.isServerTransitionLocked()).toBe(true));
        expect(pb.baseUrl).toBe('https://old.example.test');
        expect(userMock.updateConnections).not.toHaveBeenCalled();
        releaseOldPull();
        await Promise.all([syncPromise, transition]);
        expect(pb.baseUrl).toBe('https://new.example.test');

        const oldCursor = await syncCursorDB.get({
            serverUrl: 'https://old.example.test',
            userId: 'migrationuser01',
            stream: 'records',
            scopeType: 'user',
            scopeId: 'migrationuser01'
        });
        expect(oldServerWrites).toHaveLength(1);
        expect(destinationWrites).toHaveLength(0);
        expect(oldServerWrites[0]).toMatchObject({
            id: 'migrationrecord',
            userId: 'migrationuser01'
        });
        expect(oldCursor.serverPullCursor).toBe(100);
        expect(oldCursor.localPushCursor).toBeGreaterThan(0);

        await ConnectionService.changeServerConnection({
            mode: 'custom',
            customUrl: 'https://old.example.test'
        });
        engine.resume();
        await engine.trigger();
        expect(oldServerWrites).toHaveLength(1);
        expect((await db.getRecord('characters', 'migrationrecord'))?.data).toEqual({
            name: 'local-newer'
        });
    });
});
