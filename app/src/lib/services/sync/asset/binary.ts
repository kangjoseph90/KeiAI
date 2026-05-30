import { pb } from '$lib/adapters/pb';
import { appStorage } from '$lib/adapters/storage';
import { clock } from '$lib/utils/clock';
import { hasActiveSession } from '../../session';
import {
    appAsset,
    type AssetFields,
    type AssetRegistryRecord,
    type AssetWriteEvent
} from '$lib/adapters/asset';
import type { SyncProgress, SyncStatus } from '../base';
import {
    isQuotaError,
    isAuthError,
    toErrorState,
    belongsToScope,
    getActiveSyncScopes,
    type SyncScope
} from '../utils';
import { createLogger } from '$lib/adapters/logger';
import { encryptConvergentAsset, parseFields } from '../../asset/util';
import { uploadAsset } from '../../asset/remote';
import { Semaphore } from '$lib/utils/semaphore';
import { USER_ASSETS_COLLECTION, ROOM_ASSETS_COLLECTION } from './types';

export interface AssetBinarySyncStatus extends SyncStatus {
    pendingCount: number;
    currentAssetId?: string;
}

const UPLOAD_CONCURRENCY = 3;
const logger = createLogger('sync:asset:binary');

export class AssetBinarySyncEngineImpl {
    private runPromise: Promise<void> | null = null;
    private rerunRequested = false;
    private stopped = false;
    private readonly listeners = new Set<(status: AssetBinarySyncStatus) => void>();
    private status: AssetBinarySyncStatus = { state: 'idle', pendingCount: 0 };

    getState(): AssetBinarySyncStatus {
        return this.cloneStatus(this.status);
    }

    subscribeStatus(listener: (status: AssetBinarySyncStatus) => void): () => void {
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
            pendingCount: 0,
            currentAssetId: undefined,
            progress: undefined
        });
    }

    handleLocalWrite(event: AssetWriteEvent): void {
        if (event.origin !== 'local') return;
        if (event.ids.length === 0) return;
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
                        pendingCount: 0,
                        currentAssetId: undefined,
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
                entries: await appAsset.getRegistryByStatus(syncScope.scope, 'local')
            }))
        );
        const pending = pendingGroups.flatMap(({ syncScope, entries }) =>
            entries.map((entry) => ({ syncScope, entry }))
        );

        this.updateStatus({ pendingCount: pending.length, progress: undefined });
        if (pending.length === 0) return;

        const semaphore = new Semaphore(UPLOAD_CONCURRENCY);
        let completed = 0;
        let fatalError: unknown = null;

        await Promise.all(
            pending.map((item) =>
                semaphore.runExclusive(async () => {
                    if (fatalError || this.stopped) return;

                    this.updateStatus({
                        currentAssetId: item.entry.id,
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
                            pendingCount: Math.max(pending.length - completed, 0),
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
        const asset = await appAsset.getAsset(entry.id);
        if (!asset || asset.isDeleted || !belongsToScope(asset, syncScope.scope)) {
            await appAsset.deleteRegistry(entry.id).catch(() => undefined);
            return;
        }

        const fields = parseFields(asset);
        if (fields.status !== 'local') {
            await this.syncRegistryIndex(entry.id, fields);
            return;
        }

        const plaintext = await appStorage.read(`assets/${entry.id}`);
        if (!plaintext) {
            await appAsset.deleteRegistry(entry.id).catch(() => undefined);
            return;
        }

        const encrypted = await encryptConvergentAsset(plaintext);
        const nextFields: AssetFields = {
            kind: fields.kind,
            status: 'remote',
            hash: encrypted.hash,
            encKey: encrypted.encKey
        };

        if (syncScope.scope.scopeType === 'room') {
            await uploadAsset(encrypted.hash, encrypted.ciphertext, {
                roomId: syncScope.scope.scopeId
            });
        } else {
            await uploadAsset(encrypted.hash, encrypted.ciphertext);
        }

        await appAsset.putAsset({
            ...asset,
            data: nextFields as unknown as Record<string, unknown>,
            updatedAt: clock.now()
        });
        await appAsset.putRegistry({
            ...entry,
            kind: nextFields.kind,
            status: nextFields.status,
            size: plaintext.length,
            updatedAt: clock.now()
        });
    }

    private async syncRegistryIndex(
        id: string,
        fields: Pick<AssetFields, 'kind' | 'status'>
    ): Promise<void> {
        const registry = await appAsset.getRegistry(id);
        if (!registry || registry.isDeleted) return;
        if (registry.kind === fields.kind && registry.status === fields.status) return;
        await appAsset.putRegistry({
            ...registry,
            kind: fields.kind,
            status: fields.status,
            updatedAt: clock.now()
        });
    }

    private updateStatus(patch: Partial<AssetBinarySyncStatus>): void {
        this.status = { ...this.status, ...patch };
        if (patch.progress === undefined) this.status.progress = undefined;
        if (patch.currentAssetId === undefined) this.status.currentAssetId = undefined;
        for (const listener of this.listeners) {
            listener(this.getState());
        }
    }

    private cloneStatus(status: AssetBinarySyncStatus): AssetBinarySyncStatus {
        return {
            ...status,
            progress: status.progress ? ({ ...status.progress } as SyncProgress) : undefined
        };
    }
}

export const AssetBinarySyncEngine = new AssetBinarySyncEngineImpl();
export type AssetSyncStatus = AssetBinarySyncStatus;
