/**
 * Tokenizer Adapter Tests — KeiAI
 *
 * Tests for pure adapter computation (no caching).
 * Caching is tested in the Service layer tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '$lib/shared/errors';
import { type Remote } from 'comlink';
import type { ModelType, ITokenizerAdapter } from '$lib/adapters/tokenizer';
import { WebTokenizerAdapter } from '$lib/adapters/tokenizer/web';
import { TauriTokenizerAdapter } from '$lib/adapters/tokenizer/tauri';
import * as comlink from 'comlink';

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
		let adapter: ITokenizerAdapter;
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
			vi.mocked(comlink.wrap).mockReturnValue(mockWorker as unknown as Remote<TokenizerWorker>);

			adapter = new WebTokenizerAdapter();
		});

		it('should call worker and return result', async () => {
			const text = 'Hello, world!';
			const model: ModelType = 'gpt-4';
			const expectedCount = 3;

			mockWorker.count.mockResolvedValue(expectedCount);

			const result = await adapter.count(text, model);

			expect(result).toBe(expectedCount);
			expect(mockWorker.count).toHaveBeenCalledTimes(1);
			expect(mockWorker.count).toHaveBeenCalledWith(text, model);
		});

		it('should call worker for each invocation (no caching in adapter)', async () => {
			const text = 'Hello, world!';
			const model: ModelType = 'gpt-4';

			mockWorker.count.mockResolvedValue(3);

			// First call
			await adapter.count(text, model);
			// Second call - should call worker again (no caching)
			await adapter.count(text, model);

			expect(mockWorker.count).toHaveBeenCalledTimes(2);
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
			adapter = new TauriTokenizerAdapter();
		});

		it('should throw NOT_IMPLEMENTED when count is called', async () => {
			await expect(adapter.count('Hello', 'gpt-4' as ModelType)).rejects.toThrow(AppError);
			await expect(adapter.count('Hello', 'gpt-4' as ModelType)).rejects.toMatchObject({
				code: 'NOT_IMPLEMENTED'
			});
		});
	});
});
