/**
 * Tokenizer Service Tests — KeiAI
 *
 * Tests for Service layer caching behavior.
 * Adapter layer is tested separately.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TokenizerService } from '$lib/services/tokenizer';
import { appTokenizer, type ModelType } from '$lib/adapters/tokenizer';

// Mock the adapter
vi.mock('$lib/adapters/tokenizer', () => ({
	appTokenizer: {
		count: vi.fn()
	}
}));

describe('TokenizerService', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		TokenizerService.clearCache(); // Reset static cache between tests
	});

	describe('count', () => {
		it('should call adapter on cache miss and cache the result', async () => {
			const text = 'Hello, world!';
			const model: ModelType = 'gpt-4';
			const expectedCount = 3;

			vi.mocked(appTokenizer.count).mockResolvedValue(expectedCount);

			const result = await TokenizerService.count(text, model);

			expect(result).toBe(expectedCount);
			expect(appTokenizer.count).toHaveBeenCalledTimes(1);
			expect(appTokenizer.count).toHaveBeenCalledWith(text, model);
		});

		it('should return cached value on subsequent calls with same input', async () => {
			const text = 'Hello, world!';
			const model: ModelType = 'gpt-4';
			const expectedCount = 3;

			vi.mocked(appTokenizer.count).mockResolvedValue(expectedCount);

			// First call - should hit adapter
			const result1 = await TokenizerService.count(text, model);
			expect(result1).toBe(expectedCount);
			expect(appTokenizer.count).toHaveBeenCalledTimes(1);

			// Second call - should use cache
			const result2 = await TokenizerService.count(text, model);
			expect(result2).toBe(expectedCount);
			expect(appTokenizer.count).toHaveBeenCalledTimes(1); // Still 1, not called again
		});

		it('should treat same text with different models as different cache entries', async () => {
			const text = 'Hello, world!';
			const model1: ModelType = 'gpt-4';
			const model2: ModelType = 'gpt-3.5-turbo';

			vi.mocked(appTokenizer.count).mockResolvedValue(3);

			await TokenizerService.count(text, model1);
			await TokenizerService.count(text, model2);

			// Both calls should hit adapter since cache key includes model
			expect(appTokenizer.count).toHaveBeenCalledTimes(2);
			expect(appTokenizer.count).toHaveBeenNthCalledWith(1, text, model1);
			expect(appTokenizer.count).toHaveBeenNthCalledWith(2, text, model2);
		});

		it('should clear cache when clearCache is called', async () => {
			const text = 'Hello, world!';
			const model: ModelType = 'gpt-4';

			vi.mocked(appTokenizer.count).mockResolvedValue(3);

			// First call - cache result
			await TokenizerService.count(text, model);
			expect(appTokenizer.count).toHaveBeenCalledTimes(1);

			// Clear cache
			TokenizerService.clearCache();

			// Second call - should hit adapter again
			await TokenizerService.count(text, model);
			expect(appTokenizer.count).toHaveBeenCalledTimes(2);
		});

		it('should return cache size', async () => {
			vi.mocked(appTokenizer.count).mockResolvedValue(3);

			expect(TokenizerService.getCacheSize()).toBe(0);

			await TokenizerService.count('text1', 'gpt-4' as ModelType);
			expect(TokenizerService.getCacheSize()).toBe(1);

			await TokenizerService.count('text2', 'gpt-4' as ModelType);
			expect(TokenizerService.getCacheSize()).toBe(2);

			// Same key doesn't increase size
			await TokenizerService.count('text1', 'gpt-4' as ModelType);
			expect(TokenizerService.getCacheSize()).toBe(2);
		});

		it('should support multiple model types', async () => {
			const models: ModelType[] = [
				'gpt-4',
				'gpt-4o',
				'gpt-4o-mini',
				'gpt-3.5-turbo',
				'cl100k_base',
				'o200k_base',
				'p50k_base',
				'r50k_base',
				'p50k_edit',
				'gpt2'
			];

			vi.mocked(appTokenizer.count).mockResolvedValue(10);

			for (const model of models) {
				const result = await TokenizerService.count('test', model);
				expect(result).toBe(10);
			}

			expect(appTokenizer.count).toHaveBeenCalledTimes(models.length);
		});

		it('should handle empty string', async () => {
			vi.mocked(appTokenizer.count).mockResolvedValue(0);

			const result = await TokenizerService.count('', 'gpt-4' as ModelType);
			expect(result).toBe(0);
		});

		it('should handle very long text', async () => {
			const longText = 'a'.repeat(10000);

			vi.mocked(appTokenizer.count).mockResolvedValue(10000);

			const result = await TokenizerService.count(longText, 'gpt-4' as ModelType);
			expect(result).toBe(10000);
		});
	});
});
