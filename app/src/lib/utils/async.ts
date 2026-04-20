/**
 * Async Utilities — KeiAI
 *
 * Common async helpers shared across the application.
 */

/** Promise-based sleep. Resolves after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Abortable sleep — rejects with AbortError if `signal` fires before `ms` elapses.
 */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener(
            'abort',
            () => {
                clearTimeout(timer);
                reject(new DOMException('AbortError', 'AbortError'));
            },
            { once: true }
        );
    });
}
