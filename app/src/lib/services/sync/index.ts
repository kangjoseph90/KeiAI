/**
 * Sync Module - Barrel Export & Lifecycle Orchestrator
 *
 * Directory layout:
 *   sync/data.ts     - DataRecordSyncEngine:    encrypted app data records
 *   sync/user.ts     - UserRecordSyncEngine:    user profile record
 *   sync/asset.ts    - AssetSyncEngine:         asset binary upload engine
 *   sync/multi.ts    - MultiRecordSyncEngine:   plaintext multi-room metadata records
 *   sync/index.ts    - SyncManager:        unified lifecycle (start/stop/reconnect)
 *
 * This module has NO dependency on Svelte stores. UI refresh is driven by
 * store-level subscriptions to local adapter write events.
 */

export { DataRecordSyncEngine } from './data';
export { UserRecordSyncEngine } from './user';
export { AssetSyncEngine } from './asset';
export { MultiRecordSyncEngine } from './multi';
export type { SyncState, SyncProgress, SyncStatus } from './base';

import { DataRecordSyncEngine } from './data';
import { UserRecordSyncEngine } from './user';
import { AssetSyncEngine } from './asset';
import { MultiRecordSyncEngine } from './multi';
import { appUser } from '$lib/adapters/user';
import { appMulti } from '$lib/adapters/multi';
import { localDB, SYNC_TABLES } from '$lib/adapters/db';
import { getActiveSession } from '../session';

/**
 * Unified lifecycle controller for all sync services.
 * UI code (e.g. +page.svelte) only needs to call SyncManager methods.
 */
export class SyncManager {
    private static started = false;
    private static cleanups: Array<() => void> = [];
    private static realtimeSetup: Promise<void> | null = null;

    private static readonly FALLBACK_POLL_INTERVAL_MS = 300_000;

    /**
     * Start all sync subscriptions and the fallback poll timer.
     */
    static startAutoSync(): void {
        if (typeof window === 'undefined' || this.started) return;
        this.started = true;

        void this.ensureRealtimeSubscriptions().catch(() => undefined);
        void AssetSyncEngine.start();

        const pollTimer = setInterval(() => {
            void DataRecordSyncEngine.trigger();
            void AssetSyncEngine.start();
            void MultiRecordSyncEngine.trigger();
        }, this.FALLBACK_POLL_INTERVAL_MS);

        const onlineListener = () => {
            void this.resubscribeAndPull();
        };
        window.addEventListener('online', onlineListener);

        const visibilityListener = () => {
            if (document.visibilityState === 'visible') {
                if (this.hasDisconnectedRecordSync()) {
                    void this.resubscribeAndPull();
                }
            }
        };
        document.addEventListener('visibilitychange', visibilityListener);

        const userCleanup = appUser.subscribeWriteEvents((events) => {
            for (const event of events) {
                UserRecordSyncEngine.handleLocalWrite(event);
            }
        });

        const multiCleanup = appMulti.subscribeWriteEvents((events) => {
            for (const event of events) {
                if (event.origin !== 'local') continue;
                void MultiRecordSyncEngine.handleLocalWrite(event);
            }
        });

        const dbCleanup = localDB.subscribeWriteEvents((events) => {
            for (const event of events) {
                if (SYNC_TABLES.includes(event.tableName)) {
                    DataRecordSyncEngine.handleLocalWrite(event);
                    if (event.origin === 'local') {
                        void AssetSyncEngine.start();
                    }
                }
            }
        });

        this.cleanups = [
            () => clearInterval(pollTimer),
            () => window.removeEventListener('online', onlineListener),
            () => document.removeEventListener('visibilitychange', visibilityListener),
            userCleanup,
            multiCleanup,
            dbCleanup
        ];
    }

    static stopAutoSync(): void {
        for (const cleanup of this.cleanups) {
            cleanup();
        }
        this.cleanups = [];

        void DataRecordSyncEngine.unsubscribeRealtime();
        void MultiRecordSyncEngine.unsubscribeRealtime();
        void UserRecordSyncEngine.unsubscribeRealtime();

        DataRecordSyncEngine.stop();
        MultiRecordSyncEngine.stop();
        UserRecordSyncEngine.stop();
        AssetSyncEngine.stop();

        this.started = false;
    }

    /**
     * Full data sync. Called on boot and after login.
     */
    static async syncAll(): Promise<void> {
        await this.ensureRealtimeSubscriptions();
        await Promise.all([
            DataRecordSyncEngine.trigger(),
            MultiRecordSyncEngine.trigger(),
            UserRecordSyncEngine.trigger()
        ]);
        void AssetSyncEngine.start();
    }

    /** Reset the active user's cursors for the current server and perform a full pull. */
    static async resetCurrentCursors(): Promise<void> {
        const { userId } = getActiveSession();
        await Promise.all([
            DataRecordSyncEngine.resetCursor(userId),
            MultiRecordSyncEngine.resetCursor(userId)
        ]);
        await this.syncAll();
    }

    static async refreshRoomSync(): Promise<void> {
        if (!this.started) return;

        await DataRecordSyncEngine.unsubscribeRealtime();
        await DataRecordSyncEngine.subscribeRealtime();
        await DataRecordSyncEngine.trigger();
        void AssetSyncEngine.start();
    }

    /** On come-back-online / tab-focus: re-subscribe if needed, then catch-up pull. */
    private static async resubscribeAndPull(): Promise<void> {
        await this.syncAll();
    }

    private static async ensureRealtimeSubscriptions(): Promise<void> {
        if (this.realtimeSetup) {
            await this.realtimeSetup;
        }

        const subscriptions: Promise<void>[] = [];
        if (!DataRecordSyncEngine.isSubscribed) {
            subscriptions.push(DataRecordSyncEngine.subscribeRealtime());
        }
        if (!MultiRecordSyncEngine.isSubscribed) {
            subscriptions.push(MultiRecordSyncEngine.subscribeRealtime());
        }
        if (!UserRecordSyncEngine.isSubscribed) {
            subscriptions.push(UserRecordSyncEngine.subscribeRealtime());
        }
        if (subscriptions.length === 0) return;

        const setup = Promise.all(subscriptions).then(() => undefined);
        this.realtimeSetup = setup;
        try {
            await setup;
        } finally {
            if (this.realtimeSetup === setup) this.realtimeSetup = null;
        }
    }

    private static hasDisconnectedRecordSync(): boolean {
        return (
            !DataRecordSyncEngine.isSubscribed ||
            !MultiRecordSyncEngine.isSubscribed ||
            !UserRecordSyncEngine.isSubscribed
        );
    }
}
