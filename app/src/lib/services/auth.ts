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
    wrapMasterKey
} from '$lib/crypto';
import { UserService } from './user';
import type { UserConnectionSettings } from '$lib/types/connections';
import { getActiveSession } from './session';
import { SyncManager } from './sync';
import { decryptUserProfile, encryptUserProfile } from './sync/user';
import { AppError } from '$lib/types/errors';
import { createLogger } from '$lib/adapters/logger';
import { appKV } from '$lib/adapters/kv';
import { normalizeUrl } from '$lib/utils/url';
import type { RecordModel } from 'pocketbase';

const logger = createLogger('service:auth');
const AUTH_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const AUTH_REFRESH_REQUEST_KEY = 'keiai-auth-refresh';

interface SaltResponse {
    salt: string;
}

interface RecoverResponse {
    encryptedRecoveryMasterKey: string;
    encryptedRecoveryMasterKeyIV: string;
}

interface StoredPocketBaseAuth {
    token: string;
    record: RecordModel;
}

function normalizeUsername(username: string): string {
    const normalized = username.trim().toLowerCase();
    if (!normalized) throw new AppError('INVALID_INPUT', 'Username is required.');
    return normalized;
}

export class AuthService {
    private static refreshPromise: Promise<boolean> | null = null;
    private static authRevision = 0;
    private static lastSuccessfulRefreshAt = 0;
    private static refreshCleanups: Array<() => void> = [];

    // ─── Local Auth Sessions ─────────────────────────────────────────

    private static getStoredAuthKey(userId: string, serverUrl: string): string {
        return `pbAuth_${userId}_${encodeURIComponent(normalizeUrl(serverUrl))}`;
    }

    private static clearActivePbAuth(): void {
        this.authRevision++;
        this.refreshPromise = null;
        pb.cancelRequest(AUTH_REFRESH_REQUEST_KEY);
        pb.authStore.clear();
    }

    static async persistPbAuth(userId: string, serverUrl: string = pb.baseUrl): Promise<void> {
        const key = this.getStoredAuthKey(userId, serverUrl);
        const record = pb.authStore.record;

        if (!pb.authStore.isValid || !record || record.id !== userId) {
            await appKV.remove(key);
            return;
        }

        await appKV.set(
            key,
            JSON.stringify({ token: pb.authStore.token, record } satisfies StoredPocketBaseAuth)
        );
    }

    static async restorePbAuth(userId: string, serverUrl: string = pb.baseUrl): Promise<boolean> {
        this.clearActivePbAuth();
        const key = this.getStoredAuthKey(userId, serverUrl);
        const raw = await appKV.get(key);
        if (!raw) return false;

        try {
            const stored = JSON.parse(raw) as Partial<StoredPocketBaseAuth>;
            if (!stored.token || !stored.record || stored.record.id !== userId) {
                await appKV.remove(key);
                return false;
            }
            pb.authStore.save(stored.token, stored.record);
            if (!pb.authStore.isValid) {
                pb.authStore.clear();
                await appKV.remove(key);
                return false;
            }
            return true;
        } catch {
            await appKV.remove(key);
            return false;
        }
    }

    static async clearPbAuth(userId: string, serverUrl: string = pb.baseUrl): Promise<void> {
        this.clearActivePbAuth();
        await appKV.remove(this.getStoredAuthKey(userId, serverUrl));
    }

    static async clearAllPbAuthForUser(userId: string): Promise<void> {
        if (pb.authStore.record?.id === userId) this.clearActivePbAuth();
        const keys = await appKV.keys(`pbAuth_${userId}_`);
        await Promise.all(keys.map((key) => appKV.remove(key)));
    }

    // ─── PB Connection Helpers ────────────────────────────────────────

    /** Whether PocketBase currently holds a valid auth token. */
    static isPbConnected(): boolean {
        return pb.authStore.isValid;
    }

