/**
 * Test Setup File
 *
 * Configures:
 * - fake-indexeddb for Dexie testing
 * - PocketBase mocking
 */

import { beforeAll, afterEach, vi } from 'vitest';
import fakeIndexedDB, { IDBKeyRange as FDBKeyRange } from 'fake-indexeddb';

// ─── Mock PocketBase ─────────────────────────────────────────────────────

const createMockPocketBase = () => ({
    authStore: {
        token: null,
        record: null,
        isValid: false,
        clear: vi.fn(),
        save: vi.fn(),
        onChange: vi.fn()
    },
    collection: vi.fn(() => ({
        getList: vi.fn(() => ({ items: [], totalItems: 0 })),
        create: vi.fn(),
        update: vi.fn(),
        get: vi.fn(),
        getOne: vi.fn(),
        delete: vi.fn(),
        authWithPassword: vi.fn(),
        subscribe: vi.fn(),
        unsubscribe: vi.fn()
    })),
    send: vi.fn(),
    files: {
        getURL: vi.fn(() => 'http://mock.url/file')
    },
    filter: vi.fn((tpl: string, params: Record<string, unknown>) => {
        let result = tpl;
        for (const [key, val] of Object.entries(params)) {
            result = result.replace(`{:${key}}`, String(val));
        }
        return result;
    })
});

beforeAll(() => {
    // Mock PocketBase adapter
    vi.mock('$lib/adapters/pb', () => ({
        pb: createMockPocketBase()
    }));
});

// ─── Mock IndexedDB for Dexie ────────────────────────────────────────

// Replace global IndexedDB with fake implementation immediately
if (typeof indexedDB === 'undefined') {
    global.indexedDB = fakeIndexedDB as unknown as IDBFactory;
    global.IDBKeyRange = FDBKeyRange as unknown as typeof IDBKeyRange;
} else {
    vi.stubGlobal('indexedDB', fakeIndexedDB);
    vi.stubGlobal('IDBKeyRange', FDBKeyRange);
}

// ─── Mock Web Crypto API (happy-dom partial support) ───────────────────

// Ensure crypto.subtle is available (happy-dom provides this)
if (typeof crypto !== 'undefined' && !crypto.subtle) {
    // @ts-expect-error - subtle is read-only but we need it for tests
    crypto.subtle = {
        encrypt: vi.fn(),
        decrypt: vi.fn(),
        generateKey: vi.fn(),
        importKey: vi.fn(),
        exportKey: vi.fn(),
        deriveBits: vi.fn(),
        digest: vi.fn()
    };
}

// ─── Mock Tauri APIs (not available in test env) ───────────────────────

vi.mock('@tauri-apps/api/core', () => ({
    isTauri: () => false,
    invoke: vi.fn()
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
    readTextFile: vi.fn(),
    writeTextFile: vi.fn(),
    exists: vi.fn(),
    mkdir: vi.fn()
}));

vi.mock('@tauri-apps/plugin-sql', () => {
    class MockDatabase {
        async execute(): Promise<void> {}
        async select<T>(): Promise<T[]> {
            return [];
        }
    }
    return {
        default: {
            load: vi.fn(async () => new MockDatabase())
        }
    };
});

vi.mock('@tauri-apps/plugin-store', () => ({
    getStore: vi.fn(() => ({
        get: vi.fn(),
        set: vi.fn(),
        save: vi.fn()
    }))
}));

vi.mock('@tauri-apps/plugin-stronghold', () => ({
    Stronghold: vi.fn()
}));

// ─── Cleanup ─────────────────────────────────────────────────────────────

afterEach(() => {
    // Clear all mocks after each test
    vi.clearAllMocks();
});
