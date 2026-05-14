/**
 * Auth API — username/password PocketBase account + E2EE key wrapping flows.
 *
 * `users.id` is the canonical local identity (`userId`). `users.username` is a
 * unique, changeable login alias on the current sync server. After every login,
 * the server-returned `record.id` becomes the active local identity.
 */

import { pb } from '$lib/adapters/pb';
import {
    createPairingBlob,
    createRecoveryData,
    decryptBytes,
    decryptPairingBlob,
    deriveKeys,
    derivePairingKeys,
    encryptBytes,
    exportPrivateKey,
    exportPublicKey,
    fromBase64,
    generatePairingCode,
    generateSalt,
    hashRecoveryAuthToken,
    importMasterKey,
    importPrivateKey,
    importPublicKey,
    recoverMasterKey,
    splitRecoveryCode,
    toBase64,
    toHex,
    unwrapMasterKeyRaw,
    wrapMasterKey,
    type RecoveryBundle
} from '$lib/crypto';
import { UserService } from './user';
import { getActiveSession } from './session';
import { AssetSyncService, DataSyncService, SyncManager } from './sync';
import { AppError } from '$lib/types/errors';
import { createLogger } from '$lib/adapters/logger';

const logger = createLogger('service:auth');

interface SaltResponse {
    salt: string;
}

interface RecoverResponse {
    userId: string;
    name: string;
    avatar?: string;
    encryptedRecoveryMasterKey: string;
    encryptedRecoveryMasterKeyIV: string;
    identityPublicKey: string;
    encryptedIdentityPrivateKey: string;
    identityPrivateKeyIv: string;
    username: string; // server specific field
    email?: string;
}

function normalizeUsername(username: string): string {
    const normalized = username.trim().toLowerCase();
    if (!normalized) throw new AppError('INVALID_INPUT', 'Username is required.');
    return normalized;
}

export class AuthService {
    // ─── PB Connection Helpers ────────────────────────────────────────

    /** Whether PocketBase currently holds a valid auth token. */
    static isPbConnected(): boolean {
        return pb.authStore.isValid;
    }

    /** Subscribe to PB auth state changes (token valid/invalid). */
    static onPbAuthChange(callback: (isValid: boolean) => void): void {
        pb.authStore.onChange(() => callback(pb.authStore.isValid));
    }

    // ─── Account Flows ────────────────────────────────────────────────

    /**
     * Create a sync account for the active local identity.
     */
    static async createAccount(
        username: string,
        password: string,
        email?: string
    ): Promise<string> {
        const normalizedUsername = normalizeUsername(username);
        const currentSelfHostUrl = await UserService.getActiveSelfHostUrl();

        const { userId, masterKey, identityKeyPair } = getActiveSession();
        const existing = await UserService.getUser(userId);
        const salt = generateSalt();
        const keys = await deriveKeys(password, salt);
        let recoveryCode = '';
        let rawPrivateKey: Uint8Array<ArrayBuffer> | null = null;
        try {
            const wrapped = await wrapMasterKey(masterKey, keys.encryptionKey);
            const recovery = await createRecoveryData(masterKey);
            recoveryCode = recovery.recoveryCode.fullCode;
            const publicKeyJwk = await exportPublicKey(identityKeyPair.publicKey);
            rawPrivateKey = await exportPrivateKey(identityKeyPair.privateKey);
            const encryptedPrivateKey = await encryptBytes(masterKey, rawPrivateKey);

            const createData: Record<string, string | Blob> = {
                id: userId,
                username: normalizedUsername,
                name: existing.name,
                password: toHex(keys.loginKey),
                passwordConfirm: toHex(keys.loginKey),
                salt: toBase64(salt),
                encryptedMasterKey: toBase64(wrapped.ciphertext),
                masterKeyIv: toBase64(wrapped.iv),
                encryptedRecoveryMasterKey: toBase64(recovery.encryptedRecoveryMasterKey),
                recoveryMasterKeyIv: toBase64(recovery.encryptedRecoveryMasterKeyIV),
                recoveryAuthTokenHash: toBase64(recovery.recoveryAuthTokenHash),
                identityPublicKey: JSON.stringify(publicKeyJwk),
                encryptedIdentityPrivateKey: toBase64(encryptedPrivateKey.ciphertext),
                identityPrivateKeyIv: toBase64(encryptedPrivateKey.iv)
            };

            if (email) createData.email = email;

            if (existing.avatar.startsWith('data:image')) {
                try {
                    const fetchResponse = await fetch(existing.avatar);
                    createData.avatar = await fetchResponse.blob();
                } catch (e) {
                    logger.warn('Failed to parse local avatar for PB upload', e);
                }
            }

            await pb.collection('users').create(createData);
        } catch (error) {
            if ((error as { status?: unknown })?.status === 400) {
                throw new AppError('INVALID_INPUT', 'Username is already taken.');
            }
            throw error;
        } finally {
            keys.loginKey.fill(0);
            keys.encryptionKey.fill(0);
            rawPrivateKey?.fill(0);
        }

        await this.authenticateExisting(normalizedUsername, password, salt, currentSelfHostUrl);
        return recoveryCode;
    }