    /** Subscribe to PB auth state changes (token valid/invalid). */
    static onPbAuthChange(callback: (isValid: boolean) => void): void {
        pb.authStore.onChange(() => callback(pb.authStore.isValid));
    }

    /**
     * Refresh the current PocketBase token without retaining login credentials.
     * Transient failures leave a still-valid token intact; explicit auth rejection clears it.
     */
    static async refreshPbAuth(options: { force?: boolean } = {}): Promise<boolean> {
        if (!pb.authStore.token) return false;
        if (!pb.authStore.isValid) {
            pb.authStore.clear();
            try {
                await this.persistPbAuth(getActiveSession().userId);
            } catch {
                // No active local session yet.
            }
            return false;
        }

        if (
            !options.force &&
            Date.now() - this.lastSuccessfulRefreshAt < AUTH_REFRESH_INTERVAL_MS
        ) {
            return true;
        }
        if (this.refreshPromise) return this.refreshPromise;

        const authRevision = this.authRevision;
        const refresh = (async () => {
            try {
                await pb.collection('users').authRefresh({ requestKey: AUTH_REFRESH_REQUEST_KEY });
                if (authRevision !== this.authRevision) return false;
                this.lastSuccessfulRefreshAt = Date.now();
                try {
                    await this.persistPbAuth(getActiveSession().userId);
                } catch {
                    // Startup may refresh before an active local session exists.
                }
                return true;
            } catch (error) {
                if (authRevision !== this.authRevision) return false;
                const status = (error as { status?: unknown })?.status;
                if (status === 401 || status === 403 || !pb.authStore.isValid) {
                    pb.authStore.clear();
                    try {
                        await this.persistPbAuth(getActiveSession().userId);
                    } catch {
                        // No active local session yet.
                    }
                    return false;
                }
                logger.warn('PocketBase auth refresh failed; keeping the valid token.', error);
                return true;
            }
        })();

        this.refreshPromise = refresh;
        try {
            return await refresh;
        } finally {
            if (this.refreshPromise === refresh) this.refreshPromise = null;
        }
    }

    /** Refresh daily, and retry when the app returns online or to the foreground. */
    static startAutoRefresh(): void {
        if (typeof window === 'undefined' || this.refreshCleanups.length > 0) return;

        const refresh = () => void this.refreshPbAuth();
        const refreshTimer = window.setInterval(refresh, AUTH_REFRESH_INTERVAL_MS);
        const visibilityListener = () => {
            if (document.visibilityState === 'visible') refresh();
        };

        window.addEventListener('online', refresh);
        document.addEventListener('visibilitychange', visibilityListener);
        this.refreshCleanups = [
            () => window.clearInterval(refreshTimer),
            () => window.removeEventListener('online', refresh),
            () => document.removeEventListener('visibilitychange', visibilityListener)
        ];
    }

    static stopAutoRefresh(): void {
        for (const cleanup of this.refreshCleanups) cleanup();
        this.refreshCleanups = [];
        this.authRevision++;
        this.refreshPromise = null;
        pb.cancelRequest(AUTH_REFRESH_REQUEST_KEY);
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
        const currentConnections = await UserService.getActiveConnections();

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
            const encryptedProfile = await encryptUserProfile(masterKey, {
                name: existing.name,
                avatar: existing.avatar
            });

            const createData: Record<string, string> = {
                id: userId,
                username: normalizedUsername,
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
                identityPrivateKeyIv: toBase64(encryptedPrivateKey.iv),
                encryptedProfile: encryptedProfile.encryptedProfile,
                encryptedProfileIV: encryptedProfile.encryptedProfileIV
            };

            if (email) createData.email = email;

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

        await this.authenticateExisting(normalizedUsername, password, salt, currentConnections);
        return recoveryCode;
    }

