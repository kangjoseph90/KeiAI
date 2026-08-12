import { appHttp } from '$lib/adapters/http';
import { pb } from '$lib/adapters/pb';
import type {
    ProxyConnectionSettings,
    ServerConnectionSettings,
    UserConnectionSettings
} from '$lib/types/connections';
import { AppError } from '$lib/types/errors';
import { buildUrl, normalizeUrl } from '$lib/utils/url';
import { Semaphore } from '$lib/utils/semaphore';
import { AssetService, type AssetRegistryRecord } from '../asset';
import { getActiveSession } from '../session';
import { SyncManager } from '../sync';
import { UserService, type User } from '../user';
import { applyUserConnectionRuntime, resolveProxyRuntimeConfig, resolveServerUrl } from './runtime';
import type { ConnectionChangeOptions, ConnectionChangeProgress, ConnectionSpec } from './types';
import { AuthService } from '../auth';

const LOCALIZATION_CONCURRENCY = 4;
type LockListener = (locked: boolean) => void;

function normalizeCustomUrl(rawUrl: string | undefined, label: string): string {
    const value = rawUrl?.trim() ?? '';
    if (!value) throw new AppError('INVALID_INPUT', `${label} URL is required.`);

    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch (error) {
        throw new AppError('INVALID_INPUT', `${label} URL is invalid.`, error);
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new AppError('INVALID_INPUT', `${label} URL must use HTTP or HTTPS.`);
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new AppError(
            'INVALID_INPUT',
            `${label} URL cannot contain credentials, query parameters, or a fragment.`
        );
    }

    return normalizeUrl(parsed.toString());
}

function normalizeServerSettings(settings: ServerConnectionSettings): ServerConnectionSettings {
    return settings.mode === 'custom'
        ? { ...settings, customUrl: normalizeCustomUrl(settings.customUrl, 'Custom server') }
        : { ...settings };
}

function normalizeProxySettings(settings: ProxyConnectionSettings): ProxyConnectionSettings {
    return settings.mode === 'custom'
        ? { ...settings, customUrl: normalizeCustomUrl(settings.customUrl, 'Custom proxy') }
        : { ...settings };
}

export class ConnectionService {
    private static serverTransitionLocked = false;
    private static readonly lockListeners = new Set<LockListener>();

    static isServerTransitionLocked(): boolean {
        return this.serverTransitionLocked;
    }

    static onServerTransitionLockChange(listener: LockListener): () => void {
        this.lockListeners.add(listener);
        listener(this.serverTransitionLocked);
        return () => this.lockListeners.delete(listener);
    }

    static async checkServerSpec(baseUrl: string): Promise<ConnectionSpec> {
        const response = await this.fetchSpec(buildUrl(baseUrl, '/api/spec'), 'server');
        const spec = (await response.json()) as Partial<ConnectionSpec>;
        if (spec.app !== 'keiai' || spec.protocol !== 1) {
            throw new AppError('INVALID_INPUT', 'This is not a compatible KeiAI server.');
        }
        return spec as ConnectionSpec;
    }

    static async checkProxySpec(baseUrl: string): Promise<ConnectionSpec> {
        const response = await this.fetchSpec(buildUrl(baseUrl, '/spec'), 'proxy');
        const spec = (await response.json()) as Partial<ConnectionSpec>;
        if (spec.app !== 'keiai-proxy' || spec.protocol !== 1) {
            throw new AppError('INVALID_INPUT', 'This is not a compatible KeiAI proxy.');
        }
        return spec as ConnectionSpec;
    }