    /**
     * Sign in to an existing sync account and switch to its canonical userId.
     */
    static async signIn(username: string, password: string): Promise<void> {
        const normalizedUsername = normalizeUsername(username);
        const currentSelfHostUrl = await UserService.getActiveSelfHostUrl();

        const { salt } = await this.getSalt(normalizedUsername);
        await this.authenticateExisting(
            normalizedUsername,
            password,
            fromBase64(salt),
            currentSelfHostUrl
        );
    }

    /**
     * Restore an account with a one-time recovery code and set a new password.
     */
    static async recoverAndResetPassword(
        recoveryCode: string,
        newPassword: string
    ): Promise<string> {
        const { backHalf } = splitRecoveryCode(recoveryCode);
        const authTokenHash = await hashRecoveryAuthToken(backHalf);

        const currentSelfHostUrl = await UserService.getActiveSelfHostUrl();

        const resp = (await pb.send('/api/recovery/lookup', {
            method: 'POST',
            body: JSON.stringify({ authTokenHash: toBase64(authTokenHash) })
        })) as RecoverResponse;

        const bundle: RecoveryBundle = {
            userId: resp.userId,
            encryptedRecoveryMasterKey: fromBase64(resp.encryptedRecoveryMasterKey),
            encryptedRecoveryMasterKeyIV: fromBase64(resp.encryptedRecoveryMasterKeyIV),
            identityPublicKey: JSON.parse(resp.identityPublicKey) as JsonWebKey,
            encryptedIdentityPrivateKey: fromBase64(resp.encryptedIdentityPrivateKey),
            identityPrivateKeyIV: fromBase64(resp.identityPrivateKeyIv)
        };

        const masterKey = await recoverMasterKey(
            recoveryCode,
            bundle.encryptedRecoveryMasterKey,
            bundle.encryptedRecoveryMasterKeyIV
        );

        const salt = generateSalt();
        const newKeys = await deriveKeys(newPassword, salt);
        let newRecoveryCode = '';
        try {
            const wrappedM = await wrapMasterKey(masterKey, newKeys.encryptionKey);
            const newRecovery = await createRecoveryData(masterKey);
            newRecoveryCode = newRecovery.recoveryCode.fullCode;

            await pb.send('/api/recovery/reset-password', {
                method: 'POST',
                body: JSON.stringify({
                    authTokenHash: toBase64(authTokenHash),
                    newPassword: toHex(newKeys.loginKey),
                    newPasswordConfirm: toHex(newKeys.loginKey),
                    salt: toBase64(salt),
                    encryptedMasterKey: toBase64(wrappedM.ciphertext),
                    masterKeyIv: toBase64(wrappedM.iv),
                    encryptedRecoveryMasterKey: toBase64(newRecovery.encryptedRecoveryMasterKey),
                    recoveryMasterKeyIv: toBase64(newRecovery.encryptedRecoveryMasterKeyIV),
                    recoveryAuthTokenHash: toBase64(newRecovery.recoveryAuthTokenHash)
                })
            });
        } finally {
            newKeys.encryptionKey.fill(0);
            newKeys.loginKey.fill(0);
        }

        await this.authenticateExisting(resp.username, newPassword, salt, currentSelfHostUrl);
        return newRecoveryCode;
    }

    /**
     * Delete the remote sync account using a recovery code.
     * Keeps local data intact; the store layer unlinks the local profile after success.
     */
    static async deleteAccountWithRecoveryCode(recoveryCode: string): Promise<void> {
        const { backHalf } = splitRecoveryCode(recoveryCode);
        const authTokenHash = await hashRecoveryAuthToken(backHalf);

        await pb.send('/api/recovery/delete', {
            method: 'POST',
            body: JSON.stringify({ authTokenHash: toBase64(authTokenHash) })
        });
    }

