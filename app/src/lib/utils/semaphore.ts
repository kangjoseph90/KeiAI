export class Semaphore {
    #queue: { resolve: (release: () => void) => void }[] = [];
    #available: number;

    constructor(count: number) {
        if (!Number.isInteger(count) || count < 1) {
            throw new RangeError('Semaphore count must be a positive integer');
        }

        this.#available = count;
    }

    acquire(): Promise<() => void> {
        return new Promise((resolve) => {
            this.#queue.push({ resolve });
            this.#dispatch();
        });
    }

    async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
        const release = await this.acquire();
        try {
            return await fn();
        } finally {
            release();
        }
    }

    #dispatch(): void {
        if (this.#available < 1) return;
        const next = this.#queue.shift();
        if (!next) return;

        this.#available--;
        next.resolve(() => {
            this.#available++;
            this.#dispatch();
        });
    }
}
