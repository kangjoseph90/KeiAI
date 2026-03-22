/**
 * Tokenizer Adapter Tests — KeiAI
 *
 * Tests for pure adapter computation (no caching).
 * Caching is tested in the TokenCounter (llm/tokenizer) tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '$lib/types/errors';
import { type Remote } from 'comlink';
import type { ITokenizerAdapter } from '$lib/adapters/tokenizer';
import type { LLMTokenizer } from '$lib/types/models/llm';
import { WebTokenizerAdapter } from '$lib/adapters/tokenizer/web';
import { TauriTokenizerAdapter } from '$lib/adapters/tokenizer/tauri';
import * as comlink from 'comlink';

/** Interface matching the TokenizerWorker class for testing purposes */
interface TokenizerWorker {
	count(text: string, encoding: LLMTokenizer): Promise<number>;
}

// Mock Comlink's wrap function
vi.mock('comlink', () => ({
	wrap: vi.fn(),
	expose: vi.fn(),
	transfer: vi.fn(),
	proxy: vi.fn(),
	windowEndpoint: vi.fn()
}));

// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
	isTauri: vi.fn(() => false),
	invoke: vi.fn()
}));

const ALL_ENCODINGS: LLMTokenizer[] = [
	'o200k_base',
	'claude',
	'llama3',
	'deepseek',
	'gemma',
	'mistral'
];

describe('Tokenizer Adapters', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('WebTokenizerAdapter', () => {
		let adapter: ITokenizerAdapter;
		const mockWorker = {
			count: vi.fn<(text: string, encoding: LLMTokenizer) => Promise<number>>()
		};

		beforeEach(async () => {
			mockWorker.count.mockReset();

			global.Worker = vi.fn().mockImplementation(function () {
				return {
					terminate: vi.fn(),
					postMessage: vi.fn(),
					addEventListener: vi.fn(),
					removeEventListener: vi.fn()
				};
			}) as unknown as typeof Worker;

			vi.mocked(comlink.wrap).mockReturnValue(mockWorker as unknown as Remote<TokenizerWorker>);

			adapter = new WebTokenizerAdapter();
		});

		it('should call worker and return result', async () => {
			const text = 'Hello, world!';
			const encoding: LLMTokenizer = 'o200k_base';
			const expectedCount = 3;

			mockWorker.count.mockResolvedValue(expectedCount);

			const result = await adapter.count(text, encoding);

			expect(result).toBe(expectedCount);
			expect(mockWorker.count).toHaveBeenCalledTimes(1);
			expect(mockWorker.count).toHaveBeenCalledWith(text, encoding);
		});

		it('should call worker for each invocation (no caching in adapter)', async () => {
			const text = 'Hello, world!';
			const encoding: LLMTokenizer = 'claude';

			mockWorker.count.mockResolvedValue(3);

			await adapter.count(text, encoding);
			await adapter.count(text, encoding);

			expect(mockWorker.count).toHaveBeenCalledTimes(2);
		});

		it('should throw TOKENIZER_ERROR when worker fails', async () => {
			const text = 'Hello, world!';
			const encoding: LLMTokenizer = 'o200k_base';
			const workerError = new Error('Worker initialization failed');

			mockWorker.count.mockRejectedValue(workerError);

			await expect(adapter.count(text, encoding)).rejects.toThrow(AppError);
			await expect(adapter.count(text, encoding)).rejects.toMatchObject({
				code: 'TOKENIZER_ERROR'
			});
		});

		it('should support all 6 encoding types', async () => {
			mockWorker.count.mockResolvedValue(10);

			for (const enc of ALL_ENCODINGS) {
				const result = await adapter.count('test', enc);
				expect(result).toBe(10);
			}

			expect(mockWorker.count).toHaveBeenCalledTimes(ALL_ENCODINGS.length);
		});

		it('should handle empty string', async () => {
			mockWorker.count.mockResolvedValue(0);

			const result = await adapter.count('', 'o200k_base');
			expect(result).toBe(0);
			expect(mockWorker.count).toHaveBeenCalledWith('', 'o200k_base');
		});

		it('should handle very long text', async () => {
			const longText = 'a'.repeat(10000);
			mockWorker.count.mockResolvedValue(10000);

			const result = await adapter.count(longText, 'llama3');
			expect(result).toBe(10000);
		});
	});

	describe('TauriTokenizerAdapter', () => {
		let adapter: ITokenizerAdapter;

		beforeEach(async () => {
			adapter = new TauriTokenizerAdapter();
		});

		it('should invoke Tauri command with correct arguments', async () => {
			const { invoke } = await import('@tauri-apps/api/core');
			vi.mocked(invoke).mockResolvedValue(42);

			const result = await adapter.count('Hello', 'deepseek');

			expect(result).toBe(42);
			expect(invoke).toHaveBeenCalledWith('count_tokens', {
				text: 'Hello',
				encoding: 'deepseek'
			});
		});

		it('should throw TOKENIZER_ERROR when invoke fails', async () => {
			const { invoke } = await import('@tauri-apps/api/core');
			vi.mocked(invoke).mockRejectedValue(new Error('IPC failed'));

			await expect(adapter.count('Hello', 'gemma')).rejects.toThrow(AppError);
			await expect(adapter.count('Hello', 'gemma')).rejects.toMatchObject({
				code: 'TOKENIZER_ERROR'
			});
		});

		it('should support all encoding types', async () => {
			const { invoke } = await import('@tauri-apps/api/core');
			vi.mocked(invoke).mockResolvedValue(5);

			for (const enc of ALL_ENCODINGS) {
				const result = await adapter.count('test', enc);
				expect(result).toBe(5);
			}

			expect(invoke).toHaveBeenCalledTimes(ALL_ENCODINGS.length);
		});
	});
});
