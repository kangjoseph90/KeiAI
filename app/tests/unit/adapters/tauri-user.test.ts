import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TauriUserAdapter } from '$lib/adapters/user/tauri';
import type { UserRecord, UserWriteEvent } from '$lib/adapters/user';

interface SqlRow {
    id: string;
    userId: string;
    name: string;
    username: string | null;
    email: string | null;
    avatar: string;
    createdAt: number;
    updatedAt: number;
    selfHostUrl: string | null;
}

const native = vi.hoisted(() => ({
    sqlRows: new Map<string, SqlRow>(),
    secureValues: new Map<string, Uint8Array>(),
    metaValues: new Map<string, string>(),
    failNextSqlInsert: false,
    failNextStrongholdSave: false,
    strongholdSave: vi.fn(async () => {
        if (native.failNextStrongholdSave) {
            native.failNextStrongholdSave = false;
            throw new Error('stronghold unavailable');
        }
    })
}));

vi.mock('$lib/adapters/logger', () => ({
    createLogger: () => ({
        error: vi.fn(),
        warn: vi.fn()
    })
}));

vi.mock('@tauri-apps/plugin-sql', () => ({
    default: {
        load: vi.fn(async () => ({
            execute: vi.fn(async (query: string, values: unknown[] = []) => {
                if (query.includes('INSERT OR REPLACE INTO users')) {
                    if (native.failNextSqlInsert) {
                        native.failNextSqlInsert = false;
                        throw new Error('sqlite unavailable');
                    }
                    const row: SqlRow = {
                        id: String(values[0]),
                        userId: String(values[1]),
                        name: String(values[2]),
                        username: typeof values[3] === 'string' ? values[3] : null,
                        email: typeof values[4] === 'string' ? values[4] : null,
                        avatar: String(values[5]),
                        createdAt: Number(values[6]),
                        updatedAt: Number(values[7]),
                        selfHostUrl: typeof values[8] === 'string' ? values[8] : null
                    };
                    native.sqlRows.set(row.id, row);
                } else if (query.includes('DELETE FROM users')) {
                    native.sqlRows.delete(String(values[0]));
                }
                return { rowsAffected: 1, lastInsertId: 0 };
            }),
            select: vi.fn(async (query: string, values: unknown[] = []) => {
                if (query.includes('WHERE id')) {
                    const row = native.sqlRows.get(String(values[0]));
                    return row ? [row] : [];
                }
                return Array.from(native.sqlRows.values());
            })
        }))
    }
}));

vi.mock('@tauri-apps/plugin-stronghold', () => {
    const store = {
        get: vi.fn(async (key: string) => {
            const value = native.secureValues.get(key);
            return value ? new Uint8Array(value) : null;
        }),
        insert: vi.fn(async (key: string, value: number[]) => {
            native.secureValues.set(key, new Uint8Array(value));
        }),
        remove: vi.fn(async (key: string) => {
            const previous = native.secureValues.get(key) ?? null;
            native.secureValues.delete(key);
            return previous;
        })
    };
    const client = { getStore: () => store };
    const stronghold = {
        loadClient: vi.fn(async () => client),
        createClient: vi.fn(async () => client),
        save: native.strongholdSave
    };
    return {
        Store: class {},
        Stronghold: { load: vi.fn(async () => stronghold) }
    };
});

vi.mock('@tauri-apps/plugin-store', () => ({
    Store: {
        load: vi.fn(async () => ({
            get: vi.fn(async (key: string) => native.metaValues.get(key)),
            set: vi.fn(async (key: string, value: string) => {
                native.metaValues.set(key, value);
            }),
            save: vi.fn(async () => undefined)
        }))
    }
}));

vi.mock('@tauri-apps/api/path', () => ({
    appLocalDataDir: vi.fn(async () => 'C:/KeiAI')
}));