    /**
     * Change the password while connected.
     * Returns the new recovery code that replaces the old one.
     */
    static async changePassword(oldPassword: string, newPassword: string): Promise<string> {
        const { userId } = getActiveSession();
        const currentSelfHostUrl = await UserService.getActiveSelfHostUrl();

        const record = pb.authStore.record;
        const username = (record?.username as string | undefined) ?? null;
        if (!pb.authStore.isValid || !record || !username || record.id !== userId) {
            throw new AppError('NOT_AUTHENTICATED', 'Not connected to PocketBase.');
        }

        const oldKeys = await deriveKeys(oldPassword, fromBase64(record.salt as string));
        let rawM: Uint8Array<ArrayBuffer>;
        try {
            rawM = await unwrapMasterKeyRaw(
                fromBase64(record.encryptedMasterKey as string),
                fromBase64(record.masterKeyIv as string),
                oldKeys.encryptionKey
            );
        } catch {
            oldKeys.encryptionKey.fill(0);
            oldKeys.loginKey.fill(0);
            throw new AppError('INVALID_CREDENTIALS', 'Incorrect current password.');
        }

        const masterKey = await importMasterKey(rawM, true);
        const newSalt = generateSalt();
        const newKeys = await deriveKeys(newPassword, newSalt);
        try {
            const newWrapped = await wrapMasterKey(masterKey, newKeys.encryptionKey);
            const newRecovery = await createRecoveryData(masterKey);

            await pb.collection('users').update(userId, {
                oldPassword: toHex(oldKeys.loginKey),
                password: toHex(newKeys.loginKey),
                passwordConfirm: toHex(newKeys.loginKey),
                salt: toBase64(newSalt),
                encryptedMasterKey: toBase64(newWrapped.ciphertext),
                masterKeyIv: toBase64(newWrapped.iv),
                encryptedRecoveryMasterKey: toBase64(newRecovery.encryptedRecoveryMasterKey),
                recoveryMasterKeyIv: toBase64(newRecovery.encryptedRecoveryMasterKeyIV),
                recoveryAuthTokenHash: toBase64(newRecovery.recoveryAuthTokenHash)
            });

            await this.authenticateExisting(username, newPassword, newSalt, currentSelfHostUrl);
            return newRecovery.recoveryCode.fullCode;
        } finally {
            oldKeys.encryptionKey.fill(0);
            oldKeys.loginKey.fill(0);
            newKeys.encryptionKey.fill(0);
            newKeys.loginKey.fill(0);
            rawM.fill(0);
        }
    }

    /**
     * Generate a new 8-char pairing code, encrypt the active identity,
     * and upload it to the current sync server for 5 minutes.
     */
    static async createPairingCode(): Promise<string> {
        const { userId, masterKey, identityKeyPair } = getActiveSession();
        if (!pb.authStore.isValid || !pb.authStore.record || pb.authStore.record.id !== userId) {
            throw new AppError('NOT_AUTHENTICATED', 'Must be connected to sync to pair a device.');
        }

        const pairingCode = generatePairingCode();
        const { lookupId, blob } = await createPairingBlob({
            pairingCode,
            userId,
            username: pb.authStore.record.username as string,
            masterKey,
            identityKeyPair,
            pbToken: pb.authStore.token
        });

        await pb.send('/api/pairing', {
            method: 'POST',
            body: JSON.stringify({ id: lookupId, blob, ttl: 300 })
        });

        return pairingCode;
    }

