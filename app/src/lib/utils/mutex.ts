export class Mutex {
    #queue: { resolve: (release: () => void) => void }[] = [];
    #locked = false;

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
        if (this.#locked) return;
        const next = this.#queue.shift();
        if (!next) return;
        this.#locked = true;
        next.resolve(() => {
            this.#locked = false;
            this.#dispatch();
        });
    }
}
