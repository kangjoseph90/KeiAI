import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '$lib/services/auth';

const mockCollection = {
    create: vi.fn(),
    update: vi.fn(),
    authWithPassword: vi.fn()
};

vi.mock('$lib/adapters/pb', () => ({
    pb: {
        authStore: {
            isValid: false,
            record: null,
            onChange: vi.fn(),
            clear: vi.fn()
        },
        send: vi.fn(),
        collection: vi.fn(() => mockCollection),
        files: { getURL: vi.fn() }
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
        getActiveSelfHostUrl: vi.fn(() => Promise.resolve(undefined)),
        getUser: vi.fn(),
        setActiveUser: vi.fn(() => Promise.resolve()),
        restoreOrCreateUser: vi.fn()
    },
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
    DataSyncService: { resetCursors: vi.fn(() => Promise.resolve()) },
    AssetSyncService: { resetCursors: vi.fn(() => Promise.resolve()) },
    SyncManager: { stopAutoSync: vi.fn() }
}));

import { pb } from '$lib/adapters/pb';
import { getActiveSession, UserService } from '$lib/services/user';

describe('AuthService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCollection.create.mockResolvedValue({ id: 'user-123' });
        mockCollection.update.mockResolvedValue({ id: 'user-123' });
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
                identityPrivateKeyIv: 'privIv'
            }
        });
        vi.mocked(UserService.getUser).mockResolvedValue({
            id: 'user-123',
            name: 'Local 1',
            avatar: ''
        });
    });

    it('creates a server account when username is available', async () => {
        const recoveryCode = await AuthService.createAccount('kei', 'password');

        expect(recoveryCode).toBe('ABCDEFGHIJKLMNOPQRSTUVWX');
        expect(mockCollection.create).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'user-123',
                username: 'kei'
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

    it('recovers a device with a recovery code and resets the password', async () => {
        vi.mocked(pb.send)
            .mockResolvedValueOnce({
                userId: 'user-123',
                encryptedRecoveryMasterKey: 'm',
                encryptedRecoveryMasterKeyIV: 'iv',
                identityPublicKey: JSON.stringify({ kty: 'EC' }),
                encryptedIdentityPrivateKey: 'priv',
                identityPrivateKeyIv: 'privIv',
                username: 'kei',
                name: 'Recovered'
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
                identityPrivateKeyIv: 'privIv'
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
            expect.objectContaining({ id: 'user-123', username: 'kei', name: 'Recovered' })
        );
    });

    it('disconnects sync without deleting local identity', async () => {
        await AuthService.unlinkSync();

        expect(UserService.updateUser).toHaveBeenCalledWith('user-123', { username: undefined });
        expect(pb.authStore.clear).toHaveBeenCalled();
    });
});
