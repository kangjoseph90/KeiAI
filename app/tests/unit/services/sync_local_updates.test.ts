import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import { DataRecordSyncEngineImpl } from '$lib/services/sync/data';
import { MultiRecordSyncEngineImpl } from '$lib/services/sync/multi';
import { localDB, type DataRecord, type DataScope } from '$lib/adapters/db';
import { appMulti } from '$lib/adapters/multi';
import { multiDB } from '$lib/adapters/multi/web';
import { syncCursorDB } from '$lib/adapters/sync';
import { encryptBytes, decryptBytes, toBase64, fromBase64 } from '$lib/crypto';
import { getActiveSession } from '$lib/services/session';
import { pb } from '$lib/adapters/pb';
import type { RealtimeEvent } from '$lib/services/sync/utils';

type Remote = Record<string, unknown>;
const network = vi.hoisted(() => ({
    incoming: {} as Record<string, Remote[]>,
    responses: {} as Record<string, Remote>,
    sent: [] as Array<{ server: string; collection: string; record: Remote }>,
    failPush: false,
    handlers: {} as Record<string, (event: RealtimeEvent) => void>
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }));
vi.mock('$lib/services/session', () => ({
    getActiveSession: vi.fn(),
    hasActiveSession: () => true
}));
vi.mock('$lib/services', () => ({ MultiRoomService: { purgeLocalRoomContent: vi.fn() } }));
vi.mock('$lib/services/asset', () => ({ AssetService: {} }));
vi.mock('$lib/services/content/cascade', () => ({
    cascadeDeleteChildren: vi.fn(),
    cleanupCascadeAssets: vi.fn()
}));
vi.mock('$lib/adapters/pb', () => ({
    pb: {
        baseUrl: 'https://a.test',
        authStore: { isValid: true },
        send: async () => ({ now: 3000 }),
        filter: vi.fn((template: string) => template),
        collection: (collection: string) => ({
            subscribe: async (_topic: string, handler: (event: RealtimeEvent) => void) => {
                network.handlers[collection] = handler;
            },
            unsubscribe: async () => {
                delete network.handlers[collection];
            },
            getList: async () => {
                return { items: network.incoming[collection] ?? [], page: 1, totalPages: 1 };
            }
        }),
        createBatch: () => {
            const entries: Array<{ collection: string; record: Remote }> = [];
            return {
                collection: (collection: string) => ({
                    upsert: (record: Remote) => entries.push({ collection, record })
                }),
                send: async () => {
                    if (network.failPush) throw new Error('offline');
                    return entries.map(({ collection, record }) => {
                        network.sent.push({ server: pb.baseUrl, collection, record });
                        return { status: 200, body: network.responses[collection] ?? record };
                    });
                }
            };
        }
    }
}));

const userScope: DataScope = { scopeType: 'user', scopeId: 'owner' };
const roomScope: DataScope = { scopeType: 'room', scopeId: 'room' };
let key: CryptoKey;
const identity = (stream: 'records' | 'multi_meta', scope = userScope) => ({
    serverUrl: pb.baseUrl,
    userId: 'owner',
    stream,
    ...scope
});
const record = (id: string, scope = userScope): DataRecord => ({
    id,
    ...scope,
    createdAt: 1,
    updatedAt: 1,
    isDeleted: false,
    data: { text: id }
});
async function wire(
    id: string,
    updatedAt: number,
    scope = userScope,
    isDeleted = false
): Promise<Remote> {
    const encrypted = await encryptBytes(
        key,
        deflateSync(
            strToU8(
                JSON.stringify({
                    data: { text: id },
                    localUpdatedAt: 900000
                })
            )
        )
    );
    return {
        id,
        [scope.scopeType === 'user' ? 'userId' : 'roomId']: scope.scopeId,
        kind: 'characters',
        createdAt: 1,
        updatedAt,
        isDeleted,
        serverUpdatedAt: 2000,
        localUpdatedAt: 999999,
        encryptedData: toBase64(encrypted.ciphertext),
        encryptedDataIV: toBase64(encrypted.iv)
    };
}
// Deliver through the public subscription API and await the adapter's committed-write signal.
async function realtime(
    engine: DataRecordSyncEngineImpl | MultiRecordSyncEngineImpl,
    collection: string,
    remote: Remote
): Promise<void> {
    await engine.subscribeRealtime();
    const adapter =
        collection === 'records' || collection === 'multi_room_records' ? localDB : appMulti;
    let unsubscribe = () => {};
    try {
        await new Promise<void>((resolve) => {
            unsubscribe = adapter.subscribeWriteEvents(
                (events: Array<{ origin: string; ids: string[] }>) => {
                    if (
                        events.some(
                            (event) =>
                                event.origin === 'sync' && event.ids.includes(String(remote.id))
                        )
                    )
                        resolve();
                }
            );
            network.handlers[collection]({ action: 'update', record: remote });
        });
    } finally {
        unsubscribe();
        await engine.unsubscribeRealtime();
    }
}

