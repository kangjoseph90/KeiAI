/**
 * Async Stream Utilities — KeiAI
 *
 * Generic helpers for handling AsyncIterables.
 */

export interface StreamDebounceConfig {
    /** Minimum ms between yields. 0 = disabled (every chunk). Default: 0 */
    intervalMs?: number;
    /** Yield the first chunk immediately. Default: true */
    leadingEdge?: boolean;
}

/**
 * Wrap an async iterable with time-based throttle.
 * Yields at most once per `intervalMs`, always flushing the final state.
 *
 * Strategy:
 *   - Leading edge: first chunk yields immediately (UI responsiveness)
 *   - Throttle: skips chunks that arrive within intervalMs of last yield
 *   - Final flush: pending state always yields when source completes
 *   - intervalMs = 0 → passthrough (no throttle)
 */
export async function* debounceStream<T>(
    source: AsyncIterable<T>,
    config?: StreamDebounceConfig
): AsyncIterable<T> {
    const intervalMs = config?.intervalMs ?? 0;
    const leadingEdge = config?.leadingEdge ?? true;

    // Passthrough when disabled
    if (intervalMs <= 0) {
        yield* source;
        return;
    }

    let lastYieldTime = 0;
    let pending: T | null = null;
    let isFirst = true;

    for await (const state of source) {
        // Leading edge: yield first chunk immediately
        if (isFirst && leadingEdge) {
            isFirst = false;
            lastYieldTime = Date.now();
            yield state;
            continue;
        }
        isFirst = false;

        const elapsed = Date.now() - lastYieldTime;

        if (elapsed >= intervalMs) {
            lastYieldTime = Date.now();
            pending = null;
            yield state;
        } else {
            // Too soon — buffer latest, skip yield
            pending = state;
        }
    }

    // Final flush: always yield the last state if pending
    if (pending !== null) {
        yield pending;
    }
}
