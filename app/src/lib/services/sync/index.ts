/**
 * Sync Module - Barrel Export & Lifecycle Orchestrator
 *
 * Directory layout:
 *   sync/data.ts     - DataSyncService:    encrypted app data (characters, chats, etc.)
 *   sync/profile.ts  - ProfileSyncService: plaintext user profile (name, avatar)
 *   sync/asset.ts    - AssetSyncService:   asset sync (pull/push/realtime) + upload queue
 *   sync/index.ts    - SyncManager:        unified lifecycle (start/stop/reconnect)
 *
 * This module has NO dependency on Svelte stores. Store refresh callbacks are
 * injected via startAutoSync() options, keeping the dependency direction as:
 *   stores → sync (never sync → stores)
 */

export { DataSyncService } from './data';
export { ProfileSyncService } from './profile';
export { AssetSyncService } from './asset';
export type { SyncState, SyncProgress, SyncStatus } from './base';
export type { AssetSyncStatus } from './asset';

import { DataSyncService } from './data';
import { ProfileSyncService } from './profile';
import { AssetSyncService } from './asset';
import { appUser } from '$lib/adapters/user';
import { localDB, SYNC_TABLES } from '$lib/adapters/db';

type SyncTriggerCleanup = () => void;
export type SyncTriggerContext = {
    data: typeof DataSyncService;
    profile: typeof ProfileSyncService;
    asset: typeof AssetSyncService;
    resubscribeAndPull: () => Promise<void>;
};

type SyncTriggerRegistration = (context: SyncTriggerContext) => void | SyncTriggerCleanup;

/**
 * Unified lifecycle controller for all sync services.
 * UI code (e.g. +page.svelte) only needs to call SyncManager methods.
 */
export class SyncManager {
    private static started = false;
    private static readonly triggerRegistrations = new Set<SyncTriggerRegistration>();
    private static readonly activeTriggerCleanups = new Map<
        SyncTriggerRegistration,
        SyncTriggerCleanup
    >();

    private static readonly FALLBACK_POLL_INTERVAL_MS = 300_000;

    private static readonly fallbackPollTrigger: SyncTriggerRegistration = ({ data, asset }) => {
        const timer = setInterval(() => {
            void data.syncAll();
            void asset.start();
        }, this.FALLBACK_POLL_INTERVAL_MS);

        return () => clearInterval(timer);
    };

    private static readonly onlineTrigger: SyncTriggerRegistration = ({ resubscribeAndPull }) => {
        const listener = () => {
            void resubscribeAndPull();
        };

        window.addEventListener('online', listener);
        return () => window.removeEventListener('online', listener);
    };

    private static readonly visibilityTrigger: SyncTriggerRegistration = ({
        data,
        resubscribeAndPull
    }) => {
        const listener = () => {
            if (document.visibilityState === 'visible') {
                if (!data.isSubscribed) {
                    void resubscribeAndPull();
                }
            }
        };

        document.addEventListener('visibilitychange', listener);
        return () => document.removeEventListener('visibilitychange', listener);
    };

    private static readonly localUserTrigger: SyncTriggerRegistration = ({ profile }) => {
        return appUser.subscribeWriteEvents((events) => {
            for (const event of events) {
                if (event.origin !== 'local') continue;
                void profile.pushProfile();
            }
        });
    };

    private static readonly localDbTrigger: SyncTriggerRegistration = ({ data }) => {
        return localDB.subscribeWriteEvents((events) => {
            for (const event of events) {
                if (event.origin !== 'local') continue;

                if (SYNC_TABLES.includes(event.tableName)) {
                    void data.handleLocalWrite(event);
                }
            }
        });
    };

    private static initializedBuiltInTriggers = false;

    // ─── Lifecycle ────────────────────────────────────────────────────

    /**
     * Start all sync subscriptions and the fallback poll timer.
     *
     * @param options.onProfileUpdate - Callback invoked when a remote profile
     *        update is applied locally. Injected here so the sync layer never
     *        imports from the store layer directly.
     */
    static startAutoSync(options?: { onProfileUpdate?: () => void }): void {
        if (typeof window === 'undefined' || this.started) return;

        this.ensureBuiltInTriggersRegistered();
        this.started = true;

        ProfileSyncService.setOnRemoteUpdate(options?.onProfileUpdate ?? null);

        // Data sync Realtime subscriptions
        void DataSyncService.subscribeRealtime();

        // Asset sync Realtime subscription + catch-up pull + upload queue
        void AssetSyncService.subscribeRealtime();
        void AssetSyncService.start();

        // Profile sync Realtime subscription
        void ProfileSyncService.subscribeRealtime();
        this.installTriggerSources();
    }

    static stopAutoSync(): void {
        void DataSyncService.unsubscribeRealtime();
        void AssetSyncService.unsubscribeRealtime();
        void ProfileSyncService.unsubscribeRealtime();
        ProfileSyncService.setOnRemoteUpdate(null);
        AssetSyncService.stop();
        this.clearTriggerSources();
        this.started = false;
    }

    /**
     * Full data sync. Called on boot and after login.
     */
    static async syncAll(): Promise<void> {
        await DataSyncService.syncAll();
        await AssetSyncService.start();
        await ProfileSyncService.pullProfile();
    }

    static registerTriggerSource(register: SyncTriggerRegistration): () => void {
        this.triggerRegistrations.add(register);

        if (this.started && typeof window !== 'undefined') {
            this.installTriggerSource(register);
        }

        return () => {
            const cleanup = this.activeTriggerCleanups.get(register);
            if (cleanup) {
                cleanup();
                this.activeTriggerCleanups.delete(register);
            }
            this.triggerRegistrations.delete(register);
        };
    }

    // ─── Internal ────────────────────────────────────────────────────

    /** On come-back-online / tab-focus: re-subscribe if needed, then catch-up pull. */
    private static async resubscribeAndPull(): Promise<void> {
        if (!DataSyncService.isSubscribed) {
            await DataSyncService.subscribeRealtime();
        }
        if (!AssetSyncService.isSubscribed) {
            await AssetSyncService.subscribeRealtime();
        }
        if (!ProfileSyncService.isSubscribed) {
            await ProfileSyncService.subscribeRealtime();
        }

        await DataSyncService.syncAll();
        await AssetSyncService.start();
        await ProfileSyncService.pullProfile();
    }

    private static ensureBuiltInTriggersRegistered(): void {
        if (this.initializedBuiltInTriggers) return;

        this.triggerRegistrations.add(this.fallbackPollTrigger);
        this.triggerRegistrations.add(this.onlineTrigger);
        this.triggerRegistrations.add(this.visibilityTrigger);
        this.triggerRegistrations.add(this.localUserTrigger);
        this.triggerRegistrations.add(this.localDbTrigger);
        this.initializedBuiltInTriggers = true;
    }

    private static installTriggerSources(): void {
        for (const registration of this.triggerRegistrations) {
            this.installTriggerSource(registration);
        }
    }

    private static installTriggerSource(registration: SyncTriggerRegistration): void {
        if (this.activeTriggerCleanups.has(registration)) return;

        const cleanup = registration({
            data: DataSyncService,
            profile: ProfileSyncService,
            asset: AssetSyncService,
            resubscribeAndPull: () => this.resubscribeAndPull()
        });

        this.activeTriggerCleanups.set(registration, cleanup ?? (() => {}));
    }

    private static clearTriggerSources(): void {
        for (const cleanup of this.activeTriggerCleanups.values()) {
            cleanup();
        }
        this.activeTriggerCleanups.clear();
    }
}
