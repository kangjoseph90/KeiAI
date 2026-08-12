let activeOperations = 0;
let mutationGate: Promise<void> | null = null;
let releaseMutationGate: (() => void) | null = null;
let releaseIdleWait: (() => void) | null = null;
let mutationTail = Promise.resolve();

export async function acquireInferenceLease(signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted();
    while (mutationGate) await waitForGate(mutationGate, signal);
    signal?.throwIfAborted();
    activeOperations += 1;
    let released = false;
    return () => {
        if (released) return;
        released = true;
        activeOperations -= 1;
        if (activeOperations === 0) {
            releaseIdleWait?.();
            releaseIdleWait = null;
        }
    };
}

async function waitForGate(gate: Promise<void>, signal?: AbortSignal): Promise<void> {
    if (!signal) return gate;
    await new Promise<void>((resolve, reject) => {
        const cleanup = (): void => signal.removeEventListener('abort', onAbort);
        const onAbort = (): void => {
            cleanup();
            reject(signal.reason);
        };
        signal.addEventListener('abort', onAbort, { once: true });
        gate.then(
            () => {
                cleanup();
                resolve();
            },
            (error: unknown) => {
                cleanup();
                reject(error);
            }
        );
    });
}

export async function runInferenceCacheMutation<T>(action: () => Promise<T>): Promise<T> {
    const previous = mutationTail;
    let releaseTail: () => void = () => undefined;
    mutationTail = new Promise<void>((resolve) => (releaseTail = resolve));
    await previous;

    mutationGate = new Promise<void>((resolve) => (releaseMutationGate = resolve));
    try {
        if (activeOperations > 0) {
            await new Promise<void>((resolve) => (releaseIdleWait = resolve));
        }
        return await action();
    } finally {
        const releaseGate = releaseMutationGate;
        releaseMutationGate = null;
        mutationGate = null;
        releaseGate?.();
        releaseTail();
    }
}