beforeEach(async () => {
    await Dexie.delete('KeiLocalDB');
    multiDB.close();
    await Dexie.delete('KeiMulti');
    await multiDB.open();
    await syncCursorDB.deleteByUser('owner');
    network.incoming = {};
    network.responses = {};
    network.sent = [];
    network.failPush = false;
    network.handlers = {};
    pb.baseUrl = 'https://a.test';
    key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
        'encrypt',
        'decrypt'
    ]);
    vi.mocked(getActiveSession).mockReturnValue({
        userId: 'owner',
        masterKey: key,
        identityKeyPair: {} as CryptoKeyPair,
        roomId: 'room',
        roomKey: key
    });
});
afterEach(async () => {
    await Dexie.delete('KeiLocalDB');
    multiDB.close();
    await Dexie.delete('KeiMulti');
    await syncCursorDB.deleteByUser('owner');
});

describe.each([userScope, roomScope])('records in $scopeType scope', (scope) => {
    const collection = scope.scopeType === 'user' ? 'records' : 'multi_room_records';
    it.each(['Pull', 'Realtime', 'Push response'] as const)(
        'pushes a low updatedAt imported through %s from B back to A once',
        async (channel) => {
            const engine = new DataRecordSyncEngineImpl();
            // A's cursor is ahead of B's incoming LWW version.
            await localDB.putRecords('characters', [
                record('seed-1', scope),
                record('seed-2', scope),
                record('target', scope)
            ]);
            await engine.trigger();
            const cursor = (await syncCursorDB.get(identity('records', scope))).localPushCursor;
            expect(cursor).toBeGreaterThan(2);
            pb.baseUrl = 'https://b.test';
            const incoming = await wire('target', 2, scope);
            if (channel === 'Pull') {
                network.incoming[collection] = [incoming];
                await engine.trigger();
            } else if (channel === 'Realtime') {
                await realtime(engine, collection, incoming);
            } else {
                network.responses[collection] = incoming;
                await engine.trigger();
            }
            expect(engine.getState().state).toBe('idle');
            const accepted = await localDB.getRecord('characters', 'target');
            expect(accepted?.updatedAt).toBe(2);
            expect(accepted?.localUpdatedAt).toBeGreaterThan(cursor);
            expect(accepted?.localUpdatedAt).toBeLessThan(900000);
            const upper = await localDB.getLocalUpdateUpper();
            network.incoming[collection] = [incoming];
            await engine.trigger();
            network.incoming[collection] = [await wire('target', 1, scope)];
            await engine.trigger();
            expect(await localDB.getRecord('characters', 'target')).toEqual(accepted);
            expect(await localDB.getLocalUpdateUpper()).toBe(upper);

            pb.baseUrl = 'https://a.test';
            network.incoming = {};
            network.responses = {};
            network.sent = [];
            await engine.trigger();
            expect(engine.getState().state).toBe('idle');
            expect(network.sent).toHaveLength(1);
            const pushed = network.sent[0];
            expect(pushed).toMatchObject({
                server: 'https://a.test',
                collection,
                record: { id: 'target', updatedAt: 2 }
            });
            expect(pushed.record).not.toHaveProperty('localUpdatedAt');
            const payload = JSON.parse(
                strFromU8(
                    inflateSync(
                        await decryptBytes(key, {
                            ciphertext: fromBase64(pushed.record.encryptedData as string),
                            iv: fromBase64(pushed.record.encryptedDataIV as string)
                        })
                    )
                )
            );
            expect(payload).not.toHaveProperty('localUpdatedAt');
            network.sent = [];
            await engine.trigger();
            expect(network.sent).toEqual([]);
        }
    );
});

