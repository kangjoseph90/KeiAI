/**
 * Profile Sync Service
 *
 * Handles bidirectional synchronization of user profile data (name, avatar)
 * with PocketBase. Separated from DataSyncService because profile data:
 *   - Lives in the `users` PB collection (not the encrypted data tables)
 *   - Is NOT E2EE (name/avatar are plaintext)
 *   - Has different serialization (avatar is a PB file field, not Base64 blob)
 *
 * Push: Called by ProfileService.update() after local writes.
 * Pull: PB Realtime subscription on the user's own record.
 *
 * This module has NO dependency on Svelte stores - store refresh is handled
 * via a callback registered once via setOnRemoteUpdate().
 */

import { pb } from '$lib/adapters/pb';
import { getActiveSession } from '../session';
import { ProfileService, type Profile } from '../user/profile';
import { appUser } from '$lib/adapters/user';
import { BaseSyncEngine } from './base';
import { createLogger } from '$lib/adapters/logger';
import { AppError } from '$lib/types/errors';

const logger = createLogger('sync:profile');

export class ProfileSyncEngine extends BaseSyncEngine {
    private subscribed = false;
    private onRemoteUpdate: (() => void) | null = null;
    private lastPulledProfile: Profile | null = null;

    constructor() {
        super();
    }

    get isSubscribed(): boolean {
        return this.subscribed;
    }

    setOnRemoteUpdate(callback: (() => void) | null): void {
        this.onRemoteUpdate = callback;
    }

    // ─── Push (local → server) ──────────────────────────

    /**
     * Push the current profile to PocketBase.
     * Fire-and-forget: errors are logged but never thrown.
     */
    async pushProfile(): Promise<void> {
        if (!pb.authStore.isValid) return;

        try {
            const { isGuest, userId } = getActiveSession();
            if (isGuest) return;

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
        }
    }

    // ─── Pull (server → local via Realtime) ──────────────────────────

    /**
     * Subscribe to Realtime updates on the current user's PB record.
     */
    async subscribeRealtime(): Promise<void> {
        if (!pb.authStore.isValid) return;

        let userId: string;
        let isGuest: boolean;
        try {
            ({ userId, isGuest } = getActiveSession());
        } catch {
            return;
        }
        if (isGuest) return;

        // Ensure clean state before subscribing to avoid duplicate handlers
        await this.unsubscribeRealtime();

        await pb.collection('users').subscribe(userId, (e) => {
            void this.handleRealtimeEvent(e.record as Record<string, unknown>);
        });
        this.subscribed = true;
    }

    /**
     * Unsubscribe from Realtime profile updates.
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
    private async handleRealtimeEvent(
        serverRecord: Record<string, unknown>
    ): Promise<Profile | null> {
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

            const remoteUpdatedAt = serverRecord.updated
                ? new Date(serverRecord.updated as string).getTime()
                : 0;

            const localUser = await appUser.getUser(userId);
            const localUpdatedAt = localUser?.updatedAt ?? 0;

            if (localUpdatedAt > remoteUpdatedAt) {
                // Local is newer: push back to server (background fire-and-forget)
                void this.pushProfile();
                return null;
            }

            const updated = await ProfileService.applyRemoteUpdate(
                userId,
                remoteName,
                remoteAvatar,
                remoteUpdatedAt
            );

            // Notify the store layer via the injected callback
            if (updated && this.onRemoteUpdate) {
                this.onRemoteUpdate();
            }

            return updated;
        } catch (err) {
            logger.error('Realtime event error', err);
            return null;
        }
    }

    /**
     * One-shot pull: fetch the latest profile from PB and apply if newer.
     * Called on reconnect / tab focus.
     */
    async pullProfile(): Promise<Profile | null> {
        this.lastPulledProfile = null;
        await this.trigger();
        return this.lastPulledProfile;
    }

    protected override async performSync(): Promise<void> {
        if (!pb.authStore.isValid) return;

        try {
            const { userId, isGuest } = getActiveSession();
            if (isGuest) return;

            const serverRecord = await pb.collection('users').getOne(userId);
            const remoteName = (serverRecord.name as string) ?? '';
            let remoteAvatar = '';
            if (serverRecord.avatar) {
                const serverUrl = pb.files.getURL(serverRecord, serverRecord.avatar as string);
                remoteAvatar = await this.imageUrlToDataUri(serverUrl);
            }

            const remoteUpdatedAt = serverRecord.updated
                ? new Date(serverRecord.updated as string).getTime()
                : 0;

            const localUser = await appUser.getUser(userId);
            const localUpdatedAt = localUser?.updatedAt ?? 0;

            if (localUpdatedAt > remoteUpdatedAt) {
                // Local is newer: push back to server
                await this.pushProfile();
            } else {
                // Remote is newer or equal: apply locally
                this.lastPulledProfile = await ProfileService.applyRemoteUpdate(
                    userId,
                    remoteName,
                    remoteAvatar,
                    remoteUpdatedAt
                );
                if (this.lastPulledProfile) {
                    this.onRemoteUpdate?.();
                }
            }
        } catch (err) {
            logger.error('Pull failed', err);
            throw err;
        }
    }

    protected override isAuthError(error: unknown): boolean {
        if (error instanceof AppError) {
            return error.code === 'NOT_AUTHENTICATED' || error.code === 'SESSION_EXPIRED';
        }

        const status = (error as { status?: unknown })?.status;
        return status === 401 || status === 403;
    }

    protected override isQuotaError(error: unknown): boolean {
        if (error instanceof AppError) {
            return error.code === 'QUOTA_EXCEEDED';
        }
        const status = (error as { status?: unknown })?.status;
        return status === 402 || status === 413;
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

export const ProfileSyncService = new ProfileSyncEngine();
