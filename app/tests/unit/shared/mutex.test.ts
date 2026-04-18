import { describe, it, expect } from 'vitest';
import { Mutex } from '$lib/utils/mutex';

describe('Mutex', () => {
	describe('runExclusive', () => {
		it('executes callback and returns its value', async () => {
			const mutex = new Mutex();
			const result = await mutex.runExclusive(() => Promise.resolve(42));
			expect(result).toBe(42);
		});

		it('serializes concurrent calls in FIFO order', async () => {
			const mutex = new Mutex();
			const order: number[] = [];

			const p1 = mutex.runExclusive(async () => {
				order.push(1);
				await delay(10);
			});
			const p2 = mutex.runExclusive(async () => {
				order.push(2);
				await delay(10);
			});
			const p3 = mutex.runExclusive(async () => {
				order.push(3);
			});

			await Promise.all([p1, p2, p3]);
			expect(order).toEqual([1, 2, 3]);
		});

		it('releases lock after error so next call proceeds', async () => {
			const mutex = new Mutex();

			await expect(mutex.runExclusive(() => Promise.reject(new Error('boom')))).rejects.toThrow(
				'boom'
			);

			// Lock should be released — next call must succeed
			const result = await mutex.runExclusive(() => Promise.resolve('ok'));
			expect(result).toBe('ok');
		});

		it('returns undefined for void callbacks', async () => {
			const mutex = new Mutex();
			const result = await mutex.runExclusive(async () => {
				// no return
			});
			expect(result).toBeUndefined();
		});

		it('handles 50 concurrent calls without dropping any', async () => {
			const mutex = new Mutex();
			let counter = 0;

			await Promise.all(
				Array.from({ length: 50 }, () =>
					mutex.runExclusive(async () => {
						counter++;
					})
				)
			);

			expect(counter).toBe(50);
		});
	});

	describe('acquire', () => {
		it('returns a release function that unlocks the mutex', async () => {
			const mutex = new Mutex();
			let executed = false;

			const release = await mutex.acquire();

			// While locked, queue a second call
			const p2 = mutex.runExclusive(async () => {
				executed = true;
			});

			// Not yet executed — lock is held
			await delay(10);
			expect(executed).toBe(false);

			// Release the lock
			release();

			await p2;
			expect(executed).toBe(true);
		});
	});
});

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
