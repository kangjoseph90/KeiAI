import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runChat, stop, dismiss } from '$lib/generation/pipeline';
import {
	startTask,
	setTaskContent,
	setTaskError,
	clearTask,
	getTask,
	stopGeneration,
	createMessage
} from '$lib/stores';
import type { StreamProvider } from '$lib/llm/types';
import type { GenerationTask } from '$lib/stores';

// Mock Stores
vi.mock('$lib/stores', () => ({
	startTask: vi.fn(),
	setTaskContent: vi.fn(),
	setTaskError: vi.fn(),
	clearTask: vi.fn(),
	getTask: vi.fn(),
	stopGeneration: vi.fn(),
	createMessage: vi.fn()
}));

describe('Generation Pipeline', () => {
	const mockChatId = 'chat-1';
	const mockAbortController = new AbortController();

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(startTask).mockReturnValue(mockAbortController);
	});

	it('should run a successful chat generation', async () => {
		const mockProvider: StreamProvider = {
			stream: vi.fn(async function* () {
				yield 'Hello';
				yield ' world';
			})
		};

		vi.mocked(getTask).mockReturnValue({
			content: 'Hello world',
			status: 'generating',
			abortController: mockAbortController
		} as GenerationTask);
		vi.mocked(createMessage).mockResolvedValue(undefined);

		await runChat(mockChatId, mockProvider);

		expect(startTask).toHaveBeenCalledWith(mockChatId);
		expect(setTaskContent).toHaveBeenCalledWith(mockChatId, 'Hello');
		expect(setTaskContent).toHaveBeenCalledWith(mockChatId, 'Hello world');
		expect(createMessage).toHaveBeenCalledWith(mockChatId, {
			role: 'char',
			content: 'Hello world'
		});
		expect(clearTask).toHaveBeenCalledWith(mockChatId);
	});

	it('should handle empty response', async () => {
		const mockProvider: StreamProvider = {
			stream: vi.fn(async function* () {
				const empty: string[] = [];
				for (const chunk of empty) yield chunk;
			})
		};

		await runChat(mockChatId, mockProvider);

		expect(setTaskError).toHaveBeenCalledWith(mockChatId, 'Empty response from model');
	});

	it('should handle abort', async () => {
		const mockProvider: StreamProvider = {
			stream: vi.fn(async function* () {
				yield 'Partial';
				throw new DOMException('Aborted', 'AbortError');
			})
		};

		vi.mocked(getTask).mockReturnValue({
			content: 'Partial',
			status: 'generating',
			abortController: mockAbortController
		} as GenerationTask);

		await runChat(mockChatId, mockProvider);

		// finalize should be called with partial content
		expect(createMessage).toHaveBeenCalledWith(mockChatId, { role: 'char', content: 'Partial' });
		expect(clearTask).toHaveBeenCalledWith(mockChatId);
	});

	it('should handle provider errors', async () => {
		const mockProvider: StreamProvider = {
			stream: vi.fn(async function* () {
				const empty: string[] = [];
				for (const chunk of empty) yield chunk;
				throw new Error('Network fail');
			})
		};

		await runChat(mockChatId, mockProvider);

		expect(setTaskError).toHaveBeenCalledWith(mockChatId, 'Network fail');
	});

	describe('Controls', () => {
		it('stop should call stopGeneration', () => {
			stop(mockChatId);
			expect(stopGeneration).toHaveBeenCalledWith(mockChatId);
		});

		it('dismiss should call clearTask', () => {
			dismiss(mockChatId);
			expect(clearTask).toHaveBeenCalledWith(mockChatId);
		});
	});
});
