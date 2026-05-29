/**
 * Sync Module - Barrel Export & Lifecycle Orchestrator
 *
 * Directory layout:
 *   sync/data.ts     - DataRecordSyncEngine:    encrypted app data records
 *   sync/user.ts     - UserRecordSyncEngine:    user profile record
 *   sync/asset/record.ts - AssetRecordSyncEngine:   asset metadata records
 *   sync/asset/binary.ts - AssetBinarySyncEngine:   asset binary upload engine
 *   sync/multi.ts    - MultiRecordSyncEngine:   plaintext multi-room metadata records
 *   sync/index.ts    - SyncManager:        unified lifecycle (start/stop/reconnect)
 *
 * This module has NO dependency on Svelte stores. UI refresh is driven by
 * store-level subscriptions to local adapter write events.
 */

export { DataRecordSyncEngine } from './data';
export { UserRecordSyncEngine } from './user';
export { AssetRecordSyncEngine, AssetBinarySyncEngine } from './asset';
export { MultiRecordSyncEngine } from './multi';
export type { SyncState, SyncProgress, SyncStatus } from './base';
export type { AssetSyncStatus } from './asset';

import { DataRecordSyncEngine } from './data';
import { UserRecordSyncEngine } from './user';
import { AssetRecordSyncEngine, AssetBinarySyncEngine } from './asset';
import { MultiRecordSyncEngine } from './multi';
import { appUser } from '$lib/adapters/user';
import { appMulti } from '$lib/adapters/multi';
import { appAsset } from '$lib/adapters/asset';
import { localDB, SYNC_TABLES } from '$lib/adapters/db';

/**
 * Unified lifecycle controller for all sync services.
 * UI code (e.g. +page.svelte) only needs to call SyncManager methods.
 */
export class SyncManager {
    private static started = false;
    private static cleanups: Array<() => void> = [];

    private static readonly FALLBACK_POLL_INTERVAL_MS = 300_000;

    /**
     * Start all sync subscriptions and the fallback poll timer.
     */
    static startAutoSync(): void {
        if (typeof window === 'undefined' || this.started) return;
        this.started = true;

        void DataRecordSyncEngine.subscribeRealtime();
        void AssetRecordSyncEngine.subscribeRealtime();
        void AssetBinarySyncEngine.start();
        void MultiRecordSyncEngine.subscribeRealtime();
        void UserRecordSyncEngine.subscribeRealtime();

        const pollTimer = setInterval(() => {
            void DataRecordSyncEngine.trigger();
            void AssetRecordSyncEngine.trigger();
            void AssetBinarySyncEngine.start();
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
                }
            }
        });

        const assetCleanup = appAsset.subscribeWriteEvents((events) => {
            for (const event of events) {
                AssetRecordSyncEngine.handleLocalWrite(event);
                AssetBinarySyncEngine.handleLocalWrite(event);
            }
        });

        this.cleanups = [
            () => clearInterval(pollTimer),
            () => window.removeEventListener('online', onlineListener),
            () => document.removeEventListener('visibilitychange', visibilityListener),
            userCleanup,
            multiCleanup,
            dbCleanup,
            assetCleanup
        ];
    }

    static stopAutoSync(): void {
        for (const cleanup of this.cleanups) {
            cleanup();
        }
        this.cleanups = [];

        void DataRecordSyncEngine.unsubscribeRealtime();
        void AssetRecordSyncEngine.unsubscribeRealtime();
        void MultiRecordSyncEngine.unsubscribeRealtime();
        void UserRecordSyncEngine.unsubscribeRealtime();

        DataRecordSyncEngine.stop();
        AssetRecordSyncEngine.stop();
        MultiRecordSyncEngine.stop();
        UserRecordSyncEngine.stop();
        AssetBinarySyncEngine.stop();

        this.started = false;
    }

    /**
     * Full data sync. Called on boot and after login.
     */
    static async syncAll(): Promise<void> {
        await Promise.all([
            DataRecordSyncEngine.trigger(),
            AssetRecordSyncEngine.trigger(),
            MultiRecordSyncEngine.trigger(),
            UserRecordSyncEngine.trigger()
        ]);
        void AssetBinarySyncEngine.start();
    }

    static async refreshRoomSync(): Promise<void> {
        if (!this.started) return;

        await Promise.all([
            DataRecordSyncEngine.unsubscribeRealtime(),
            AssetRecordSyncEngine.unsubscribeRealtime()
        ]);
        await Promise.all([
            DataRecordSyncEngine.subscribeRealtime(),
            AssetRecordSyncEngine.subscribeRealtime()
        ]);
        await Promise.all([DataRecordSyncEngine.trigger(), AssetRecordSyncEngine.trigger()]);
        void AssetBinarySyncEngine.start();
    }

    /** On come-back-online / tab-focus: re-subscribe if needed, then catch-up pull. */
    private static async resubscribeAndPull(): Promise<void> {
        if (!DataRecordSyncEngine.isSubscribed) {
            await DataRecordSyncEngine.subscribeRealtime();
        }
        if (!AssetRecordSyncEngine.isSubscribed) {
            await AssetRecordSyncEngine.subscribeRealtime();
        }
        if (!MultiRecordSyncEngine.isSubscribed) {
            await MultiRecordSyncEngine.subscribeRealtime();
        }
        if (!UserRecordSyncEngine.isSubscribed) {
            await UserRecordSyncEngine.subscribeRealtime();
        }

        await Promise.all([
            DataRecordSyncEngine.trigger(),
            AssetRecordSyncEngine.trigger(),
            MultiRecordSyncEngine.trigger(),
            UserRecordSyncEngine.trigger()
        ]);
        void AssetBinarySyncEngine.start();
    }

    private static hasDisconnectedRecordSync(): boolean {
        return (
            !DataRecordSyncEngine.isSubscribed ||
            !AssetRecordSyncEngine.isSubscribed ||
            !MultiRecordSyncEngine.isSubscribed ||
            !UserRecordSyncEngine.isSubscribed
        );
    }
}
