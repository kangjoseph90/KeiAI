import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '$lib/services/auth';

const sessionMocks = vi.hoisted(() => {
    const values = new Map<string, string>();
    const authStore = {
        token: '',
        record: null as Record<string, unknown> | null,
        isValid: false,
        onChange: vi.fn(),
        save: vi.fn((token: string, record: Record<string, unknown>) => {
            authStore.token = token;
            authStore.record = record;
            authStore.isValid = Boolean(token);
        }),
        clear: vi.fn(() => {
            authStore.token = '';
            authStore.record = null;
            authStore.isValid = false;
        })
    };

    return { values, authStore };
});

const mockCollection = {
    create: vi.fn(),
    update: vi.fn(),
    authWithPassword: vi.fn(),
    authRefresh: vi.fn()
};

vi.mock('$lib/adapters/pb', () => ({
    pb: {
        baseUrl: 'https://sync.example.test',
        authStore: sessionMocks.authStore,
        cancelRequest: vi.fn(),
        send: vi.fn(),
        collection: vi.fn(() => mockCollection),
        files: { getURL: vi.fn() }
    }
}));

vi.mock('$lib/adapters/kv', () => ({
    appKV: {
        get: vi.fn((key: string) => Promise.resolve(sessionMocks.values.get(key) ?? null)),
        set: vi.fn((key: string, value: string) => {
            sessionMocks.values.set(key, value);
            return Promise.resolve();
        }),
        remove: vi.fn((key: string) => {
            sessionMocks.values.delete(key);
            return Promise.resolve();
        }),
        keys: vi.fn((prefix?: string) =>
            Promise.resolve(
                [...sessionMocks.values.keys()].filter((key) => !prefix || key.startsWith(prefix))
            )
        )
    }
}));

vi.mock('$lib/config', () => ({ PB_URL: 'https://sync.example.test' }));

vi.mock('$lib/crypto', () => ({
    generateSalt: vi.fn(() => new Uint8Array([1, 2, 3, 4])),
    deriveKeys: vi.fn(() =>
        Promise.resolve({
            loginKey: new Uint8Array([5, 6, 7, 8]),
            encryptionKey: new Uint8Array([9, 10, 11, 12])
        })
    ),
    wrapMasterKey: vi.fn(() =>
        Promise.resolve({
            ciphertext: new Uint8Array([1]),
            iv: new Uint8Array([2])
        })
    ),
    unwrapMasterKeyRaw: vi.fn(() => Promise.resolve(new Uint8Array([3]))),
    recoverMasterKey: vi.fn(() => Promise.resolve({} as CryptoKey)),
    importMasterKey: vi.fn(() => Promise.resolve({} as CryptoKey)),
    createRecoveryData: vi.fn(() =>
        Promise.resolve({
            encryptedRecoveryMasterKey: new Uint8Array([4]),
            encryptedRecoveryMasterKeyIV: new Uint8Array([5]),
            recoveryAuthTokenHash: new Uint8Array([6]),
            recoveryCode: { fullCode: 'ABCDEFGHIJKLMNOPQRSTUVWX' }
        })
    ),
    deriveRecoveryKey: vi.fn(() => Promise.resolve(new Uint8Array([7]))),
    hashRecoveryAuthToken: vi.fn(() => Promise.resolve(new Uint8Array([8]))),
    splitRecoveryCode: vi.fn(() => ({
        fullCode: 'ABCDEFGHIJKLMNOPQRSTUVWX',
        frontHalf: 'ABCDEFGHIJKL',
        backHalf: 'MNOPQRSTUVWX'
    })),
    exportPublicKey: vi.fn(() => Promise.resolve({ kty: 'EC' } as JsonWebKey)),
    importPublicKey: vi.fn(() => Promise.resolve({} as CryptoKey)),
    exportPrivateKey: vi.fn(() => Promise.resolve(new Uint8Array([9]))),
    importPrivateKey: vi.fn(() => Promise.resolve({} as CryptoKey)),
    encryptBytes: vi.fn(() =>
        Promise.resolve({
            ciphertext: new Uint8Array([10]),
            iv: new Uint8Array([11])
        })
    ),
    decryptBytes: vi.fn(() => Promise.resolve(new Uint8Array([12]))),
    encrypt: vi.fn(() =>
        Promise.resolve({
            ciphertext: new Uint8Array([13]),
            iv: new Uint8Array([14])
        })
    ),
    decrypt: vi.fn(() =>
        Promise.resolve(JSON.stringify({ name: 'Remote Profile', avatar: 'remote-avatar' }))
    ),
    generatePairingCode: vi.fn(() => 'ABCDEFGH'),
    createPairingBlob: vi.fn(() => Promise.resolve({ lookupId: 'lookup', blob: 'blob' })),
    decryptPairingBlob: vi.fn(() =>
        Promise.resolve({
            userId: 'user-123',
            username: 'kei',
            masterKey: {} as CryptoKey,
            identityKeyPair: {
                publicKey: {} as CryptoKey,
                privateKey: {} as CryptoKey
            }
        })
    ),
    derivePairingKeys: vi.fn(() => Promise.resolve({ lookupId: 'lookup' })),
    toBase64: vi.fn((data: Uint8Array) => `b64:${Array.from(data).join(',')}`),
    toHex: vi.fn((data: Uint8Array) =>
        Array.from(data)
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('')
    ),
    fromBase64: vi.fn(() => new Uint8Array([1, 2, 3]))
}));

