import { pb } from '$lib/adapters/pb';
import { hasActiveSession } from '../session';
import { appAsset, type AssetRegistryRecord } from '$lib/adapters/asset';
import type { SyncProgress, SyncStatus } from './base';
import {
    isQuotaError,
    isAuthError,
    toErrorState,
    getActiveSyncScopes,
    type SyncScope
} from './utils';
import { createLogger } from '$lib/adapters/logger';
import { AssetService } from '../asset';
import { encryptConvergentAsset } from '../asset/util';
import { uploadAsset } from '../asset/remote';
import { Semaphore } from '$lib/utils/semaphore';

export type AssetCollection = 'records' | 'multi_room_records';

export const USER_ASSETS_COLLECTION: AssetCollection = 'records';
export const ROOM_ASSETS_COLLECTION: AssetCollection = 'multi_room_records';

const UPLOAD_CONCURRENCY = 3;
const logger = createLogger('sync:asset');

export class AssetSyncEngineImpl {
    private runPromise: Promise<void> | null = null;
    private rerunRequested = false;
    private stopped = false;
    private readonly listeners = new Set<(status: SyncStatus) => void>();
    private status: SyncStatus = { state: 'idle' };

    getState(): SyncStatus {
        return this.cloneStatus(this.status);
    }

    subscribeStatus(listener: (status: SyncStatus) => void): () => void {
        this.listeners.add(listener);
        listener(this.getState());
        return () => {
            this.listeners.delete(listener);
        };
    }

    async start(): Promise<void> {
        this.stopped = false;
        this.rerunRequested = true;
        if (this.runPromise) return this.runPromise;

        this.runPromise = this.drainQueue().finally(() => {
            this.runPromise = null;
        });
        return this.runPromise;
    }

    stop(): void {
        this.stopped = true;
        this.rerunRequested = false;
        this.updateStatus({
            state: 'idle',
            progress: undefined
        });
    }

    handleLocalWrite(): void {
        void this.start();
    }

    private async drainQueue(): Promise<void> {
        while (this.rerunRequested && !this.stopped) {
            this.rerunRequested = false;
            this.updateStatus({ state: 'syncing' });
            try {
                if (pb.authStore.isValid && hasActiveSession()) {
                    await this.processUploadQueue(
                        getActiveSyncScopes(USER_ASSETS_COLLECTION, ROOM_ASSETS_COLLECTION)
                    );
                }
                if (!this.rerunRequested) {
                    this.updateStatus({
                        state: 'idle',
                        progress: undefined
                    });
                }
            } catch (error) {
                this.updateStatus({
                    state: toErrorState(error),
                    progress: undefined
                });
                break;
            }
        }
    }

    private async processUploadQueue(scopes: SyncScope[]): Promise<void> {
        const pendingGroups = await Promise.all(
            scopes.map(async (syncScope) => ({
                syncScope,
                entries: await AssetService.getLocalAssets(syncScope.scope)
            }))
        );
        const pending = pendingGroups.flatMap(({ syncScope, entries }) =>
            entries
                .filter((entry) => entry.ownerTable !== 'chats')
                .map((entry) => ({ syncScope, entry }))
        );

        this.updateStatus({
            progress: {
                completed: 0,
                total: pending.length
            }
        });
        if (pending.length === 0) return;

        const semaphore = new Semaphore(UPLOAD_CONCURRENCY);
        let completed = 0;
        let fatalError: unknown = null;

        await Promise.all(
            pending.map((item) =>
                semaphore.runExclusive(async () => {
                    if (fatalError || this.stopped) return;

                    this.updateStatus({
                        progress: {
                            completed,
                            total: pending.length,
                            currentItemId: item.entry.id
                        }
                    });

                    try {
                        await this.uploadOne(item.entry, item.syncScope);
                    } catch (error) {
                        if (isQuotaError(error) || isAuthError(error)) {
                            fatalError = error;
                            this.stopped = true;
                            return;
                        }
                        logger.error(`Failed to sync asset ${item.entry.id}:`, error);
                    } finally {
                        completed++;
                        this.updateStatus({
                            progress: {
                                completed,
                                total: pending.length,
                                currentItemId: item.entry.id
                            }
                        });
                    }
                })
            )
        );

        if (fatalError) throw fatalError;
    }

    private async uploadOne(entry: AssetRegistryRecord, syncScope: SyncScope): Promise<void> {
        const plaintext = await appAsset.readAssetBytes(entry);
        if (!plaintext) {
            await AssetService.delete(entry).catch(() => undefined);
            return;
        }

        const encrypted = await encryptConvergentAsset(plaintext);
        if (encrypted.hash !== entry.hash) {
            logger.error(`Local asset hash mismatch during upload: ${entry.id}`);
            return;
        }

        if (syncScope.scope.scopeType === 'room') {
            await uploadAsset(entry.hash, encrypted.ciphertext, {
                roomId: syncScope.scope.scopeId
            });
        } else {
            await uploadAsset(entry.hash, encrypted.ciphertext);
        }

        await AssetService.markRemote(entry);
    }

    private updateStatus(patch: Partial<SyncStatus>): void {
        this.status = { ...this.status, ...patch };
        if (patch.progress === undefined) this.status.progress = undefined;
        for (const listener of this.listeners) {
            listener(this.getState());
        }
    }

    private cloneStatus(status: SyncStatus): SyncStatus {
        return {
            ...status,
            progress: status.progress ? ({ ...status.progress } as SyncProgress) : undefined
        };
    }
}

export const AssetSyncEngine = new AssetSyncEngineImpl();
