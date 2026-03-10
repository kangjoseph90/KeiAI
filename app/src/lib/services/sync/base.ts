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

type SyncStatusListener<TStatus extends SyncStatus> = (status: TStatus) => void;

/**
 * Shared state machine for sync engines.
 *
 * - trigger() is deduplicated while a run is in flight
 * - extra triggers during a run mark the engine dirty and schedule one more pass
 * - status listeners allow the store layer to render progress without importing stores here
 */
export abstract class BaseSyncEngine<TStatus extends SyncStatus = SyncStatus> {
	private runPromise: Promise<void> | null = null;
	private rerunRequested = false;
	private readonly listeners = new Set<SyncStatusListener<TStatus>>();
	private status: TStatus;

	protected constructor(initialStatus?: Partial<TStatus>) {
		this.status = {
			state: 'idle',
			...initialStatus
		} as TStatus;
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

	stop(): void {
		this.rerunRequested = false;
		this.updateStatus({
			state: 'idle',
			progress: undefined
		} as Partial<TStatus>);
	}

	protected updateStatus(patch: Partial<TStatus>): void {
		this.status = {
			...this.status,
			...patch
		};
		this.emitStatus();
	}

	protected abstract performSync(): Promise<void>;

	protected isQuotaError(_error: unknown): boolean {
		return false;
	}

	protected isAuthError(_error: unknown): boolean {
		return false;
	}

	protected isAbortError(error: unknown): boolean {
		return error instanceof DOMException
			? error.name === 'AbortError'
			: error instanceof Error && error.name === 'AbortError';
	}

	protected normalizeTimestamp(primary: unknown, fallback: unknown): number {
		if (typeof primary === 'number') return primary;

		if (typeof primary === 'string') {
			const parsed = Number(primary);
			if (!Number.isNaN(parsed)) return parsed;
			const asDate = new Date(primary).getTime();
			if (!Number.isNaN(asDate)) return asDate;
		}

		if (typeof fallback === 'string') {
			const asDate = new Date(fallback).getTime();
			if (!Number.isNaN(asDate)) return asDate;
		}

		return 0;
	}

	private async drainQueue(): Promise<void> {
		while (this.rerunRequested) {
			this.rerunRequested = false;
			this.updateStatus({ state: 'syncing' } as Partial<TStatus>);

			try {
				await this.performSync();
				if (!this.rerunRequested) {
					this.updateStatus({
						state: 'idle',
						progress: undefined
					} as Partial<TStatus>);
				}
			} catch (error) {
				if (this.isAbortError(error)) {
					this.updateStatus({
						state: 'idle',
						progress: undefined
					} as Partial<TStatus>);
					continue;
				}

				this.updateStatus({
					state: this.toErrorState(error),
					progress: undefined
				} as Partial<TStatus>);
				break;
			}
		}
	}

	private toErrorState(error: unknown): SyncState {
		if (this.isQuotaError(error)) return 'quota_error';
		if (this.isAuthError(error)) return 'auth_error';
		return 'network_error';
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
}