    static async changeServerConnection(
        requested: ServerConnectionSettings,
        options: ConnectionChangeOptions = {}
    ): Promise<User> {
        const { userId } = getActiveSession();
        if (this.serverTransitionLocked) {
            throw new AppError('INVALID_INPUT', 'A server connection change is already running.');
        }

        const previousUser = await UserService.getUser(userId);
        const nextServer = normalizeServerSettings(requested);
        const previousUrl = resolveServerUrl(previousUser.connections.server);
        const nextUrl = resolveServerUrl(nextServer);

        this.emitProgress(options, { phase: 'validating', completed: 0, total: 0 });
        if (nextServer.mode === 'custom') {
            await this.checkServerSpec(nextUrl);
        }

        const nextConnections: UserConnectionSettings = {
            ...previousUser.connections,
            server: nextServer
        };

        if (normalizeUrl(previousUrl) === normalizeUrl(nextUrl)) {
            const updated = await UserService.updateConnections(userId, nextConnections);
            applyUserConnectionRuntime(updated.connections);
            this.emitProgress(options, { phase: 'done', completed: 0, total: 0 });
            return updated;
        }

        this.lockServerTransition();
        let transitionRecovered = true;
        let remoteAssets: AssetRegistryRecord[] = [];
        let assetCommitStarted = false;
        let settingsCommitted = false;
        try {
            await AuthService.persistPbAuth(userId, previousUrl);
            remoteAssets = await this.localizeAssets(userId, options);
            this.emitProgress(options, {
                phase: 'committing',
                completed: remoteAssets.length,
                total: remoteAssets.length
            });

            assetCommitStarted = true;
            await AssetService.markLocalBatch(remoteAssets);
            const updated = await UserService.updateConnections(userId, nextConnections);
            settingsCommitted = true;
            applyUserConnectionRuntime(updated.connections);
            await AuthService.restorePbAuth(userId, nextUrl);

            this.emitProgress(options, {
                phase: 'done',
                completed: remoteAssets.length,
                total: remoteAssets.length
            });
            return updated;
        } catch (error) {
            const rollbackErrors: unknown[] = [];
            if (settingsCommitted) {
                try {
                    await UserService.updateConnections(userId, previousUser.connections);
                } catch (rollbackError) {
                    rollbackErrors.push(rollbackError);
                }
                try {
                    applyUserConnectionRuntime(previousUser.connections);
                    await AuthService.restorePbAuth(userId, previousUrl);
                } catch (rollbackError) {
                    rollbackErrors.push(rollbackError);
                }
            }
            if (assetCommitStarted) {
                try {
                    await AssetService.markRemoteBatch(remoteAssets);
                } catch (rollbackError) {
                    rollbackErrors.push(rollbackError);
                }
            }
            if (rollbackErrors.length > 0) {
                transitionRecovered = false;
                throw new AppError(
                    'STORAGE_ERROR',
                    'Server connection change failed and could not be fully rolled back. Restart the app before retrying.',
                    { error, rollbackErrors }
                );
            }
            throw error;
        } finally {
            if (transitionRecovered) this.unlockServerTransition();
        }
    }

    static async changeProxyConnection(requested: ProxyConnectionSettings): Promise<User> {
        const { userId } = getActiveSession();
        const previousUser = await UserService.getUser(userId);
        const nextProxy = normalizeProxySettings(requested);
        const nextRuntime = resolveProxyRuntimeConfig(nextProxy);

        if (nextProxy.mode === 'custom' && nextRuntime.mode === 'proxy') {
            await this.checkProxySpec(nextRuntime.baseUrl);
        }

        const nextConnections: UserConnectionSettings = {
            ...previousUser.connections,
            proxy: nextProxy
        };
        const updated = await UserService.updateConnections(userId, nextConnections);

        try {
            appHttp.configureProxy(nextRuntime);
            return updated;
        } catch (error) {
            const rollbackErrors: unknown[] = [];
            try {
                await UserService.updateConnections(userId, previousUser.connections);
            } catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
            try {
                applyUserConnectionRuntime(previousUser.connections);
            } catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
            if (rollbackErrors.length > 0) {
                throw new AppError(
                    'STORAGE_ERROR',
                    'Proxy connection change failed and could not be fully rolled back. Restart the app before retrying.',
                    { error, rollbackErrors }
                );
            }
            throw error;
        }
    }

    private static async fetchSpec(url: string, label: string): Promise<Response> {
        let response: Response;
        try {
            response = await appHttp.fetch(
                url,
                { method: 'GET' },
                { timeout: 5_000, retry: { maxRetries: 1 } }
            );
        } catch (error) {
            throw new AppError('NETWORK_ERROR', `Could not reach the ${label}.`, error);
        }
        if (!response.ok) {
            throw new AppError(
                'NETWORK_ERROR',
                `${label[0].toUpperCase()}${label.slice(1)} spec check failed: ${response.status}`
            );
        }
        return response;
    }

    private static async localizeAssets(
        userId: string,
        options: ConnectionChangeOptions
    ): Promise<AssetRegistryRecord[]> {
        const remoteAssets = await AssetService.getRemoteAssets({
            scopeType: 'user',
            scopeId: userId
        });
        const semaphore = new Semaphore(LOCALIZATION_CONCURRENCY);
        let completed = 0;

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
                        throw new AppError(
                            'NOT_FOUND',
                            `Asset ${asset.id} could not be localized.`
                        );
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
        const failed = results.find((result) => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
        return remoteAssets;
    }

    private static lockServerTransition(): void {
        this.serverTransitionLocked = true;
        SyncManager.stopAutoSync();
        AuthService.stopAutoRefresh();
        AssetService.stopEviction();
        this.emitLockChange();
    }

    private static unlockServerTransition(): void {
        SyncManager.startAutoSync();
        AuthService.startAutoRefresh();
        AssetService.resumeEviction();
        this.serverTransitionLocked = false;
        this.emitLockChange();
    }

    private static emitProgress(
        options: ConnectionChangeOptions,
        progress: ConnectionChangeProgress
    ): void {
        options.onProgress?.({ ...progress });
    }

    private static emitLockChange(): void {
        for (const listener of this.lockListeners) listener(this.serverTransitionLocked);
    }
}
