/**
 * User Record Sync Engine
 *
 * Handles bidirectional synchronization of user display data (name, avatar)
 * with PocketBase. Separated from DataRecordSyncEngine because user data:
 *   - Lives in encrypted profile fields on the `users` PB collection
 *   - Shares the auth record lifecycle, but keeps display data opaque to the server
 *
 * Push: Triggered by local user adapter write events.
 * Pull: PB Realtime subscription on the user's own record.
 *
 * This module has NO dependency on Svelte stores. Store refresh is handled by
 * the user store subscribing to local user write events, just like data sync.
 */

import { pb } from '$lib/adapters/pb';
import { getActiveSession } from '../session';
import { appUser, type UserWriteEvent } from '$lib/adapters/user';
import { BaseRecordSyncEngine, type BufferedRecordWrite } from './base';
import { normalizeTimestamp, isReadyToSync } from './utils';
import { decrypt, encrypt, fromBase64, toBase64 } from '$lib/crypto';
import { createLogger } from '$lib/adapters/logger';

const logger = createLogger('sync:user');

export interface UserProfilePayload {
    name: string;
    avatar: string;
}

export interface EncryptedUserProfile {
    encryptedProfile: string;
    encryptedProfileIV: string;
}

export async function encryptUserProfile(
    masterKey: CryptoKey,
    profile: UserProfilePayload
): Promise<EncryptedUserProfile> {
    const encrypted = await encrypt(masterKey, JSON.stringify(profile));
    return {
        encryptedProfile: toBase64(encrypted.ciphertext),
        encryptedProfileIV: toBase64(encrypted.iv)
    };
}

export async function decryptUserProfile(
    masterKey: CryptoKey,
    record: Record<string, unknown>
): Promise<UserProfilePayload | null> {
    const encryptedProfile = record.encryptedProfile;
    const encryptedProfileIV = record.encryptedProfileIV;
    if (typeof encryptedProfile !== 'string' || typeof encryptedProfileIV !== 'string') {
        return null;
    }

    const plaintext = await decrypt(masterKey, {
        ciphertext: fromBase64(encryptedProfile),
        iv: fromBase64(encryptedProfileIV)
    });
    const parsed = JSON.parse(plaintext) as Partial<UserProfilePayload>;
    return {
        name: typeof parsed.name === 'string' ? parsed.name : '',
        avatar: typeof parsed.avatar === 'string' ? parsed.avatar : ''
    };
}

export class UserRecordSyncEngineImpl extends BaseRecordSyncEngine<UserWriteEvent, 'user'> {
    private subscribed = false;

    constructor() {
        super();
    }

    get isSubscribed(): boolean {
        return this.subscribed;
    }

    protected override getBufferedWrites(event: UserWriteEvent): BufferedRecordWrite<'user'>[] {
        if (event.origin !== 'local') return [];
        if (event.ids.length === 0) return [];

        return event.ids.map((id) => ({ bucket: 'user', id }));
    }

    protected override async pushBufferedWrites(
        writes: BufferedRecordWrite<'user'>[]
    ): Promise<void> {
        if (writes.length === 0) return;
        await this.pushCurrentUser();
    }

    /**
     * Push the current user display data to PocketBase.
     */
    private async pushCurrentUser(): Promise<void> {
        if (!isReadyToSync()) return;

        try {
            const { userId, masterKey } = getActiveSession();

            const user = await appUser.getUser(userId);
            if (!user) return;

            const encryptedProfile = await encryptUserProfile(masterKey, {
                name: user.name,
                avatar: user.avatar
            });
            await pb.collection('users').update(userId, encryptedProfile);
        } catch (err) {
            logger.error('Push failed', err);
            throw err;
        }
    }

    /**
     * Subscribe to Realtime updates on the current user's PB record.
     */
    async subscribeRealtime(): Promise<void> {
        if (!isReadyToSync()) return;

        const { userId } = getActiveSession();

        // Ensure clean state before subscribing to avoid duplicate handlers
        await this.unsubscribeRealtime();

        try {
            await pb.collection('users').subscribe(userId, (e) => {
                void this.handleRealtimeEvent(e.record as Record<string, unknown>);
            });
        } catch (err) {
            await this.unsubscribeRealtime();
            throw err;
        }

        this.subscribed = true;
    }

    /**
     * Unsubscribe from Realtime user updates.
     */
    async unsubscribeRealtime(): Promise<void> {
        try {
            const { userId } = getActiveSession();
            await pb.collection('users').unsubscribe(userId);
        } catch {
            // session may not exist anymore; that's fine
        }
        this.subscribed = false;
        this.updateStatus({ state: 'idle', progress: undefined });
    }

    /**
     * Handle a Realtime event for the user's own PB record.
     */
    private async handleRealtimeEvent(serverRecord: Record<string, unknown>): Promise<void> {
        try {
            const { userId, masterKey } = getActiveSession();
            const remoteProfile = await decryptUserProfile(masterKey, serverRecord);
            if (!remoteProfile) return;

            const remoteUpdatedAt = normalizeTimestamp(
                serverRecord.updatedAt,
                serverRecord.updated
            );

            const localUser = await appUser.getUser(userId);
            const localUpdatedAt = localUser?.updatedAt ?? 0;

            if (localUpdatedAt > remoteUpdatedAt) {
                // Local is newer: push back to server (background fire-and-forget)
                void this.pushCurrentUser().catch(() => undefined);
                return;
            }

            await this.applyRemoteUserUpdate(userId, remoteProfile, remoteUpdatedAt);
        } catch (err) {
            logger.error('Realtime event error', err);
        }
    }

    protected override async syncRecords(): Promise<void> {
        if (!isReadyToSync()) return;

        try {
            const { userId, masterKey } = getActiveSession();
            const user = await appUser.getUser(userId);
            if (!user) return;

            const serverRecord = await pb.collection('users').getOne(userId);
            const remoteProfile = await decryptUserProfile(masterKey, serverRecord);
            if (!remoteProfile) {
                await this.pushCurrentUser();
                return;
            }

            const remoteUpdatedAt = normalizeTimestamp(
                serverRecord.updatedAt,
                serverRecord.updated
            );

            const localUpdatedAt = user?.updatedAt ?? 0;

            if (localUpdatedAt > remoteUpdatedAt) {
                // Local is newer: push back to server
                await this.pushCurrentUser();
            } else {
                // Remote is newer or equal: apply locally
                await this.applyRemoteUserUpdate(userId, remoteProfile, remoteUpdatedAt);
            }
        } catch (err) {
            logger.error('Pull failed', err);
            throw err;
        }
    }

    private async applyRemoteUserUpdate(
        userId: string,
        remoteProfile: { name: string; avatar: string },
        remoteUpdatedAt: number
    ): Promise<void> {
        const user = await appUser.getUser(userId);
        if (!user) return;
        if (remoteUpdatedAt <= user.updatedAt) return;

        const updated = {
            ...user,
            name: remoteProfile.name,
            avatar: remoteProfile.avatar,
            updatedAt: remoteUpdatedAt
        };
        await appUser.saveUser(updated, { origin: 'sync' });
    }
}

export const UserRecordSyncEngine = new UserRecordSyncEngineImpl();