vi.mock('$lib/services/user', () => ({
    UserService: {
        saveUser: vi.fn(() => Promise.resolve()),
        updateUser: vi.fn(() => Promise.resolve()),
        clearActiveUser: vi.fn(() => Promise.resolve()),
        getActiveConnections: vi.fn(() =>
            Promise.resolve({ server: { mode: 'default' }, proxy: { mode: 'default' } })
        ),
        getUser: vi.fn(),
        setActiveUser: vi.fn(() => Promise.resolve()),
        restoreOrCreateUser: vi.fn()
    }
}));

vi.mock('$lib/services/session', () => ({
    getActiveSession: vi.fn(() => ({
        userId: 'user-123',
        masterKey: {} as CryptoKey,
        identityKeyPair: {
            publicKey: {} as CryptoKey,
            privateKey: {} as CryptoKey
        }
    })),
    hasActiveSession: vi.fn(() => true)
}));

vi.mock('$lib/services/sync', () => ({
    AssetRecordSyncEngine: { resetCursor: vi.fn(() => Promise.resolve()) },
    SyncManager: { stopAutoSync: vi.fn() }
}));

import { pb } from '$lib/adapters/pb';
import { appKV } from '$lib/adapters/kv';
import { UserService } from '$lib/services/user';

function authKey(userId: string, serverUrl: string): string {
    return `pbAuth_${userId}_${encodeURIComponent(serverUrl.replace(/\/+$/, ''))}`;
}