    /**
     * Sign in to an existing sync account and switch to its canonical userId.
     */
    static async signIn(username: string, password: string): Promise<void> {
        const normalizedUsername = normalizeUsername(username);
        const currentConnections = await UserService.getActiveConnections();

        const { salt } = await this.getSalt(normalizedUsername);
        await this.authenticateExisting(
            normalizedUsername,
            password,
            fromBase64(salt),
            currentConnections
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

        const resp = (await pb.send('/api/recovery/lookup', {
            method: 'POST',
            body: JSON.stringify({ authTokenHash: toBase64(authTokenHash) })
        })) as RecoverResponse;

        const masterKey = await recoverMasterKey(
            recoveryCode,
            fromBase64(resp.encryptedRecoveryMasterKey),
            fromBase64(resp.encryptedRecoveryMasterKeyIV)
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

        return newRecoveryCode;
    }

    /**
     * Delete the remote sync account using a recovery code.
     * Keeps local data intact and returns the local identity to local-only mode.
     */
    static async deleteAccountWithRecoveryCode(recoveryCode: string): Promise<void> {
        const { userId } = getActiveSession();
        const { backHalf } = splitRecoveryCode(recoveryCode);
        const authTokenHash = await hashRecoveryAuthToken(backHalf);

        await pb.send('/api/recovery/delete', {
            method: 'POST',
            body: JSON.stringify({ authTokenHash: toBase64(authTokenHash) })
        });
        await this.logout();
        await UserService.updateUser(userId, { username: undefined });
    }

    /**
     * Change the password while connected.
     * Returns the new recovery code that replaces the old one.
     */
    static async changePassword(oldPassword: string, newPassword: string): Promise<string> {
        const { userId } = getActiveSession();
        const currentConnections = await UserService.getActiveConnections();

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

            await this.authenticateExisting(username, newPassword, newSalt, currentConnections);
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
        await this.refreshPbAuth({ force: true });
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
        const currentConnections = await UserService.getActiveConnections();

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

            const profile = serverRecord
                ? await decryptUserProfile(masterKey, serverRecord as Record<string, unknown>)
                : null;

            await UserService.saveUser({
                id: userId,
                name: profile?.name,
                avatar: profile?.avatar,
                masterKey,
                identityKeyPair,
                connections: currentConnections,
                username,
                email: serverRecord?.email
            });
            await UserService.selectUser(userId);
            if (serverRecord) await this.persistPbAuth(userId);
        } catch (e) {
            pb.authStore.clear();
            throw e;
        }
    }

    /** Clear only the remote auth token; local profile/link metadata remains. */
    static async logout(): Promise<void> {
        const { userId } = getActiveSession();
        this.stopAutoRefresh();
        SyncManager.stopAutoSync();
        await this.clearPbAuth(userId);
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
        connections: UserConnectionSettings
    ): Promise<void> {
        const keys = await deriveKeys(password, salt);
        let rawM: Uint8Array<ArrayBuffer> | null = null;
        let rawPrivateKey: Uint8Array<ArrayBuffer> | null = null;
        let authReplaced = false;
        try {
            let authData: { record: Record<string, string> };
            try {
                authData = (await pb
                    .collection('users')
                    .authWithPassword(username, toHex(keys.loginKey))) as {
                    record: Record<string, string>;
                };
                authReplaced = true;
            } catch (error) {
                const status = (error as { status?: unknown })?.status;
                if (status === 400 || status === 401) {
                    throw new AppError('INVALID_CREDENTIALS', 'Invalid username or password.');
                }
                throw error;
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

            const profile = await decryptUserProfile(masterKey, authData.record);

            await UserService.saveUser({
                id: authData.record.id,
                name: profile?.name,
                avatar: profile?.avatar,
                masterKey,
                identityKeyPair: { publicKey, privateKey },
                connections,
                username: authData.record.username,
                email: authData.record.email || undefined
            });
            await UserService.selectUser(authData.record.id);
            await this.persistPbAuth(authData.record.id);
        } catch (error) {
            if (authReplaced) pb.authStore.clear();
            throw error;
        } finally {
            keys.loginKey.fill(0);
            keys.encryptionKey.fill(0);
            rawM?.fill(0);
            rawPrivateKey?.fill(0);
        }
    }
}
