import { appHttp } from '$lib/adapters/http';
import { createLogger } from '$lib/adapters/logger';
import { AppError } from '$lib/types/errors';
import { Semaphore } from '$lib/utils/semaphore';
import { buildUrl, normalizeUrl } from '$lib/utils/url';
import { AssetService } from './asset';
import { SyncManager } from './sync';
import { getActiveSession } from './session';
import { UserService } from './user';
import type { AssetRegistryRecord } from './asset';

const logger = createLogger('service:migration');
const LOCALIZATION_CONCURRENCY = 4;

export type MigrationPhase = 'idle' | 'validating' | 'localizing' | 'committing' | 'done';

export interface MigrationProgress {
    phase: MigrationPhase;
    completed: number;
    total: number;
    currentItemId?: string;
}

export interface MigrationOptions {
    onProgress?: (progress: MigrationProgress) => void;
}

export interface HostCapabilities {
    app: 'keiai';
    protocol: number;
}

type MigrationLockListener = (locked: boolean) => void;

export class MigrationService {
    private static locked = false;
    private static lockListeners = new Set<MigrationLockListener>();

    static isLocked(): boolean {
        return this.locked;
    }

    static onLockChange(listener: MigrationLockListener): () => void {
        this.lockListeners.add(listener);
        listener(this.locked);
        return () => {
            this.lockListeners.delete(listener);
        };
    }

    /**
     * checks if the provided host is valid PB server
     * @param hostUrl
     */
    static async checkHostCapabilities(hostUrl: string): Promise<HostCapabilities> {
        const normalized = normalizeUrl(hostUrl.trim());
        if (!normalized) {
            throw new AppError('INVALID_INPUT', 'Self-host URL is required.');
        }

        let response: Response;
        try {
            response = await appHttp.fetch(
                buildUrl(normalized, '/api/capabilities'),
                { method: 'GET' },
                { timeout: 5_000, retry: { maxRetries: 1 } }
            );
        } catch (error) {
            throw new AppError('NETWORK_ERROR', 'Could not reach self-host server.', error);
        }

        if (!response.ok) {
            throw new AppError(
                'NETWORK_ERROR',
                `Self-host server capabilities check failed: ${response.status}`
            );
        }

        const capabilities = (await response.json()) as Partial<HostCapabilities>;
        if (capabilities.app !== 'keiai' || capabilities.protocol !== 1) {
            throw new AppError('INVALID_INPUT', 'This server is not a compatible KeiAI server.');
        }

        return capabilities as HostCapabilities;
    }

    static async enterSelfHost(hostUrl: string, options: MigrationOptions = {}): Promise<void> {
        const normalized = normalizeUrl(hostUrl.trim());
        await this.checkHostCapabilities(normalized);
        await this.migrateTo(normalized, options);
    }

    static async leaveSelfHost(options: MigrationOptions = {}): Promise<void> {
        await this.migrateTo(undefined, options);
    }

    private static lock(): void {
        this.locked = true;
        this.emitLockChange();
        SyncManager.stopAutoSync();
        AssetService.stopEviction();
    }

    private static unlock(): void {
        SyncManager.startAutoSync();
        AssetService.resumeEviction();
        this.locked = false;
        this.emitLockChange();
    }

    private static async migrateTo(
        nextSelfHostUrl: string | undefined,
        options: MigrationOptions
    ): Promise<void> {
        const { userId } = getActiveSession();

        this.emitProgress(options, {
            phase: 'validating',
            completed: 0,
            total: 0
        });

        this.lock();
        try {
            const remoteAssets = await this.localizeAssets(userId, options);

            this.emitProgress(options, {
                phase: 'committing',
                completed: remoteAssets.length,
                total: remoteAssets.length
            });

            await AssetService.markLocalBatch(remoteAssets);
            await UserService.updateSelfHostUrl(userId, nextSelfHostUrl);

            this.emitProgress(options, {
                phase: 'done',
                completed: remoteAssets.length,
                total: remoteAssets.length
            });
        } finally {
            this.unlock();
        }
    }

    private static async localizeAssets(
        userId: string,
        options: MigrationOptions
    ): Promise<AssetRegistryRecord[]> {
        const remoteAssets = await AssetService.getRemoteAssets({
            scopeType: 'user',
            scopeId: userId
        });
        const semaphore = new Semaphore(LOCALIZATION_CONCURRENCY);
        let completed = 0;
        let firstError: unknown = null;

        this.emitProgress(options, {
            phase: 'localizing',
            completed,
            total: remoteAssets.length
        });

        const results = await Promise.allSettled(
            remoteAssets.map((asset) =>
                semaphore.runExclusive(async () => {
                    const loaded = await AssetService.load(asset);
                    if (!loaded) {
                        throw new AppError('NOT_FOUND', `Asset ${asset.id} could not be localized`);
                    }

                    completed++;
                    this.emitProgress(options, {
                        phase: 'localizing',
                        completed,
                        total: remoteAssets.length,
                        currentItemId: asset.id
                    });
                })
            )
        );

        for (const result of results) {
            if (result.status === 'rejected') {
                firstError ??= result.reason;
            }
        }

        if (firstError) {
            logger.error('Failed to localize assets for migration', firstError);
            throw firstError;
        }

        return remoteAssets;
    }

    private static emitProgress(options: MigrationOptions, progress: MigrationProgress): void {
        options.onProgress?.({ ...progress });
    }

    private static emitLockChange(): void {
        for (const listener of this.lockListeners) {
            listener(this.locked);
        }
    }
}
