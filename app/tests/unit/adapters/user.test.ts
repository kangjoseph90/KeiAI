/**
 * User Adapter Tests
 *
 * Tests WebUserAdapter (Dexie-backed user storage).
 * Uses fake-indexeddb for testing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fakeIndexedDB, { IDBKeyRange as FDBKeyRange } from 'fake-indexeddb';
import Dexie, { type Table } from 'dexie';
import type { IUserAdapter, UserRecord } from '$lib/adapters/user/types';

// Mock Tauri to ensure WebUserAdapter is used
vi.mock('@tauri-apps/api/core', () => ({
    isTauri: () => false
}));

// Configure Dexie to use fake-indexeddb
Dexie.dependencies.indexedDB = fakeIndexedDB as unknown as IDBFactory;
Dexie.dependencies.IDBKeyRange = FDBKeyRange as unknown as typeof IDBKeyRange;

import { WebUserAdapter, authDB } from '$lib/adapters/user/web';

describe('WebUserAdapter (Dexie)', () => {
    let adapter: IUserAdapter;

    beforeEach(async () => {
        // Delete any existing database
        await authDB.users.clear();
        // Create a fresh adapter instance for each test
        adapter = new WebUserAdapter();
    });

    afterEach(async () => {
        // Delete the database after each test
        await authDB.users.clear();
    });

    // Helper to create a test user
    async function createTestUser(overrides: Partial<UserRecord> = {}): Promise<UserRecord> {
        const cryptoKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
            'encrypt',
            'decrypt'
        ]);

        return {
            id: `user-${Date.now()}`,
            name: 'Test User',
            avatar: 'identicon-url',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            masterKey: cryptoKey,
            identityKeyPair: {} as CryptoKeyPair,
            ...overrides
        };
    }

    describe('getUser and saveUser', () => {
        it('should save and retrieve a user', async () => {
            const user = await createTestUser({ id: 'user-1' });

            await adapter.saveUser(user);
            const retrieved = await adapter.getUser('user-1');

            expect(retrieved).toBeDefined();
            expect(retrieved?.id).toBe('user-1');
            expect(retrieved?.name).toBe('Test User');
        });

        it('should return null for non-existent user', async () => {
            const result = await adapter.getUser('non-existent');
            expect(result).toBeNull();
        });

        it('should update existing user on subsequent save', async () => {
            const user = await createTestUser({ id: 'user-2', name: 'Original Name' });
            await adapter.saveUser(user);

            const updated = { ...user, name: 'Updated Name' };
            await adapter.saveUser(updated);

            const retrieved = await adapter.getUser('user-2');
            expect(retrieved?.name).toBe('Updated Name');
        });

        it('should preserve CryptoKey across save/load', async () => {
            const user = await createTestUser({ id: 'user-3' });

            await adapter.saveUser(user);
            const retrieved = await adapter.getUser('user-3');

            expect(retrieved?.masterKey).toBeInstanceOf(CryptoKey);
            expect(retrieved?.masterKey.algorithm.name).toBe('AES-GCM');

            // Verify the key works
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const plaintext = new TextEncoder().encode('test');
            const ciphertext = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv },
                retrieved!.masterKey,
                plaintext
            );
            expect(ciphertext).toBeInstanceOf(ArrayBuffer);
        });
    });

    describe('getAllUsers', () => {
        it('should return all users', async () => {
            const user1 = await createTestUser({ id: 'user-1', name: 'User 1' });
            const user2 = await createTestUser({ id: 'user-2', name: 'User 2' });

            await adapter.saveUser(user1);
            await adapter.saveUser(user2);

            const users = await adapter.getAllUsers();

            expect(users).toHaveLength(2);
            expect(users.map((u) => u.id)).toContain('user-1');
            expect(users.map((u) => u.id)).toContain('user-2');
        });

        it('should return empty array when no users exist', async () => {
            const users = await adapter.getAllUsers();
            expect(users).toEqual([]);
        });

        it('should handle multiple users correctly', async () => {
            const users = await Promise.all([
                createTestUser({ id: 'user-1', name: 'Alice' }),
                createTestUser({ id: 'user-2', name: 'Bob' }),
                createTestUser({ id: 'user-3', name: 'Charlie' })
            ]);

            for (const user of users) {
                await adapter.saveUser(user);
            }

            const retrieved = await adapter.getAllUsers();
            expect(retrieved).toHaveLength(3);

            const names = retrieved.map((u) => u.name).sort();
            expect(names).toEqual(['Alice', 'Bob', 'Charlie']);
        });
    });

    describe('deleteUser', () => {
        it('should hard delete a user', async () => {
            const user = await createTestUser({ id: 'delete-me' });

            await adapter.saveUser(user);
            const beforeDelete = await adapter.getUser('delete-me');
            expect(beforeDelete).toBeDefined();

            await adapter.deleteUser('delete-me');

            const retrieved = await adapter.getUser('delete-me');
            expect(retrieved).toBeNull();
        });

        it('should not throw when deleting non-existent user', async () => {
            await expect(adapter.deleteUser('non-existent')).resolves.not.toThrow();
        });

        it('should exclude deleted users from getAllUsers', async () => {
            const user1 = await createTestUser({ id: 'user-1' });
            const user2 = await createTestUser({ id: 'user-2' });

            await adapter.saveUser(user1);
            await adapter.saveUser(user2);

            expect(await adapter.getAllUsers()).toHaveLength(2);

            await adapter.deleteUser('user-1');

            const users = await adapter.getAllUsers();
            expect(users).toHaveLength(1);
            expect(users[0].id).toBe('user-2');
        });
    });

    describe('Write Events', () => {
        it('should emit batch of events after next tick', async () => {
            const listener = vi.fn();
            adapter.subscribeWriteEvents(listener);

            const user1 = await createTestUser({ id: 'evt-1' });
            const user2 = await createTestUser({ id: 'evt-2' });

            await adapter.saveUser(user1);
            await adapter.saveUser(user2);

            // Wait for batch (real timeout instead of fake timers to avoid breaking fake-indexeddb)
            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(listener).toHaveBeenCalled();
            const allEvents = listener.mock.calls.flatMap((call) => call[0]);
            expect(allEvents).toHaveLength(2);
            expect(allEvents.map((e) => e.ids[0])).toContain('evt-1');
            expect(allEvents.map((e) => e.ids[0])).toContain('evt-2');
        });
    });

    describe('backupMasterKey and restoreMasterKey', () => {
        it('should be a no-op on web platform', async () => {
            const keyData = new Uint8Array([1, 2, 3, 4, 5]);

            // backupMasterKey should not throw
            await expect(adapter.backupMasterKey('user-1', keyData)).resolves.not.toThrow();

            // restoreMasterKey should return null
            const restored = await adapter.restoreMasterKey('user-1');
            expect(restored).toBeNull();
        });

        it('should handle restore without backup', async () => {
            const restored = await adapter.restoreMasterKey('non-existent-user');
            expect(restored).toBeNull();
        });
    });

    describe('user record properties', () => {
        it('should store all user record properties', async () => {
            const user = await createTestUser({
                id: 'full-record',
                name: 'Full Name',
                email: 'test@example.com',
                avatar: 'https://example.com/avatar.png'
            });

            await adapter.saveUser(user);
            const retrieved = await adapter.getUser('full-record');

            expect(retrieved?.id).toBe('full-record');
            expect(retrieved?.name).toBe('Full Name');
            expect(retrieved?.email).toBe('test@example.com');
            expect(retrieved?.avatar).toBe('https://example.com/avatar.png');
        });

        it('should handle timestamps correctly', async () => {
            const created = Date.now();
            const user = await createTestUser({
                id: 'timestamp-test',
                createdAt: created,
                updatedAt: created
            });

            await adapter.saveUser(user);
            const retrieved = await adapter.getUser('timestamp-test');

            expect(retrieved?.createdAt).toBe(created);
            expect(retrieved?.updatedAt).toBe(created);
        });
    });

    describe('integration scenarios', () => {
        it('should handle local-to-sync-linked lifecycle', async () => {
            const local = await createTestUser({
                id: 'local-1',
                name: 'Local User'
            });

            await adapter.saveUser(local);

            expect(await adapter.getUser('local-1')).toBeDefined();
            expect((await adapter.getAllUsers()).length).toBe(1);

            const linked = {
                ...local,
                name: 'Linked User',
                email: 'user@example.com',
                selfHostUrl: 'https://sync.example.test'
            };
            await adapter.saveUser(linked);

            const retrieved = await adapter.getUser('local-1');
            expect(retrieved?.email).toBe('user@example.com');
            expect(retrieved?.selfHostUrl).toBe('https://sync.example.test');
        });

        it('should handle multiple local identities', async () => {
            const local1 = await createTestUser({ id: 'local-1', name: 'Local 1' });
            const local2 = await createTestUser({ id: 'local-2', name: 'Local 2' });

            await adapter.saveUser(local1);
            await adapter.saveUser(local2);

            const users = await adapter.getAllUsers();
            expect(users).toHaveLength(2);

            // Switch accounts by deleting one
            await adapter.deleteUser('local-1');

            const remaining = await adapter.getAllUsers();
            expect(remaining).toHaveLength(1);
            expect(remaining[0].id).toBe('local-2');
        });
    });
});

describe('IUserAdapter interface contract', () => {
    it('should have all required methods', async () => {
        const adapter = new WebUserAdapter();

        expect(typeof adapter.getUser).toBe('function');
        expect(typeof adapter.getAllUsers).toBe('function');
        expect(typeof adapter.saveUser).toBe('function');
        expect(typeof adapter.deleteUser).toBe('function');
        expect(typeof adapter.backupMasterKey).toBe('function');
        expect(typeof adapter.restoreMasterKey).toBe('function');
    });

    it('should have async methods that return promises', async () => {
        const adapter = new WebUserAdapter();

        const getKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
            'encrypt',
            'decrypt'
        ]);

        const testUser: UserRecord = {
            id: 'test',
            name: 'Test',
            avatar: 'url',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            masterKey: getKey,
            identityKeyPair: {} as CryptoKeyPair
        };

        const promises = [
            adapter.getUser('id'),
            adapter.getAllUsers(),
            adapter.saveUser(testUser),
            adapter.deleteUser('id'),
            adapter.backupMasterKey('id', new Uint8Array([])),
            adapter.restoreMasterKey('id')
        ];

        for (const promise of promises) {
            expect(promise).toBeInstanceOf(Promise);
        }

        // Clean up
        await Promise.allSettled(promises);
        await authDB.users.clear();
    });
});
