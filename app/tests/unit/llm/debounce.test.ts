/**
 * debounceStream Tests — KeiAI
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { debounceStream } from '$lib/utils/stream';
import type { LLMStreamContent } from '$lib/llm/types';
import { getTextContent } from '$lib/workflow/agent/llm';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function snap(content: string): LLMStreamContent {
    return { parts: content ? [{ type: 'text', text: content }] : [] };
}

async function collect(iter: AsyncIterable<LLMStreamContent>): Promise<LLMStreamContent[]> {
    const results: LLMStreamContent[] = [];
    for await (const item of iter) {
        results.push(item);
    }
    return results;
}

async function* fromArray(items: LLMStreamContent[]): AsyncIterable<LLMStreamContent> {
    for (const item of items) {
        yield item;
    }
}

async function* fromArrayWithDelay(
    items: LLMStreamContent[],
    delayMs: number
): AsyncIterable<LLMStreamContent> {
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

    it('should yield first chunk immediately (leading edge)', async () => {
        const source = [snap('a'), snap('ab'), snap('abc')];
        const results = await collect(debounceStream(fromArray(source)));
        // First chunk 'a' should be yielded immediately
        expect(results[0]).toEqual(snap('a'));
    });

    it('should batch rapid chunks and yield final state', async () => {
        // Fast sequence: '1' -> '12' -> '123' -> '1234' -> '12345'
        // Leading edge: '1'
        // Subsequent chunks are skipped due to < 50ms interval
        // Final flush: '12345'
        const source = [snap('1'), snap('12'), snap('123'), snap('1234'), snap('12345')];
        const results = await collect(debounceStream(fromArray(source)));

        expect(results[0]).toEqual(snap('1'));
        expect(results[results.length - 1]).toEqual(snap('12345'));
        // Depending on execution speed, it might be 2 yields (leading + final)
        expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should yield all chunks when source is slower than 50ms', async () => {
        // 100ms between items > 50ms throttle → everything passes
        const source = [snap('a'), snap('ab'), snap('abc')];
        const results = await collect(debounceStream(fromArrayWithDelay(source, 100)));
        expect(results).toEqual(source);
    });

    it('should handle empty stream', async () => {
        const results = await collect(debounceStream(fromArray([])));
        expect(results).toEqual([]);
    });

    it('should preserve thought and tool requests through debounce', async () => {
        const items: LLMStreamContent[] = [
            { parts: [{ type: 'thought', text: 'thinking...' }] },
            {
                parts: [
                    { type: 'thought', text: 'thinking...' },
                    { type: 'text', text: 'hello' }
                ]
            },
            {
                parts: [
                    { type: 'thought', text: 'done' },
                    { type: 'text', text: 'hello world' },
                    { type: 'tool_request', callId: 'tc1', name: 'test', args: {} }
                ]
            }
        ];
        const results = await collect(debounceStream(fromArrayWithDelay(items, 1)));

        const last = results[results.length - 1];
        expect(getTextContent(last.parts)).toBe('hello world');
        expect(last.parts).toEqual(items.at(-1)?.parts);
    });
});
