/**
 * MonotonicClock — Monotonic Timestamp Authority
 *
 * Replaces bare `Date.now()` calls in all domain write paths to guarantee
 * that timestamps never go backward within a single process.
 */

import { createLogger } from '$lib/adapters/logger';

const CLOCK_FLOOR_KEY = 'system:clock_floor';
const MAX_FUTURE_DRIFT = 24 * 60 * 60 * 1000; // 24 hours

const logger = createLogger('utils:clock');

export interface IClockStorage {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
}

export class MonotonicClock {
    private floor = 0;
    private initialized = false;
    private initPromise: Promise<void> | null = null;
    private storage: IClockStorage | null = null;

    /** Returns true if the clock has finished restoring its state from storage. */
    get isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Restore the monotonic floor from persistent storage.
     * Must be called once during app startup with a storage adapter (e.g., appKV).
     */
    async init(storage: IClockStorage): Promise<void> {
        if (this.initialized) return;
        if (this.initPromise) return this.initPromise;

        this.storage = storage;

        this.initPromise = (async () => {
            try {
                const stored = await this.storage!.get(CLOCK_FLOOR_KEY);
                if (stored) {
                    const parsed = Number.parseInt(stored, 10);
                    if (!Number.isNaN(parsed) && parsed > 0) {
                        if (parsed > Date.now() + MAX_FUTURE_DRIFT) {
                            logger.error(
                                `Persisted clock floor is ${parsed} — far in the future. ` +
                                    'Discarding poisoned floor and resetting to wall clock.'
                            );
                            await this.storage!.remove(CLOCK_FLOOR_KEY);
                        } else {
                            this.floor = parsed;
                        }
                    }
                }
            } catch (err) {
                logger.warn(
                    'Failed to restore clock floor from storage; starting from Date.now()',
                    err
                );
            }

            this.initialized = true;
            this.installFlushHooks();
        })();

        return this.initPromise;
    }

    /**
     * Returns a monotonically increasing millisecond timestamp.
     */
    now(): number {
        if (!this.initialized) {
            // If called before init, we just use Date.now() but can't guarantee monotonicity across restarts.
            // Under normal operation, App.svelte ensures init() is called first.
            const wall = Date.now();
            this.floor = Math.max(wall, this.floor + 1);
            return this.floor;
        }

        const wall = Date.now();

        if (this.floor > wall + MAX_FUTURE_DRIFT) {
            logger.error(
                `Clock floor ${this.floor} is too far ahead of wall clock ${wall}. ` +
                    'Resetting to wall clock to recover from future timestamp poisoning.'
            );
            this.floor = wall;
            return this.floor;
        }

        this.floor = Math.max(wall, this.floor + 1);
        return this.floor;
    }

    /**
     * Observe a timestamp produced by another replica.
     *
     * The next local now() call will be greater than the observed value, while
     * preserving the existing numeric timestamp format.
     */
    observe(timestamp: number): void {
        if (!Number.isFinite(timestamp) || timestamp <= 0) return;

        const wall = Date.now();
        if (timestamp > wall + MAX_FUTURE_DRIFT) {
            logger.warn(
                `Observed timestamp ${timestamp} is too far ahead of wall clock ${wall}. ` +
                    'Ignoring it to avoid future timestamp poisoning.'
            );
            return;
        }

        this.floor = Math.max(this.floor, timestamp);
    }

    private flushFloor(): void {
        if (this.storage && this.floor > 0) {
            void this.storage.set(CLOCK_FLOOR_KEY, this.floor.toString());
        }
    }

    private installFlushHooks(): void {
        if (typeof window === 'undefined') return;

        window.addEventListener('pagehide', () => this.flushFloor());
        window.addEventListener('beforeunload', () => this.flushFloor());
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') this.flushFloor();
        });
    }
}

export const clock = new MonotonicClock();
