/**
 * Tokenizer Adapter Tests — KeiAI
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '$lib/shared/errors';
import { type Remote } from 'comlink';
import type { ModelType, ITokenizerAdapter } from '$lib/adapters/tokenizer';
import type { Mock } from 'vitest';

/** Interface matching the TokenizerWorker class for testing purposes */
interface TokenizerWorker {
	count(text: string, model: ModelType): Promise<number>;
}

// Mock Comlink's wrap function
vi.mock('comlink', () => ({
	wrap: vi.fn(),
	expose: vi.fn(),
	transfer: vi.fn(),
	proxy: vi.fn(),
	windowEndpoint: vi.fn()
}));

// Mock isTauri to always return false (test in Web mode)
vi.mock('@tauri-apps/api/core', () => ({
	isTauri: vi.fn(() => false)
}));

describe('Tokenizer Adapters', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('WebTokenizerAdapter', () => {
		// Use unknown first to avoid direct any assignment, then assert as ITokenizerAdapter
		let adapter: ITokenizerAdapter & {
			clearCache(): void;
			getCacheSize(): number;
		};
		const mockWorker = {
			count: vi.fn<(text: string, model: ModelType) => Promise<number>>()
		};

		beforeEach(async () => {
			// Reset mock worker
			mockWorker.count.mockReset();

			global.Worker = vi.fn().mockImplementation(function () {
				return {
					terminate: vi.fn(),
					postMessage: vi.fn(),
					addEventListener: vi.fn(),
					removeEventListener: vi.fn()
				};
			}) as unknown as typeof Worker;

			// Setup comlink mock to return our mock worker
			const comlinkModule = await import('comlink');
			vi.mocked(comlinkModule.wrap).mockReturnValue(
				mockWorker as unknown as Remote<TokenizerWorker>
			);

			// Import adapter after mocks are set up
			const adapterModule = await import('$lib/adapters/tokenizer/web');
			adapter = new adapterModule.WebTokenizerAdapter() as unknown as typeof adapter;
			adapter.clearCache();
		});

		it('should call worker on cache miss and cache the result', async () => {
			const text = 'Hello, world!';
			const model: ModelType = 'gpt-4';
			const expectedCount = 3;

			mockWorker.count.mockResolvedValue(expectedCount);

			const result = await adapter.count(text, model);

			expect(result).toBe(expectedCount);
			expect(mockWorker.count).toHaveBeenCalledTimes(1);
			expect(mockWorker.count).toHaveBeenCalledWith(text, model);
		});

		it('should return cached value on subsequent calls with same input', async () => {
			const text = 'Hello, world!';
			const model: ModelType = 'gpt-4';
			const expectedCount = 3;

			mockWorker.count.mockResolvedValue(expectedCount);

			// First call - should hit worker
			const result1 = await adapter.count(text, model);
			expect(result1).toBe(expectedCount);
			expect(mockWorker.count).toHaveBeenCalledTimes(1);

			// Second call - should use cache
			const result2 = await adapter.count(text, model);
			expect(result2).toBe(expectedCount);
			expect(mockWorker.count).toHaveBeenCalledTimes(1); // Still 1, not called again
		});

		it('should treat same text with different models as different cache entries', async () => {
			const text = 'Hello, world!';
			const model1: ModelType = 'gpt-4';
			const model2: ModelType = 'gpt-3.5-turbo';

			mockWorker.count.mockResolvedValue(3);

			await adapter.count(text, model1);
			await adapter.count(text, model2);

			// Both calls should hit worker since cache key includes model
			expect(mockWorker.count).toHaveBeenCalledTimes(2);
			expect(mockWorker.count).toHaveBeenNthCalledWith(1, text, model1);
			expect(mockWorker.count).toHaveBeenNthCalledWith(2, text, model2);
		});

		it('should clear cache when clearCache is called', async () => {
			const text = 'Hello, world!';
			const model: ModelType = 'gpt-4';

			mockWorker.count.mockResolvedValue(3);

			// First call - cache result
			await adapter.count(text, model);
			expect(mockWorker.count).toHaveBeenCalledTimes(1);

			// Clear cache
			adapter.clearCache();

			// Second call - should hit worker again
			await adapter.count(text, model);
			expect(mockWorker.count).toHaveBeenCalledTimes(2);
		});

		it('should return cache size', async () => {
			expect(adapter.getCacheSize()).toBe(0);

			mockWorker.count.mockResolvedValue(3);

			await adapter.count('text1', 'gpt-4' as ModelType);
			expect(adapter.getCacheSize()).toBe(1);

			await adapter.count('text2', 'gpt-4' as ModelType);
			expect(adapter.getCacheSize()).toBe(2);

			// Same key doesn't increase size
			await adapter.count('text1', 'gpt-4' as ModelType);
			expect(adapter.getCacheSize()).toBe(2);
		});

		it('should throw TOKENIZER_ERROR when worker fails', async () => {
			const text = 'Hello, world!';
			const model: ModelType = 'gpt-4';
			const workerError = new Error('Worker initialization failed');

			mockWorker.count.mockRejectedValue(workerError);

			await expect(adapter.count(text, model)).rejects.toThrow(AppError);
			await expect(adapter.count(text, model)).rejects.toMatchObject({
				code: 'TOKENIZER_ERROR'
			});
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

			mockWorker.count.mockResolvedValue(10);

			for (const model of models) {
				const result = await adapter.count('test', model);
				expect(result).toBe(10);
			}

			expect(mockWorker.count).toHaveBeenCalledTimes(models.length);
		});

		it('should handle empty string', async () => {
			mockWorker.count.mockResolvedValue(0);

			const result = await adapter.count('', 'gpt-4' as ModelType);
			expect(result).toBe(0);
			expect(mockWorker.count).toHaveBeenCalledWith('', 'gpt-4');
		});

		it('should handle very long text', async () => {
			const longText = 'a'.repeat(10000);
			mockWorker.count.mockResolvedValue(10000);

			const result = await adapter.count(longText, 'gpt-4' as ModelType);
			expect(result).toBe(10000);
		});
	});

	describe('TauriTokenizerAdapter', () => {
		let adapter: ITokenizerAdapter;

		beforeEach(async () => {
			const adapterModule = await import('$lib/adapters/tokenizer/tauri');
			adapter = new adapterModule.TauriTokenizerAdapter();
		});

		it('should throw NOT_IMPLEMENTED when count is called', async () => {
			await expect(adapter.count('Hello', 'gpt-4' as ModelType)).rejects.toThrow(AppError);

			await expect(adapter.count('Hello', 'gpt-4' as ModelType)).rejects.toMatchObject({
				code: 'NOT_IMPLEMENTED'
			});
		});

		it('should have clearCache method that works', () => {
			expect(() => adapter.clearCache?.()).not.toThrow();
		});

		it('should have getCacheSize method that returns 0', () => {
			expect(adapter.getCacheSize?.()).toBe(0);
		});
	});
});
