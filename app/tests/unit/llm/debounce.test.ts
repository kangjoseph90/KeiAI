/**
 * debounceStream Tests — KeiAI
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { debounceStream } from '$lib/llm/providers/debounce';
import type { StreamContent } from '$lib/llm/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function snap(content: string): StreamContent {
	return { content };
}

async function collect(iter: AsyncIterable<StreamContent>): Promise<StreamContent[]> {
	const results: StreamContent[] = [];
	for await (const item of iter) {
		results.push(item);
	}
	return results;
}

async function* fromArray(items: StreamContent[]): AsyncIterable<StreamContent> {
	for (const item of items) {
		yield item;
	}
}

async function* fromArrayWithDelay(
	items: StreamContent[],
	delayMs: number
): AsyncIterable<StreamContent> {
	for (const item of items) {
		await new Promise((r) => setTimeout(r, delayMs));
		yield item;
	}
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('debounceStream', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	describe('passthrough (intervalMs = 0)', () => {
		it('should yield every chunk when intervalMs is 0', async () => {
			const source = [snap('a'), snap('ab'), snap('abc')];
			const results = await collect(debounceStream(fromArray(source), { intervalMs: 0 }));
			expect(results).toEqual(source);
		});

		it('should yield every chunk when config is undefined', async () => {
			const source = [snap('a'), snap('ab'), snap('abc')];
			const results = await collect(debounceStream(fromArray(source)));
			expect(results).toEqual(source);
		});

		it('should handle empty stream', async () => {
			const results = await collect(debounceStream(fromArray([]), { intervalMs: 0 }));
			expect(results).toEqual([]);
		});
	});

	describe('leading edge', () => {
		it('should yield first chunk immediately when leadingEdge is true', async () => {
			const source = [snap('a'), snap('ab'), snap('abc')];
			const results = await collect(
				debounceStream(fromArray(source), { intervalMs: 1000, leadingEdge: true })
			);
			expect(results[0]).toEqual(snap('a'));
		});

		it('should not yield first chunk immediately when leadingEdge is false', async () => {
			const source = [snap('a')];
			const results = await collect(
				debounceStream(fromArray(source), { intervalMs: 10, leadingEdge: false })
			);
			// Still yields via timer or final flush, but not as leading edge
			expect(results.length).toBeGreaterThan(0);
			expect(results[0]).toEqual(snap('a'));
		});
	});

	describe('interval batching', () => {
		it('should skip intermediate chunks within intervalMs', async () => {
			// Simulate chunks arriving faster than intervalMs
			// With 0ms source delay and 100ms throttle, only leading + final flush
			const source = [snap('1'), snap('12'), snap('123'), snap('1234'), snap('12345')];
			const results = await collect(
				debounceStream(fromArray(source), { intervalMs: 100, leadingEdge: true })
			);

			// Leading edge + final flush = 2 yields
			expect(results[0]).toEqual(snap('1'));
			expect(results[results.length - 1]).toEqual(snap('12345'));
			expect(results.length).toBe(2);
		});

		it('should yield all chunks when source is slower than intervalMs', async () => {
			// 50ms between items, 1ms throttle → everything passes
			const source = [snap('a'), snap('ab'), snap('abc')];
			const results = await collect(
				debounceStream(fromArrayWithDelay(source, 50), { intervalMs: 1, leadingEdge: true })
			);
			expect(results).toEqual(source);
		});
	});

	describe('final flush', () => {
		it('should flush pending state when source completes', async () => {
			const source = [snap('a'), snap('ab'), snap('abc')];
			const results = await collect(
				debounceStream(fromArrayWithDelay(source, 2), { intervalMs: 200, leadingEdge: true })
			);
			expect(results[results.length - 1]).toEqual(snap('abc'));
		});

		it('should not duplicate final yield if already yielded', async () => {
			const source = [snap('only')];
			const results = await collect(
				debounceStream(fromArray(source), { intervalMs: 100, leadingEdge: true })
			);
			expect(results).toEqual([snap('only')]);
		});
	});

	describe('with thought and toolCalls', () => {
		it('should preserve thought and toolCalls through debounce', async () => {
			const items: StreamContent[] = [
				{ content: '', thought: 'thinking...' },
				{ content: 'hello', thought: 'thinking...' },
				{
					content: 'hello world',
					thought: 'done',
					toolCalls: [{ callId: 'tc1', name: 'test', args: {} }]
				}
			];
			const results = await collect(
				debounceStream(fromArrayWithDelay(items, 2), { intervalMs: 200, leadingEdge: true })
			);

			const last = results[results.length - 1];
			expect(last.content).toBe('hello world');
			expect(last.thought).toBe('done');
			expect(last.toolCalls).toEqual([{ callId: 'tc1', name: 'test', args: {} }]);
		});
	});
});
