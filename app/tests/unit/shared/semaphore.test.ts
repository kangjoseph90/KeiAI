import { describe, it, expect } from 'vitest';
import { Semaphore } from '$lib/utils/semaphore';

describe('Semaphore', () => {
    describe('constructor', () => {
        it('rejects non-positive counts', () => {
            expect(() => new Semaphore(0)).toThrow('Semaphore count must be a positive integer');
            expect(() => new Semaphore(-1)).toThrow('Semaphore count must be a positive integer');
            expect(() => new Semaphore(1.5)).toThrow('Semaphore count must be a positive integer');
        });
    });

    describe('runExclusive', () => {
        it('executes callback and returns its value', async () => {
            const semaphore = new Semaphore(2);
            const result = await semaphore.runExclusive(() => Promise.resolve(42));
            expect(result).toBe(42);
        });

        it('runs up to count callbacks concurrently', async () => {
            const semaphore = new Semaphore(2);
            let active = 0;
            let maxActive = 0;

            await Promise.all(
                Array.from({ length: 5 }, () =>
                    semaphore.runExclusive(async () => {
                        active++;
                        maxActive = Math.max(maxActive, active);
                        await delay(10);
                        active--;
                    })
                )
            );

            expect(maxActive).toBe(2);
        });

        it('starts queued calls in FIFO order as permits become available', async () => {
            const semaphore = new Semaphore(2);
            const order: number[] = [];

            const p1 = semaphore.runExclusive(async () => {
                order.push(1);
                await delay(20);
            });
            const p2 = semaphore.runExclusive(async () => {
                order.push(2);
                await delay(20);
            });
            const p3 = semaphore.runExclusive(async () => {
                order.push(3);
            });
            const p4 = semaphore.runExclusive(async () => {
                order.push(4);
            });

            await Promise.all([p1, p2, p3, p4]);
            expect(order).toEqual([1, 2, 3, 4]);
        });

        it('releases permit after error so next call proceeds', async () => {
            const semaphore = new Semaphore(1);

            await expect(
                semaphore.runExclusive(() => Promise.reject(new Error('boom')))
            ).rejects.toThrow('boom');

            const result = await semaphore.runExclusive(() => Promise.resolve('ok'));
            expect(result).toBe('ok');
        });

        it('returns undefined for void callbacks', async () => {
            const semaphore = new Semaphore(2);
            const result = await semaphore.runExclusive(async () => {
                // no return
            });
            expect(result).toBeUndefined();
        });

        it('handles 50 concurrent calls without dropping any', async () => {
            const semaphore = new Semaphore(5);
            let counter = 0;

            await Promise.all(
                Array.from({ length: 50 }, () =>
                    semaphore.runExclusive(async () => {
                        counter++;
                    })
                )
            );

            expect(counter).toBe(50);
        });
    });

    describe('acquire', () => {
        it('returns release functions that unlock queued calls', async () => {
            const semaphore = new Semaphore(2);
            const release1 = await semaphore.acquire();
            const release2 = await semaphore.acquire();
            let executed = false;

            const p3 = semaphore.runExclusive(async () => {
                executed = true;
            });

            await delay(10);
            expect(executed).toBe(false);

            release1();

            await p3;
            expect(executed).toBe(true);

            release2();
        });
    });
});

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
