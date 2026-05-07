/**
 * Async Stream Utilities — KeiAI
 *
 * Generic helpers for handling AsyncIterables.
 */

/**
 * Wrap an async iterable with time-based throttle.
 * Yields at most once per 50ms, always flushing the final state.
 *
 * Strategy:
 *   - Leading edge: first chunk yields immediately (UI responsiveness)
 *   - Throttle: skips chunks that arrive within 50ms of last yield
 *   - Final flush: pending state always yields when source completes
 */
export async function* debounceStream<T>(source: AsyncIterable<T>): AsyncIterable<T> {
    const intervalMs = 50;
    const leadingEdge = true;

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
