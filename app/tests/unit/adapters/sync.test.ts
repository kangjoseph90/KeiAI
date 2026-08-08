import { describe, expect, it, vi } from 'vitest';
import fakeIndexedDB, { IDBKeyRange as FDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';
import type { SyncCursorIdentity } from '$lib/adapters/sync/types';

vi.mock('@tauri-apps/api/core', () => ({
    isTauri: () => false
}));

Dexie.dependencies.indexedDB = fakeIndexedDB as unknown as IDBFactory;
Dexie.dependencies.IDBKeyRange = FDBKeyRange as unknown as typeof IDBKeyRange;

import { WebSyncCursorAdapter } from '$lib/adapters/sync/web';

const adapter = new WebSyncCursorAdapter();
const runId = `${Date.now()}-${Math.random()}`;

function identity(overrides: Partial<SyncCursorIdentity> = {}): SyncCursorIdentity {
    return {
        serverUrl: `https://${runId}.example.test`,
        userId: 'user-1',
        stream: 'records',
        scopeType: 'user',
        scopeId: 'user-1',
        ...overrides
    };
}

describe('WebSyncCursorAdapter', () => {
    it('returns zero cursors for an unknown identity', async () => {
        await expect(adapter.get(identity({ scopeId: 'missing' }))).resolves.toEqual({
            serverPullCursor: 0,
            localPushCursor: 0
        });
    });

    it('advances each cursor independently and never regresses', async () => {
        const key = identity({ scopeId: 'monotonic' });

        await adapter.advance(key, { serverPullCursor: 120 });
        await adapter.advance(key, { localPushCursor: 80 });
        await adapter.advance(key, { serverPullCursor: 100, localPushCursor: 70 });

        await expect(adapter.get(key)).resolves.toEqual({
            serverPullCursor: 120,
            localPushCursor: 80
        });
    });

    it('isolates cursors by server, user, stream, and scope', async () => {
        const base = identity({ scopeId: 'isolation' });
        const variants = [
            base,
            identity({ serverUrl: `https://other-${runId}.example.test`, scopeId: 'isolation' }),
            identity({ userId: 'user-2', scopeId: 'isolation' }),
            identity({ stream: 'multi_meta', scopeId: 'isolation' }),
            identity({ scopeType: 'room', scopeId: 'room-1' })
        ];

        await Promise.all(
            variants.map((key, index) => adapter.advance(key, { serverPullCursor: index + 1 }))
        );

        await expect(Promise.all(variants.map((key) => adapter.get(key)))).resolves.toEqual(
            variants.map((_, index) => ({ serverPullCursor: index + 1, localPushCursor: 0 }))
        );
    });

    it('deletes one cursor or all cursors in a structured stream', async () => {
        const exact = identity({ scopeType: 'room', scopeId: 'room-delete' });
        const sibling = identity({ scopeType: 'room', scopeId: 'room-sibling' });
        const otherStream = identity({ stream: 'multi_meta', scopeId: 'meta' });
        await Promise.all(
            [exact, sibling, otherStream].map((key) =>
                adapter.advance(key, { serverPullCursor: 10 })
            )
        );

        await adapter.delete(exact);
        expect((await adapter.get(exact)).serverPullCursor).toBe(0);
        expect((await adapter.get(sibling)).serverPullCursor).toBe(10);

        await adapter.deleteByStream({
            serverUrl: sibling.serverUrl,
            userId: sibling.userId,
            stream: sibling.stream
        });
        expect((await adapter.get(sibling)).serverPullCursor).toBe(0);
        expect((await adapter.get(otherStream)).serverPullCursor).toBe(10);
    });

    it('deletes a user across servers and streams without touching another user', async () => {
        const first = identity({ scopeId: 'delete-user' });
        const second = identity({
            serverUrl: `https://second-${runId}.example.test`,
            stream: 'multi_meta',
            scopeId: 'delete-user'
        });
        const retained = identity({ userId: 'retained-user', scopeId: 'retained-user' });
        await Promise.all(
            [first, second, retained].map((key) => adapter.advance(key, { localPushCursor: 10 }))
        );

        await adapter.deleteByUser('user-1');

        expect((await adapter.get(first)).localPushCursor).toBe(0);
        expect((await adapter.get(second)).localPushCursor).toBe(0);
        expect((await adapter.get(retained)).localPushCursor).toBe(10);
    });
});