it('leaves changes accepted during Pull or Push responses beyond the captured localUpper', async () => {
    const engine = new DataRecordSyncEngineImpl();
    await localDB.putRecord('characters', record('target'));
    const upper = await localDB.getLocalUpdateUpper();
    network.incoming.records = [await wire('pulled', 1)];
    network.responses.records = await wire('target', 2);
    await engine.trigger();
    expect((await syncCursorDB.get(identity('records'))).localPushCursor).toBe(upper);
    const pending = await localDB.getUnsyncedChanges(
        'characters',
        userScope,
        upper,
        await localDB.getLocalUpdateUpper()
    );
    expect(pending.map((r) => r.id).sort()).toEqual(['pulled', 'target']);
    network.incoming = {};
    network.responses = {};
    network.sent = [];
    await engine.trigger();
    expect(network.sent.map((r) => r.record.id).sort()).toEqual(['pulled', 'target']);
});

it('does not advance a failed Push cursor and retries the same local changes', async () => {
    const engine = new DataRecordSyncEngineImpl();
    await localDB.putRecord('characters', record('retry'));
    network.failPush = true;
    await engine.trigger();
    expect((await syncCursorDB.get(identity('records'))).localPushCursor).toBe(0);
    network.failPush = false;
    await engine.trigger();
    expect(network.sent.map((r) => r.record.id)).toEqual(['retry']);
    expect((await syncCursorDB.get(identity('records'))).localPushCursor).toBe(
        await localDB.getLocalUpdateUpper()
    );
});

describe('multi_meta', () => {
    const index = (updatedAt: number) => ({
        id: 'room',
        ownerUserId: 'owner',
        visibility: 'private' as const,
        createdAt: 1,
        updatedAt
    });
    const member = (updatedAt: number, status = 'accepted') => ({
        id: 'membership',
        roomId: 'room',
        userId: 'owner',
        status,
        createdAt: 1,
        updatedAt
    });
    it.each(['Pull', 'Realtime', 'Push response'] as const)(
        'repushes both metadata tables after %s and ignores repeated inactive membership delivery',
        async (channel) => {
            const engine = new MultiRecordSyncEngineImpl();
            await appMulti.saveRoomIndexes([index(1), { ...index(1), id: 'seed' }]);
            await appMulti.saveMember({ ...member(1), status: 'accepted' });
            await engine.trigger();
            const cursor = (await syncCursorDB.get(identity('multi_meta'))).localPushCursor;
            expect(cursor).toBeGreaterThan(2);
            pb.baseUrl = 'https://b.test';
            const incomingIndex = { ...index(2), localUpdatedAt: 999999 };
            const incomingMember = { ...member(2, 'revoked'), localUpdatedAt: 999999 };
            if (channel === 'Pull') {
                network.incoming.multi_room_index = [incomingIndex];
                network.incoming.multi_room_members = [incomingMember];
                await engine.trigger();
            } else if (channel === 'Realtime') {
                await realtime(engine, 'multi_room_index', incomingIndex);
                await realtime(engine, 'multi_room_members', incomingMember);
            } else {
                network.responses.multi_room_index = incomingIndex;
                network.responses.multi_room_members = incomingMember;
                await engine.trigger();
            }
            expect(engine.getState().state).toBe('idle');
            expect((await appMulti.getRoomIndex('room'))?.localUpdatedAt).toBeGreaterThan(cursor);
            expect((await appMulti.getMember('membership'))?.localUpdatedAt).toBeGreaterThan(
                cursor
            );
            const upper = await appMulti.getLocalUpdateUpper();
            network.incoming.multi_room_index = [incomingIndex];
            network.incoming.multi_room_members = [incomingMember];
            await engine.trigger();
            network.incoming.multi_room_index = [index(1)];
            network.incoming.multi_room_members = [member(1, 'revoked')];
            await engine.trigger();
            expect(await appMulti.getLocalUpdateUpper()).toBe(upper);
            pb.baseUrl = 'https://a.test';
            network.incoming = {};
            network.responses = {};
            network.sent = [];
            await engine.trigger();
            expect(engine.getState().state).toBe('idle');
            expect(network.sent.map((r) => r.collection).sort()).toEqual([
                'multi_room_index',
                'multi_room_members'
            ]);
            for (const sent of network.sent) {
                expect(sent.record.updatedAt).toBe(2);
                expect(sent.record).not.toHaveProperty('localUpdatedAt');
            }
            network.sent = [];
            await engine.trigger();
            expect(network.sent).toEqual([]);
        }
    );
});
