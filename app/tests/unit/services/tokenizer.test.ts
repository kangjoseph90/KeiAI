/**
 * Token Counter Tests — KeiAI
 *
 * Tests for LRU caching behavior in TokenCounter.
 * Adapter layer is tested separately.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TokenCounter } from '$lib/llm/tokenizer';
import { appTokenizer } from '$lib/adapters/tokenizer';
import type { LLMTokenizer } from '$lib/types/models';

// Mock the adapter
vi.mock('$lib/adapters/tokenizer', () => ({
	appTokenizer: {
		count: vi.fn()
	}
}));

const ALL_ENCODINGS: LLMTokenizer[] = [
	'o200k_base',
	'claude',
	'llama3',
	'deepseek',
	'gemma',
	'mistral'
];

describe('TokenCounter', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		TokenCounter.clearCache();
	});

	describe('count', () => {
		it('should call adapter on cache miss and cache the result', async () => {
			const text = 'Hello, world!';
			const encoding: LLMTokenizer = 'o200k_base';
			const expectedCount = 3;

			vi.mocked(appTokenizer.count).mockResolvedValue(expectedCount);

			const result = await TokenCounter.count(text, encoding);

			expect(result).toBe(expectedCount);
			expect(appTokenizer.count).toHaveBeenCalledTimes(1);
			expect(appTokenizer.count).toHaveBeenCalledWith(text, encoding);
		});

		it('should return cached value on subsequent calls with same input', async () => {
			const text = 'Hello, world!';
			const encoding: LLMTokenizer = 'claude';
			const expectedCount = 3;

			vi.mocked(appTokenizer.count).mockResolvedValue(expectedCount);

			const result1 = await TokenCounter.count(text, encoding);
			expect(result1).toBe(expectedCount);
			expect(appTokenizer.count).toHaveBeenCalledTimes(1);

			const result2 = await TokenCounter.count(text, encoding);
			expect(result2).toBe(expectedCount);
			expect(appTokenizer.count).toHaveBeenCalledTimes(1); // Still 1, not called again
		});

		it('should treat same text with different encodings as different cache entries', async () => {
			const text = 'Hello, world!';
			const enc1: LLMTokenizer = 'o200k_base';
			const enc2: LLMTokenizer = 'llama3';

			vi.mocked(appTokenizer.count).mockResolvedValue(3);

			await TokenCounter.count(text, enc1);
			await TokenCounter.count(text, enc2);

			expect(appTokenizer.count).toHaveBeenCalledTimes(2);
			expect(appTokenizer.count).toHaveBeenNthCalledWith(1, text, enc1);
			expect(appTokenizer.count).toHaveBeenNthCalledWith(2, text, enc2);
		});

		it('should clear cache when clearCache is called', async () => {
			const text = 'Hello, world!';
			const encoding: LLMTokenizer = 'deepseek';

			vi.mocked(appTokenizer.count).mockResolvedValue(3);

			await TokenCounter.count(text, encoding);
			expect(appTokenizer.count).toHaveBeenCalledTimes(1);

			TokenCounter.clearCache();

			await TokenCounter.count(text, encoding);
			expect(appTokenizer.count).toHaveBeenCalledTimes(2);
		});

		it('should return cache size', async () => {
			vi.mocked(appTokenizer.count).mockResolvedValue(3);

			expect(TokenCounter.getCacheSize()).toBe(0);

			await TokenCounter.count('text1', 'o200k_base');
			expect(TokenCounter.getCacheSize()).toBe(1);

			await TokenCounter.count('text2', 'claude');
			expect(TokenCounter.getCacheSize()).toBe(2);

			// Same key doesn't increase size
			await TokenCounter.count('text1', 'o200k_base');
			expect(TokenCounter.getCacheSize()).toBe(2);
		});

		it('should support all encoding types', async () => {
			vi.mocked(appTokenizer.count).mockResolvedValue(10);

			for (const enc of ALL_ENCODINGS) {
				const result = await TokenCounter.count('test', enc);
				expect(result).toBe(10);
			}

			expect(appTokenizer.count).toHaveBeenCalledTimes(ALL_ENCODINGS.length);
		});

		it('should handle empty string', async () => {
			vi.mocked(appTokenizer.count).mockResolvedValue(0);

			const result = await TokenCounter.count('', 'gemma');
			expect(result).toBe(0);
		});

		it('should handle very long text', async () => {
			const longText = 'a'.repeat(10000);

			vi.mocked(appTokenizer.count).mockResolvedValue(10000);

			const result = await TokenCounter.count(longText, 'mistral');
			expect(result).toBe(10000);
		});
	});
});
