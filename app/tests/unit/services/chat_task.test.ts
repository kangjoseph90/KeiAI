/**
 * Generation Pipeline Tests — Chat
 *
 * Tests the full streaming lifecycle using the simplified architecture:
 *   - AbortController lives in the pipeline
 *   - Finalization (_persistTask) happens in the pipeline, consuming the store task
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runChat, stopChat, dismissChat } from '$lib/runtime/task/chat';
import type { StreamProvider, StreamContent } from '$lib/llm/types';

// ─── Mock store modules ───────────────────────────────────────────────────────

vi.mock('$lib/stores/task/chat', () => ({
	createChatTask: vi.fn(),
	updateChatTask: vi.fn(),
	setChatTaskError: vi.fn(),
	getChatTask: vi.fn(),
	clearChatTask: vi.fn(),
	consumeChatTask: vi.fn().mockReturnValue(null)
}));

vi.mock('$lib/stores/content/message', () => ({
	createMessage: vi.fn().mockResolvedValue(undefined),
	updateMessage: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('$lib/services/content/tool', () => ({
	ToolCallService: {
		create: vi
			.fn()
			.mockResolvedValue({ id: 'tc-1', call: { name: 'mock_tool' }, chatId: 'chat-1' }),
		update: vi.fn().mockResolvedValue(undefined)
	}
}));

vi.mock('$lib/services/content/message', () => ({
	MessageService: {
		get: vi.fn().mockResolvedValue(null)
	}
}));

import {
	createChatTask,
	updateChatTask,
	setChatTaskError,
	getChatTask,
	clearChatTask,
	consumeChatTask
} from '$lib/stores/task/chat';
import { createMessage } from '$lib/stores/content/message';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Chat Pipeline', () => {
	const mockChatId = 'chat-1';

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getChatTask).mockReturnValue(null);
		vi.mocked(consumeChatTask).mockReturnValue(null);
	});

	it('should run a successful chat generation', async () => {
		const mockProvider: StreamProvider = {
			stream: vi.fn(async function* () {
				yield { content: 'Hello' };
				yield { content: 'Hello world' };
			})
		};

		vi.mocked(getChatTask).mockReturnValue({
			chatId: mockChatId,
			status: 'generating',
			content: 'Hello world'
		});
		vi.mocked(consumeChatTask).mockReturnValue({
			chatId: mockChatId,
			status: 'generating',
			content: 'Hello world'
		});

		await runChat(mockChatId, mockProvider);

		expect(createChatTask).toHaveBeenCalledWith(mockChatId);
		expect(updateChatTask).toHaveBeenCalledWith(mockChatId, { content: 'Hello' });
		expect(updateChatTask).toHaveBeenCalledWith(mockChatId, { content: 'Hello world' });
		// _persistTask calls consumeChatTask, then createMessage
		expect(consumeChatTask).toHaveBeenCalledWith(mockChatId);
		expect(createMessage).toHaveBeenCalled();
	});

	it('should handle empty response', async () => {
		const mockProvider: StreamProvider = {
			stream: vi.fn(async function* () {
				const empty: StreamContent[] = [];
				for (const chunk of empty) yield chunk;
			})
		};

		await runChat(mockChatId, mockProvider);

		expect(setChatTaskError).toHaveBeenCalledWith(mockChatId, 'Empty response from model');
		expect(consumeChatTask).not.toHaveBeenCalled();
	});

	it('should save partial content on abort when saveOnAbort is true', async () => {
		const mockProvider: StreamProvider = {
			stream: vi.fn(async function* () {
				yield { content: 'Partial' };
				throw new DOMException('Aborted', 'AbortError');
			})
		};

		vi.mocked(getChatTask).mockReturnValue({
			chatId: mockChatId,
			status: 'generating',
			content: 'Partial'
		});
		vi.mocked(consumeChatTask).mockReturnValue({
			chatId: mockChatId,
			status: 'generating',
			content: 'Partial'
		});

		await runChat(mockChatId, mockProvider, { saveOnAbort: true });

		expect(consumeChatTask).toHaveBeenCalledWith(mockChatId);
	});

	it('should discard content on abort when saveOnAbort is false', async () => {
		const mockProvider: StreamProvider = {
			stream: vi.fn(async function* () {
				yield { content: 'Partial' };
				throw new DOMException('Aborted', 'AbortError');
			})
		};

		vi.mocked(getChatTask).mockReturnValue({
			chatId: mockChatId,
			status: 'generating',
			content: 'Partial'
		});

		await runChat(mockChatId, mockProvider, { saveOnAbort: false });

		expect(consumeChatTask).not.toHaveBeenCalled();
		expect(clearChatTask).toHaveBeenCalledWith(mockChatId);
	});

	it('should surface provider errors without persisting', async () => {
		const mockProvider: StreamProvider = {
			stream: vi.fn(async function* () {
				yield { content: '' }; // satisfy generator lint
				throw new Error('Network fail');
			})
		};

		await runChat(mockChatId, mockProvider);

		expect(setChatTaskError).toHaveBeenCalledWith(mockChatId, 'Network fail');
		expect(consumeChatTask).not.toHaveBeenCalled();
	});

	describe('Controls', () => {
		it('dismissChat should call clearChatTask', () => {
			dismissChat(mockChatId);
			expect(clearChatTask).toHaveBeenCalledWith(mockChatId);
		});

		it('stopChat does not throw when no active controller', () => {
			expect(() => stopChat(mockChatId)).not.toThrow();
		});
	});
});
