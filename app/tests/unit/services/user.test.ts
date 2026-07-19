import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getActiveSession } from '$lib/services/session';
import { UserService, type UserRecord } from '$lib/services/user';

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
vi.mock('$lib/config', () => ({
    PB_URL: 'https://sync.example.test',
    PROXY_URL: 'https://proxy.example.test',
    KEI_PB_URL: 'https://api.keiai.xyz',
    KEI_PROXY_URL: 'https://proxy.keiai.xyz'
}));

vi.mock('$lib/adapters/asset', () => ({
    appAsset: {
        getAllAssets: vi.fn(() => Promise.resolve([])),
        getAllRegistry: vi.fn(() => Promise.resolve([])),
        deleteAsset: vi.fn(() => Promise.resolve()),
        deleteRegistry: vi.fn(() => Promise.resolve()),
        putAsset: vi.fn()
    }
}));
vi.mock('$lib/adapters/multi', () => ({
    appMulti: {
        purgeUserLocal: vi.fn()
    }
}));
vi.mock('$lib/adapters/db', () => ({
    localDB: {
        deleteByIndex: vi.fn(),
        subscribeWriteEvents: vi.fn(() => vi.fn())
    },
    TABLES: []
}));
vi.mock('$lib/adapters/storage', () => ({
    appStorage: {
        delete: vi.fn(() => Promise.resolve())
    }
}));

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
            masterKey: mockMasterKey,
            identityKeyPair: mockIdentityKeyPair,
            connections: { server: { mode: 'default' }, proxy: { mode: 'default' } }
        });

        const restored = await UserService.restoreOrCreateUser();

        expect(restored).toEqual({
            user: expect.objectContaining({ id: 'user-1' }),
            restored: true
        });
    });

    it('normalizes connection settings on legacy user records', async () => {
        vi.mocked(appKV.get).mockResolvedValue('user-1');
        vi.mocked(appUser.getUser).mockResolvedValue({
            id: 'user-1',
            createdAt: 1,
            updatedAt: 1,
            masterKey: mockMasterKey,
            identityKeyPair: mockIdentityKeyPair
        } as unknown as UserRecord);

        const { user } = await UserService.restoreOrCreateUser();

        expect(user.name).toBe('');
        expect(user.avatar).toBe('');
        expect(user.connections).toEqual({
            server: { mode: 'default' },
            proxy: { mode: 'default' }
        });
        expect(appUser.saveUser).not.toHaveBeenCalled();
    });

    it('fills a missing nested connection without replacing stored siblings', async () => {
        vi.mocked(appUser.getUser).mockResolvedValue({
            id: 'user-1',
            name: 'Legacy',
            avatar: '',
            createdAt: 1,
            updatedAt: 1,
            masterKey: mockMasterKey,
            identityKeyPair: mockIdentityKeyPair,
            connections: {
                proxy: { mode: 'custom', customUrl: 'https://proxy.example.test' }
            }
        } as unknown as UserRecord);

        const user = await UserService.getUser('user-1');
        expect(user).toMatchObject({
            connections: {
                server: { mode: 'default' },
                proxy: { mode: 'custom', customUrl: 'https://proxy.example.test' }
            }
        });
        expect(user).not.toHaveProperty('masterKey');
        expect(user).not.toHaveProperty('identityKeyPair');
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
            connections: { server: { mode: 'default' }, proxy: { mode: 'default' } },
            name: 'Synced'
        });

        expect(appUser.saveUser).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'user-1',
                email: 'notice@example.test',
                name: 'Synced',
                connections: { server: { mode: 'default' }, proxy: { mode: 'default' } }
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
            connections: { server: { mode: 'default' }, proxy: { mode: 'default' } },
            username: 'kei',
            masterKey: mockMasterKey,
            identityKeyPair: mockIdentityKeyPair
        });

        await UserService.updateUser('user-1', { username: undefined });

        expect(appUser.saveUser).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'user-1',
                connections: { server: { mode: 'default' }, proxy: { mode: 'default' } }
            })
        );
        const savedUser = vi.mocked(appUser.saveUser).mock.calls[0][0];
        expect(savedUser).not.toHaveProperty('username');
    });
});