describe('TauriUserAdapter durable identity storage', () => {
    beforeEach(() => {
        native.sqlRows.clear();
        native.secureValues.clear();
        native.metaValues.clear();
        native.failNextSqlInsert = false;
        native.failNextStrongholdSave = false;
        native.strongholdSave.mockClear();
    });

    it('persists all secure keys once and purges them with the local user', async () => {
        const adapter = new TauriUserAdapter();
        const user = await makeUser('tauri-user-purge', 'Before');

        await adapter.saveUser(user);

        expectSecureKeys(user.id, true);
        expect(native.strongholdSave).toHaveBeenCalledTimes(1);

        await adapter.deleteUser(user.id);

        expectSecureKeys(user.id, false);
        expect(native.sqlRows.has(user.id)).toBe(false);
        expect(native.strongholdSave).toHaveBeenCalledTimes(2);
    });

    it('restores the previous identity when a mirror write fails', async () => {
        const adapter = new TauriUserAdapter();
        const original = await makeUser('tauri-user-sql-rollback', 'Original');
        await adapter.saveUser(original);
        const secureSnapshot = snapshotSecureKeys(original.id);
        const events: UserWriteEvent[] = [];
        adapter.subscribeWriteEvents((next) => events.push(...next));
        await flushWriteEvents();
        events.length = 0;

        native.failNextSqlInsert = true;
        await expect(adapter.saveUser(await makeUser(original.id, 'Replacement'))).rejects.toThrow(
            'Secure local identity save failed'
        );

        expect(native.sqlRows.get(original.id)?.name).toBe('Original');
        expectSecureSnapshot(original.id, secureSnapshot);
        expect((await adapter.getUser(original.id))?.name).toBe('Original');
        expect(events).toEqual([]);
    });

    it('restores secure keys when Stronghold save fails', async () => {
        const adapter = new TauriUserAdapter();
        const original = await makeUser('tauri-user-key-rollback', 'Original');
        await adapter.saveUser(original);
        const secureSnapshot = snapshotSecureKeys(original.id);

        native.failNextStrongholdSave = true;
        await expect(adapter.saveUser(await makeUser(original.id, 'Replacement'))).rejects.toThrow(
            'Secure local identity save failed'
        );

        expect(native.sqlRows.get(original.id)?.name).toBe('Original');
        expectSecureSnapshot(original.id, secureSnapshot);
        expect((await adapter.getUser(original.id))?.name).toBe('Original');
    });

    it('restores all stores when secure key deletion fails', async () => {
        const adapter = new TauriUserAdapter();
        const original = await makeUser('tauri-user-delete-rollback', 'Original');
        await adapter.saveUser(original);
        const secureSnapshot = snapshotSecureKeys(original.id);
        const events: UserWriteEvent[] = [];
        adapter.subscribeWriteEvents((next) => events.push(...next));
        await flushWriteEvents();
        events.length = 0;

        native.failNextStrongholdSave = true;
        await expect(adapter.deleteUser(original.id)).rejects.toThrow('Local user deletion failed');

        expect(native.sqlRows.get(original.id)?.name).toBe('Original');
        expectSecureSnapshot(original.id, secureSnapshot);
        expect((await adapter.getUser(original.id))?.name).toBe('Original');
        expect(events).toEqual([]);
    });
});

function expectSecureKeys(id: string, present: boolean): void {
    expect(native.secureValues.has(`masterKey:${id}`)).toBe(present);
    expect(native.secureValues.has(`identityPub:${id}`)).toBe(present);
    expect(native.secureValues.has(`identityPriv:${id}`)).toBe(present);
}

function snapshotSecureKeys(id: string): Map<string, Uint8Array> {
    return new Map(
        ['masterKey', 'identityPub', 'identityPriv'].map((prefix) => {
            const key = `${prefix}:${id}`;
            return [key, new Uint8Array(native.secureValues.get(key)!)] as const;
        })
    );
}

function expectSecureSnapshot(id: string, snapshot: Map<string, Uint8Array>): void {
    for (const prefix of ['masterKey', 'identityPub', 'identityPriv']) {
        const key = `${prefix}:${id}`;
        expect(native.secureValues.get(key)).toEqual(snapshot.get(key));
    }
}

async function flushWriteEvents(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

async function makeUser(id: string, name: string): Promise<UserRecord> {
    const masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
        'encrypt',
        'decrypt'
    ]);
    const identityKeyPair = await crypto.subtle.generateKey(
        {
            name: 'RSA-OAEP',
            modulusLength: 1024,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: 'SHA-256'
        },
        true,
        ['encrypt', 'decrypt']
    );
    return {
        id,
        name,
        avatar: '',
        createdAt: 1,
        updatedAt: name === 'Original' ? 1 : 2,
        masterKey,
        identityKeyPair
    };
}