describe('AuthService', () => {
    beforeEach(() => {
        sessionMocks.values.clear();
        sessionMocks.authStore.clear();
        vi.clearAllMocks();
        mockCollection.create.mockResolvedValue({ id: 'user-123' });
        mockCollection.update.mockResolvedValue({ id: 'user-123' });
        mockCollection.authRefresh.mockResolvedValue({});
        mockCollection.authWithPassword.mockResolvedValue({
            record: {
                id: 'user-123',
                username: 'kei',
                name: 'Local 1',
                email: '',
                encryptedMasterKey: 'wrapped',
                masterKeyIv: 'iv',
                identityPublicKey: JSON.stringify({ kty: 'EC' }),
                encryptedIdentityPrivateKey: 'priv',
                identityPrivateKeyIv: 'privIv',
                encryptedProfile: 'profile',
                encryptedProfileIV: 'profileIv'
            }
        });
        vi.mocked(UserService.getUser).mockResolvedValue({
            id: 'user-123',
            name: 'Local 1',
            avatar: '',
            connections: { server: { mode: 'default' }, proxy: { mode: 'default' } }
        });
    });

    it('creates a server account when username is available', async () => {
        const recoveryCode = await AuthService.createAccount('kei', 'password');

        expect(recoveryCode).toBe('ABCDEFGHIJKLMNOPQRSTUVWX');
        expect(mockCollection.create).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'user-123',
                username: 'kei',
                encryptedProfile: 'b64:13',
                encryptedProfileIV: 'b64:14'
            })
        );
        expect(mockCollection.authWithPassword).toHaveBeenCalled();
    });

    it('signs in to existing sync accounts by username', async () => {
        vi.mocked(pb.send).mockResolvedValueOnce({ salt: 'salt' });

        await AuthService.signIn('kei', 'password');

        expect(mockCollection.create).not.toHaveBeenCalled();
        expect(mockCollection.authWithPassword).toHaveBeenCalledWith('kei', expect.any(String));
    });

    it('preserves network errors from password authentication', async () => {
        const networkError = { status: 0 };
        vi.mocked(pb.send).mockResolvedValueOnce({ salt: 'salt' });
        mockCollection.authWithPassword.mockRejectedValueOnce(networkError);

        await expect(AuthService.signIn('kei', 'password')).rejects.toBe(networkError);
    });

    it('recovers a device with a recovery code and resets the password', async () => {
        vi.mocked(pb.send)
            .mockResolvedValueOnce({
                userId: 'user-123',
                encryptedRecoveryMasterKey: 'm',
                encryptedRecoveryMasterKeyIV: 'iv',
                identityPublicKey: JSON.stringify({ kty: 'EC' }),
                encryptedIdentityPrivateKey: 'priv',
                identityPrivateKeyIv: 'privIv',
                username: 'kei'
            })
            .mockResolvedValueOnce({ success: true });

        vi.mocked(mockCollection.authWithPassword).mockResolvedValueOnce({
            record: {
                id: 'user-123',
                username: 'kei',
                name: 'Recovered',
                email: '',
                encryptedMasterKey: 'm',
                masterKeyIv: 'iv',
                identityPublicKey: JSON.stringify({ kty: 'EC' }),
                encryptedIdentityPrivateKey: 'priv',
                identityPrivateKeyIv: 'privIv',
                encryptedProfile: 'profile',
                encryptedProfileIV: 'profileIv'
            }
        });

        const newCode = await AuthService.recoverAndResetPassword(
            'ABCDEFGHIJKLMNOPQRSTUVWX',
            'new-pass'
        );

        expect(newCode).toBe('ABCDEFGHIJKLMNOPQRSTUVWX');
        expect(pb.send).toHaveBeenCalledWith(
            '/api/recovery/lookup',
            expect.objectContaining({ method: 'POST' })
        );
        expect(pb.send).toHaveBeenCalledWith(
            '/api/recovery/reset-password',
            expect.objectContaining({ method: 'POST' })
        );
        expect(UserService.saveUser).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'user-123',
                username: 'kei',
                name: 'Remote Profile',
                avatar: 'remote-avatar'
            })
        );
    });

    it('returns the local identity to local-only mode after remote account deletion', async () => {
        await AuthService.deleteAccountWithRecoveryCode('ABCDEFGHIJKLMNOPQRSTUVWX');

        expect(UserService.updateUser).toHaveBeenCalledWith('user-123', { username: undefined });
        expect(pb.authStore.clear).toHaveBeenCalled();
    });

    it('cancels token refresh and removes only the current server session on logout', async () => {
        const currentKey = authKey('user-123', 'https://sync.example.test');
        const otherServerKey = authKey('user-123', 'https://other.example.test');
        sessionMocks.values.set(currentKey, 'current');
        sessionMocks.values.set(otherServerKey, 'other');

        await AuthService.logout();

        expect(pb.cancelRequest).toHaveBeenCalledWith('keiai-auth-refresh');
        expect(sessionMocks.values.has(currentKey)).toBe(false);
        expect(sessionMocks.values.get(otherServerKey)).toBe('other');
    });

    it('ignores a token refresh that finishes after logout', async () => {
        let finishRefresh: (() => void) | undefined;
        sessionMocks.authStore.save('current-token', { id: 'user-123' });
        mockCollection.authRefresh.mockImplementationOnce(
            () => new Promise<void>((resolve) => (finishRefresh = resolve))
        );

        const refresh = AuthService.refreshPbAuth({ force: true });
        await AuthService.logout();
        finishRefresh?.();

        await expect(refresh).resolves.toBe(false);
        expect(pb.authStore.token).toBe('');
    });

    it('stores and restores auth independently by user and server', async () => {
        sessionMocks.authStore.save('token-one', { id: 'user-1' });
        await AuthService.persistPbAuth('user-1', 'https://one.example.test/');
        sessionMocks.authStore.save('token-two', { id: 'user-1' });
        await AuthService.persistPbAuth('user-1', 'https://two.example.test');

        await AuthService.restorePbAuth('user-1', 'https://one.example.test');

        expect(pb.authStore.token).toBe('token-one');
        expect(await appKV.get(authKey('user-1', 'https://two.example.test'))).toContain(
            'token-two'
        );
    });

    it('clears in-memory auth when the user and server have no stored session', async () => {
        sessionMocks.authStore.save('stale-token', { id: 'user-1' });

        const restored = await AuthService.restorePbAuth('user-1');

        expect(restored).toBe(false);
        expect(pb.authStore.token).toBe('');
    });

    it('removes every server session for a deleted user only', async () => {
        sessionMocks.values.set(authKey('user-1', 'https://one.example.test'), 'one');
        sessionMocks.values.set(authKey('user-1', 'https://two.example.test'), 'two');
        sessionMocks.values.set(authKey('user-2', 'https://one.example.test'), 'other');

        await AuthService.clearAllPbAuthForUser('user-1');

        expect(sessionMocks.values.size).toBe(1);
        expect(sessionMocks.values.has(authKey('user-2', 'https://one.example.test'))).toBe(true);
    });
});
