import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MonotonicClock, type IClockStorage } from '$lib/utils/clock';

/**
 * Mock storage for MonotonicClock
 */
class MockStorage implements IClockStorage {
    data = new Map<string, string>();
    async get(key: string) {
        return this.data.get(key) || null;
    }
    async set(key: string, val: string) {
        this.data.set(key, val);
    }
    async remove(key: string) {
        this.data.delete(key);
    }
}

describe('MonotonicClock', () => {
    let storage: MockStorage;
    let clock: MonotonicClock;

    beforeEach(() => {
        storage = new MockStorage();
        clock = new MonotonicClock();
        vi.useFakeTimers();
    });

    it('should return Date.now() on first call when initialized with current time', async () => {
        const now = 1000000;
        vi.setSystemTime(now);
        await clock.init(storage);

        expect(clock.now()).toBe(now);
    });

    it('should be strictly monotonic even if Date.now() does not change', async () => {
        const now = 1000000;
        vi.setSystemTime(now);
        await clock.init(storage);

        const t1 = clock.now();
        const t2 = clock.now();
        const t3 = clock.now();

        expect(t1).toBe(now);
        expect(t2).toBe(now + 1);
        expect(t3).toBe(now + 2);
    });

    it('should restore floor from storage during init', async () => {
        const storedFloor = 2000000;
        storage.data.set('system:clock_floor', storedFloor.toString());

        const now = 1000000; // Wall clock is behind stored floor
        vi.setSystemTime(now);

        await clock.init(storage);

        expect(clock.now()).toBe(storedFloor + 1);
    });

    it('should discard floor if it is too far in the future (poisoned)', async () => {
        const now = 1000000;
        const poisonedFloor = now + 25 * 60 * 60 * 1000; // 25 hours ahead (> 24h limit)
        storage.data.set('system:clock_floor', poisonedFloor.toString());

        vi.setSystemTime(now);
        await clock.init(storage);

        // Should have reset to 'now'
        expect(clock.now()).toBe(now);
        expect(storage.data.get('system:clock_floor')).toBeUndefined();
    });

    it('should handle multiple concurrent init calls safely', async () => {
        const p1 = clock.init(storage);
        const p2 = clock.init(storage);

        await Promise.all([p1, p2]);
        expect(clock.isInitialized).toBe(true);
    });

    it('should trigger persistence on visibilitychange (mocking browser event)', async () => {
        await clock.init(storage);
        const t1 = clock.now();

        // Mock visibilityState and dispatch event
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true });
        document.dispatchEvent(new Event('visibilitychange'));

        expect(storage.data.get('system:clock_floor')).toBe(t1.toString());
    });

    it('should recover if wall clock jumps backward within a session', async () => {
        const t1_now = 5000;
        vi.setSystemTime(t1_now);
        await clock.init(storage);

        const t1 = clock.now(); // 5000

        // System clock jumps back to 4000
        vi.setSystemTime(4000);

        const t2 = clock.now();
        expect(t2).toBe(t1 + 1); // Should still be 5001
    });
});
