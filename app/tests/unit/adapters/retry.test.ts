import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchWithRetry } from '$lib/adapters/http/retry';

const mockResponse = (ok: boolean, status: number) =>
    ({
        ok,
        status,
        text: async () => ''
    }) as Response;

describe('fetchWithRetry', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
    });

    it('should return response immediately on success', async () => {
        const mockFetch = vi.fn().mockResolvedValue(mockResponse(true, 200));

        const response = await fetchWithRetry(mockFetch);

        expect(response.ok).toBe(true);
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable status and eventually succeed', async () => {
        const mockFetch = vi
            .fn()
            .mockResolvedValueOnce(mockResponse(false, 503)) // Fail 1
            .mockResolvedValueOnce(mockResponse(false, 429)) // Fail 2
            .mockResolvedValueOnce(mockResponse(true, 200)); // Success

        const promise = fetchWithRetry(mockFetch, { maxRetries: 2, baseDelayMs: 100 });

        // Attempt 0 fails, wait for delay
        await vi.runAllTimersAsync();
        // Attempt 1 fails, wait for delay
        await vi.runAllTimersAsync();

        const response = await promise;

        expect(response.ok).toBe(true);
        expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should return last response even if status is retryable when all retries are exhausted', async () => {
        const mockFetch = vi.fn().mockResolvedValue(mockResponse(false, 500));

        const promise = fetchWithRetry(mockFetch, { maxRetries: 2, baseDelayMs: 100 });

        await vi.runAllTimersAsync(); // wait after 1st try
        await vi.runAllTimersAsync(); // wait after 2nd try

        const response = await promise;
        expect(response.status).toBe(500);
        expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should not retry on non-retryable status (e.g., 404)', async () => {
        const mockFetch = vi.fn().mockResolvedValue(mockResponse(false, 404));

        const response = await fetchWithRetry(mockFetch, { maxRetries: 3 });

        expect(response.status).toBe(404);
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should retry on thrown network errors', async () => {
        const mockFetch = vi
            .fn()
            .mockRejectedValueOnce(new Error('Network failure'))
            .mockResolvedValueOnce(mockResponse(true, 200));

        const promise = fetchWithRetry(mockFetch, { maxRetries: 1, baseDelayMs: 100 });

        await vi.runAllTimersAsync();

        const response = await promise;
        expect(response.ok).toBe(true);
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should throw AbortError immediately without retry', async () => {
        const abortError = new DOMException('Aborted', 'AbortError');
        const mockFetch = vi.fn().mockRejectedValue(abortError);

        const promise = fetchWithRetry(mockFetch, { maxRetries: 5 });

        await expect(promise).rejects.toThrow('Aborted');
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should increase delay using exponential backoff', async () => {
        const mockFetch = vi.fn().mockResolvedValue(mockResponse(false, 500));
        const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

        const maxRetries = 3;
        const baseDelayMs = 1000;

        const promise = fetchWithRetry(mockFetch, { maxRetries, baseDelayMs });

        // Wait through all retries
        for (let i = 0; i < maxRetries; i++) {
            await vi.runAllTimersAsync();
        }

        const response = await promise;
        expect(response.status).toBe(500);

        // check delay times (approximately, due to jitter)
        const calls = setTimeoutSpy.mock.calls;
        expect(calls.length).toBe(3);

        const delay1 = calls[0][1] as number;
        const delay2 = calls[1][1] as number;
        const delay3 = calls[2][1] as number;

        expect(delay1).toBeGreaterThanOrEqual(750);
        expect(delay1).toBeLessThanOrEqual(1250);

        expect(delay2).toBeGreaterThanOrEqual(1500);
        expect(delay2).toBeLessThanOrEqual(2500);

        expect(delay3).toBeGreaterThanOrEqual(3000);
        expect(delay3).toBeLessThanOrEqual(5000);
    });
});