    /**
     * Connect this device using an 8-char pairing code.
     */
    static async connectWithPairingCode(pairingCode: string): Promise<void> {
        const currentSelfHostUrl = await UserService.getActiveSelfHostUrl();

        const { lookupId } = await derivePairingKeys(pairingCode);

        const resp = await pb.send(`/api/pairing/${lookupId}`, { method: 'GET' });
        if (!resp || !resp.blob) {
            throw new AppError('NOT_FOUND', 'Pairing code invalid or expired.');
        }

        const { userId, username, masterKey, identityKeyPair, pbToken } = await decryptPairingBlob(
            pairingCode,
            resp.blob
        );

        try {
            let serverRecord = null;
            if (pbToken) {
                try {
                    pb.authStore.save(pbToken, null);
                    serverRecord = await pb.collection('users').getOne(userId);
                    pb.authStore.save(pbToken, serverRecord);
                } catch (e) {
                    pb.authStore.clear();
                    logger.warn('Pairing token expired; sign in with password to reconnect.', e);
                }
            }

            let avatarUrl: string | undefined;
            if (serverRecord?.avatar) {
                avatarUrl = pb.files.getURL(
                    serverRecord as { id: string; collectionId: string; collectionName: string },
                    serverRecord.avatar as string
                );
            }

            await UserService.saveUser({
                id: userId,
                name: serverRecord?.name,
                avatar: avatarUrl,
                masterKey,
                identityKeyPair,
                selfHostUrl: currentSelfHostUrl,
                username,
                email: serverRecord?.email
            });
            await UserService.setActiveUser(userId, { preserveAuth: !!serverRecord });

            await DataSyncService.resetCursors(userId);
            await AssetSyncService.resetCursors(userId);
        } catch (e) {
            pb.authStore.clear();
            throw e;
        }
    }

    /** Disconnect local identity from server sync without deleting local data. */
    static async unlinkSync(): Promise<void> {
        const { userId } = getActiveSession();
        SyncManager.stopAutoSync();
        pb.authStore.clear();
        await UserService.updateUser(userId, { username: undefined });
    }

    /** Clear only the remote auth token; local profile/link metadata remains. */
    static async logout(): Promise<void> {
        SyncManager.stopAutoSync();
        pb.authStore.clear();
    }

    // ─── Internals ───────────────────────────────────────────────────

    private static async getSalt(username: string): Promise<SaltResponse> {
        return (await pb.send('/api/account/salt', {
            method: 'POST',
            body: JSON.stringify({ username })
        })) as SaltResponse;
    }

    private static async authenticateExisting(
        username: string,
        password: string,
        salt: Uint8Array<ArrayBuffer>,
        selfHostUrl?: string
    ): Promise<void> {
        const keys = await deriveKeys(password, salt);
        let rawM: Uint8Array<ArrayBuffer> | null = null;
        let rawPrivateKey: Uint8Array<ArrayBuffer> | null = null;
        try {
            let authData: { record: Record<string, string> };
            try {
                authData = (await pb
                    .collection('users')
                    .authWithPassword(username, toHex(keys.loginKey))) as {
                    record: Record<string, string>;
                };
            } catch {
                throw new AppError('INVALID_CREDENTIALS', 'Invalid username or password.');
            }

            rawM = await unwrapMasterKeyRaw(
                fromBase64(authData.record.encryptedMasterKey),
                fromBase64(authData.record.masterKeyIv),
                keys.encryptionKey
            );
            const masterKey = await importMasterKey(rawM, true);

            const publicKey = await importPublicKey(
                JSON.parse(authData.record.identityPublicKey) as JsonWebKey
            );
            rawPrivateKey = await decryptBytes(masterKey, {
                ciphertext: fromBase64(authData.record.encryptedIdentityPrivateKey),
                iv: fromBase64(authData.record.identityPrivateKeyIv)
            });
            const privateKey = await importPrivateKey(rawPrivateKey, true);

            let pbAvatarUrl: string | undefined;
            if (authData.record?.avatar) {
                pbAvatarUrl = pb.files.getURL(authData.record, authData.record.avatar);
            }

            try {
                await UserService.saveUser({
                    id: authData.record.id,
                    name: authData.record?.name,
                    avatar: pbAvatarUrl,
                    masterKey,
                    identityKeyPair: { publicKey, privateKey },
                    selfHostUrl,
                    username: authData.record.username,
                    email: authData.record.email || undefined
                });
                await UserService.setActiveUser(authData.record.id, { preserveAuth: true });

                await DataSyncService.resetCursors(authData.record.id);
                await AssetSyncService.resetCursors(authData.record.id);
            } catch (err) {
                // authWithPassword succeeded but local save failed (e.g. ISLAND_MISMATCH).
                // Clear PB token so a stale cross-island token is never left in memory.
                pb.authStore.clear();
                throw err;
            }
        } finally {
            keys.loginKey.fill(0);
            keys.encryptionKey.fill(0);
            rawM?.fill(0);
            rawPrivateKey?.fill(0);
        }
    }
}
