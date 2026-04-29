import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getActiveSession, UserService } from '$lib/services/user';

const mockMasterKey = {} as CryptoKey;
const mockIdentityKeyPair = {} as CryptoKeyPair;

vi.mock('$lib/adapters/user', () => ({
    appUser: {
        getUser: vi.fn(),
        getAllUsers: vi.fn(),
        saveUser: vi.fn(),
        deleteUser: vi.fn()
    }
}));

vi.mock('$lib/adapters/kv', () => ({
    appKV: {
        get: vi.fn(),
        set: vi.fn(),
        remove: vi.fn()
    }
}));

vi.mock('$lib/crypto', () => ({
    generateMasterKey: vi.fn(() => Promise.resolve(mockMasterKey)),
    generateIdentityKeyPair: vi.fn(() => Promise.resolve(mockIdentityKeyPair))
}));

vi.mock('$lib/utils/id', () => ({ generateId: vi.fn(() => 'local-id') }));
vi.mock('$lib/utils/clock', () => ({ clock: { now: vi.fn(() => 1000) } }));
vi.mock('minidenticons', () => ({ minidenticon: vi.fn((seed: string) => `<svg>${seed}</svg>`) }));
vi.mock('$lib/config', () => ({ PB_URL: 'https://sync.example.test' }));

vi.mock('$lib/adapters/asset', () => ({
    appAsset: {
        getAllAssets: vi.fn(() => Promise.resolve([])),
        getAllRegistry: vi.fn(() => Promise.resolve([])),
        deleteRegistry: vi.fn(),
        putAsset: vi.fn()
    }
}));
vi.mock('$lib/adapters/db', () => ({
    localDB: { deleteByIndex: vi.fn() },
    TABLES: []
}));
vi.mock('$lib/adapters/storage', () => ({ appStorage: { delete: vi.fn() } }));

import { appUser } from '$lib/adapters/user';
import { appKV } from '$lib/adapters/kv';

describe('UserService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(appUser.getAllUsers).mockResolvedValue([]);
    });

    it('restores an existing local identity', async () => {
        vi.mocked(appKV.get).mockResolvedValue('user-1');
        vi.mocked(appUser.getUser).mockResolvedValue({
            id: 'user-1',
            name: 'Local 1',
            avatar: '',
            createdAt: 1,
            updatedAt: 1,
            isDeleted: false,
            masterKey: mockMasterKey,
            identityKeyPair: mockIdentityKeyPair
        });

        const restored = await UserService.restoreOrCreateUser();

        expect(restored).toEqual({
            user: expect.objectContaining({ id: 'user-1' }),
            restored: true
        });
    });

    it('creates a new local identity when no active user exists', async () => {
        vi.mocked(appKV.get).mockResolvedValue(null);

        const restored = await UserService.restoreOrCreateUser();

        expect(restored).toEqual({
            user: expect.objectContaining({ id: 'local-id' }),
            restored: false
        });
        expect(appUser.saveUser).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'local-id',
                name: 'Local 1',
                isDeleted: false,
                masterKey: mockMasterKey,
                identityKeyPair: mockIdentityKeyPair
            })
        );
        // KV set is now handled by the caller (App.svelte) or AuthService, not internally
        expect(appKV.set).not.toHaveBeenCalled();
    });

    it('marks a user as sync linked after server authentication', async () => {
        vi.mocked(appUser.getUser).mockResolvedValue(null);

        const user = await UserService.saveUser({
            id: 'user-1',
            email: 'notice@example.test',
            masterKey: mockMasterKey,
            identityKeyPair: mockIdentityKeyPair,
            syncServerUrl: 'https://sync.example.test',
            serverName: 'Synced'
        });

        expect(appUser.saveUser).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'user-1',
                email: 'notice@example.test',
                name: 'Synced',
                syncServerUrl: 'https://sync.example.test'
            }),
            { origin: 'sync' }
        );
        expect(user.id).toBe('user-1');
    });

    it('can clear sync account fields with updateUser', async () => {
        vi.mocked(appUser.getUser).mockResolvedValue({
            id: 'user-1',
            name: 'Linked',
            avatar: '',
            createdAt: 1,
            updatedAt: 1,
            isDeleted: false,
            syncServerUrl: 'https://sync.example.test',
            username: 'kei',
            masterKey: mockMasterKey,
            identityKeyPair: mockIdentityKeyPair
        });

        await UserService.updateUser('user-1', { username: undefined });

        expect(appUser.saveUser).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'user-1',
                syncServerUrl: 'https://sync.example.test',
                username: undefined
            })
        );
    });
});
