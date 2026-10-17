import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { toErrorState, isAbortError } from './utils';

export type SyncState = 'idle' | 'syncing' | 'network_error' | 'quota_error' | 'auth_error';

export interface SyncProgress {
    completed: number;
    total: number;
    currentItemId?: string;
}

export interface SyncStatus {
    state: SyncState;
    progress?: SyncProgress;
}

export interface BufferedRecordWrite<TBucket extends string = string> {
    bucket: TBucket;
    id: string;
}

const DEFAULT_WRITE_FLUSH_INTERVAL_MS = 3_000;

type SyncStatusListener<TStatus extends SyncStatus> = (status: TStatus) => void;

/**
 * Shared lifecycle for local-first record sync engines.
 *
 * It owns full-sync triggering, status/progress tracking, and coalescing local
 * write events into a latest-record batch flush. Payload shape, encryption,
 * scope rules, and remote collections stay in subclasses.
 */
export abstract class BaseRecordSyncEngine<
    TWriteEvent,
    TBucket extends string = string,
    TStatus extends SyncStatus = SyncStatus
> {
    private runPromise: Promise<void> | null = null;
    private rerunRequested = false;
    private readonly listeners = new Set<SyncStatusListener<TStatus>>();
    private status: TStatus;

    private readonly bufferedWrites = new Map<string, BufferedRecordWrite<TBucket>>();
    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    private flushingWrites = false;
    private fullSyncRunning = false;

    protected constructor(
        initialStatus?: DeepPartial<TStatus>,
        private readonly writeFlushIntervalMs = DEFAULT_WRITE_FLUSH_INTERVAL_MS
    ) {
        this.status = deepMerge(
            {
                state: 'idle'
            } as TStatus,
            initialStatus as Record<string, unknown>
        );
    }

    getState(): TStatus {
        return this.cloneStatus(this.status);
    }

    subscribeStatus(listener: SyncStatusListener<TStatus>): () => void {
        this.listeners.add(listener);
        listener(this.getState());

        return () => {
            this.listeners.delete(listener);
        };
    }

    async trigger(): Promise<void> {
        this.rerunRequested = true;

        if (this.runPromise) {
            return this.runPromise;
        }

        this.runPromise = this.drainQueue().finally(() => {
            this.runPromise = null;
        });

        return this.runPromise;
    }

    handleLocalWrite(event: TWriteEvent): void {
        const writes = this.getBufferedWrites(event);
        if (writes.length === 0) return;

        for (const write of writes) {
            this.bufferedWrites.set(this.writeKey(write), write);
        }

        this.scheduleWriteFlush();
    }

    stop(): void {
        this.rerunRequested = false;
        this.clearFlushTimer();
        this.bufferedWrites.clear();
        this.updateStatus({
            state: 'idle',
            progress: undefined
        } as DeepPartial<TStatus>);
    }

    protected updateStatus(patch: DeepPartial<TStatus>): void {
        this.status = deepMerge(this.status, patch as Record<string, unknown>);
        this.emitStatus();
    }

    protected abstract syncRecords(): Promise<void>;

    protected abstract getBufferedWrites(event: TWriteEvent): BufferedRecordWrite<TBucket>[];

    protected abstract pushBufferedWrites(writes: BufferedRecordWrite<TBucket>[]): Promise<void>;

    protected async performSync(): Promise<void> {
        this.fullSyncRunning = true;
        try {
            await this.syncRecords();
        } finally {
            this.fullSyncRunning = false;
            void this.flushBufferedWrites();
        }
    }

    private async drainQueue(): Promise<void> {
        while (this.rerunRequested) {
            this.rerunRequested = false;
            this.updateStatus({ state: 'syncing' } as DeepPartial<TStatus>);

            try {
                await this.performSync();
                if (!this.rerunRequested) {
                    this.updateStatus({
                        state: 'idle',
                        progress: undefined
                    } as DeepPartial<TStatus>);
                }
            } catch (error) {
                if (isAbortError(error)) {
                    this.updateStatus({
                        state: 'idle',
                        progress: undefined
                    } as DeepPartial<TStatus>);
                    continue;
                }

                this.updateStatus({
                    state: toErrorState(error),
                    progress: undefined
                } as DeepPartial<TStatus>);
                break;
            }
        }
    }

    private emitStatus(): void {
        const snapshot = this.getState();
        for (const listener of this.listeners) {
            listener(snapshot);
        }
    }

    private cloneStatus(status: TStatus): TStatus {
        return {
            ...status,
            progress: status.progress ? { ...status.progress } : undefined
        } as TStatus;
    }

    private scheduleWriteFlush(): void {
        if (this.flushTimer || this.fullSyncRunning || this.flushingWrites) return;

        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            void this.flushBufferedWrites();
        }, this.writeFlushIntervalMs);
    }

    private async flushBufferedWrites(): Promise<void> {
        if (this.fullSyncRunning || this.flushingWrites) return;
        if (this.bufferedWrites.size === 0) return;

        const writes = [...this.bufferedWrites.values()];
        this.bufferedWrites.clear();
        this.flushingWrites = true;
        this.updateStatus({ state: 'syncing' } as DeepPartial<TStatus>);

        try {
            await this.pushBufferedWrites(writes);
            this.updateStatus({ state: 'idle', progress: undefined } as DeepPartial<TStatus>);
        } catch (error) {
            this.updateStatus({
                state: toErrorState(error),
                progress: undefined
            } as DeepPartial<TStatus>);
        } finally {
            this.flushingWrites = false;
            if (this.bufferedWrites.size > 0) {
                this.scheduleWriteFlush();
            }
        }
    }

    private clearFlushTimer(): void {
        if (!this.flushTimer) return;
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
    }

    private writeKey(write: BufferedRecordWrite<TBucket>): string {
        return `${write.bucket}\u0000${write.id}`;
    }
}
