/**
 * User Record Sync Engine
 *
 * Handles bidirectional synchronization of user display data (name, avatar)
 * with PocketBase. Separated from DataRecordSyncEngine because user data:
 *   - Lives in the `users` PB collection (not the encrypted data tables)
 *   - Is NOT E2EE (name/avatar are plaintext)
 *   - Has different serialization (avatar is a PB file field, not Base64 blob)
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
import { createLogger } from '$lib/adapters/logger';

const logger = createLogger('sync:user');

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
            const { userId } = getActiveSession();

            const user = await appUser.getUser(userId);
            if (!user) return;

            const updateData: Record<string, unknown> = { name: user.name };

            if (user.avatar?.startsWith('data:image')) {
                try {
                    const fetchResponse = await fetch(user.avatar);
                    updateData.avatar = await fetchResponse.blob();
                } catch (e) {
                    logger.warn('Failed to parse avatar data URI for upload', e);
                }
            }

            // Push to server.
            // Note: We no longer swap the local Data URI for the server URL after upload.
            // Keeping the Data URI locally ensures instant loading and works around Tauri caching issues.
            await pb.collection('users').update(userId, updateData);
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
            const { userId } = getActiveSession();

            const remoteName = (serverRecord.name as string) ?? '';
            let remoteAvatar = '';
            if (serverRecord.avatar) {
                const serverUrl = pb.files.getURL(
                    serverRecord as { id: string; collectionId: string; collectionName: string },
                    serverRecord.avatar as string
                );
                // Convert server URL to Data URI for local-first persistence
                remoteAvatar = await this.imageUrlToDataUri(serverUrl);
            }

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

            await this.applyRemoteUserUpdate(userId, remoteName, remoteAvatar, remoteUpdatedAt);
        } catch (err) {
            logger.error('Realtime event error', err);
        }
    }

    protected override async syncRecords(): Promise<void> {
        if (!isReadyToSync()) return;

        try {
            const { userId } = getActiveSession();
            const user = await appUser.getUser(userId);
            if (!user) return;

            const serverRecord = await pb.collection('users').getOne(userId);
            const remoteName = (serverRecord.name as string) ?? '';
            let remoteAvatar = '';
            if (serverRecord.avatar) {
                const serverUrl = pb.files.getURL(serverRecord, serverRecord.avatar as string);
                remoteAvatar = await this.imageUrlToDataUri(serverUrl);
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
                await this.applyRemoteUserUpdate(userId, remoteName, remoteAvatar, remoteUpdatedAt);
            }
        } catch (err) {
            logger.error('Pull failed', err);
            throw err;
        }
    }

    private async applyRemoteUserUpdate(
        userId: string,
        remoteName: string,
        remoteAvatar: string,
        remoteUpdatedAt: number
    ): Promise<void> {
        const user = await appUser.getUser(userId);
        if (!user) return;
        if (remoteUpdatedAt <= user.updatedAt) return;

        const updated = {
            ...user,
            name: remoteName,
            avatar: remoteAvatar,
            updatedAt: remoteUpdatedAt
        };
        await appUser.saveUser(updated, { origin: 'sync' });
    }

    /**
     * Fetches an image from a URL and converts it to a Data URI.
     * Used to persist remote avatars as local-first Base64 strings.
     */
    private async imageUrlToDataUri(url: string): Promise<string> {
        try {
            const response = await fetch(url);
            if (!response.ok) return url;

            const blob = await response.blob();
            return await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = () => reject(new Error('FileReader failed'));
                reader.readAsDataURL(blob);
            });
        } catch (err) {
            logger.warn('Failed to convert image to data URI', err);
            return url; // Fallback to original URL
        }
    }
}

export const UserRecordSyncEngine = new UserRecordSyncEngineImpl();
