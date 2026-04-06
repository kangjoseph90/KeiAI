/**
 * Generation Pipeline Tests — Chat
 *
 * Tests the full streaming lifecycle with integrated components.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runChat, stopChat, dismissChat } from '$lib/tasks/chat';
import type { LLMStreamHandler, LLMStreamContent } from '$lib/llm/types';

// ─── Mock all dependencies ───────────────────────────────────────────────────

vi.mock('$lib/stores/tasks/chat', () => ({
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
		get: vi.fn().mockResolvedValue(null),
		getMessagesAfter: vi.fn().mockResolvedValue([])
	}
}));

vi.mock('$lib/stores', () => ({
	getChatDetail: vi
		.fn()
		.mockResolvedValue({ id: 'chat-1', characterId: 'char-1', messageCount: 0 }),
	getCharacterDetail: vi.fn().mockResolvedValue({ id: 'char-1', data: { systemPrompt: '' } }),
	getAppSettings: vi
		.fn()
		.mockResolvedValue({ personaId: 'persona-1', presetId: 'preset-1', apiKeys: {} }),
	getPersona: vi.fn().mockResolvedValue({ id: 'persona-1', name: '', description: '' }),
	getPresetDetail: vi.fn().mockResolvedValue({
		id: 'preset-1',
		data: { chatModel: { id: '', provider: 'openai', parameters: {} } }
	}),
	getMergedLorebooks: vi.fn().mockResolvedValue([]),
	getMergedScripts: vi.fn().mockResolvedValue([])
}));

vi.mock('$lib/llm/prompt/builder', () => ({
	buildPrompt: vi.fn().mockReturnValue([])
}));

vi.mock('$lib/llm/handler', () => ({
	selectLLMHandler: vi.fn().mockReturnValue(null)
}));

vi.mock('$lib/scripts', () => ({
	applyScripts: vi.fn((text: string) => Promise.resolve(text))
}));

import {
	createChatTask,
	updateChatTask,
	setChatTaskError,
	getChatTask,
	clearChatTask,
	consumeChatTask
} from '$lib/stores/tasks/chat';
import { createMessage } from '$lib/stores/content/message';
import { buildPrompt } from '$lib/llm/prompt/builder';
import { selectLLMHandler } from '$lib/llm/handler';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Chat Pipeline', () => {
	const mockChatId = 'chat-1';

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getChatTask).mockReturnValue(null);
		vi.mocked(consumeChatTask).mockReturnValue(null);
		vi.mocked(buildPrompt).mockReturnValue([{ role: 'user', content: 'test' }]);
		vi.mocked(selectLLMHandler).mockReturnValue({
			stream: vi.fn(async function* () {
				yield { content: 'Response' };
			})
		});
	});

	it('should run a successful chat generation', async () => {
		const mockHandler: LLMStreamHandler = {
			stream: vi.fn(async function* () {
				yield { content: 'Hello' };
				yield { content: 'Hello world' };
			})
		};

		vi.mocked(getChatTask).mockReturnValue({
			status: 'generating',
			content: 'Hello world'
		});

		await runChat(mockChatId, { handlerOverride: mockHandler });

		expect(createChatTask).toHaveBeenCalledWith(mockChatId);
		expect(updateChatTask).toHaveBeenCalledWith(mockChatId, { content: 'Hello' });
		expect(updateChatTask).toHaveBeenCalledWith(mockChatId, { content: 'Hello world' });
		expect(createMessage).toHaveBeenCalled();
		expect(clearChatTask).toHaveBeenCalledWith(mockChatId);
	});

	it('should prevent duplicate runs for the same chat', async () => {
		const foreverHandler: LLMStreamHandler = {
			stream: vi.fn(async function* (_msgs, signal) {
				yield { content: '' };
				if (signal.aborted) return;
				await new Promise((resolve) => {
					signal.addEventListener('abort', resolve, { once: true });
				});
			})
		};

		// Start first run
		const firstRun = runChat(mockChatId, { handlerOverride: foreverHandler });

		// Attempt second run
		await runChat(mockChatId, { handlerOverride: foreverHandler });

		// Should only have registered once
		expect(createChatTask).toHaveBeenCalledTimes(1);

		// Cleanup: Manually abort the first run so it doesn't leak into other tests
		stopChat(mockChatId);
		try {
			await firstRun;
		} catch (e) {
			// Expected abort
		}
	});

	it('should catch and surface errors during prompt building', async () => {
		vi.mocked(buildPrompt).mockImplementation(() => {
			throw new Error('Prompt error');
		});

		await runChat(mockChatId);

		expect(setChatTaskError).toHaveBeenCalledWith(mockChatId, 'Prompt error');
	});

	it('should handle empty response', async () => {
		const mockHandler: LLMStreamHandler = {
			stream: vi.fn(async function* () {
				const empty: LLMStreamContent[] = [];
				for (const chunk of empty) yield chunk;
			})
		};

		await runChat(mockChatId, { handlerOverride: mockHandler });

		expect(setChatTaskError).toHaveBeenCalledWith(mockChatId, 'Empty response from model');
		expect(clearChatTask).not.toHaveBeenCalled();
	});

	it('should save partial content on abort when saveOnAbort is true', async () => {
		const mockHandler: LLMStreamHandler = {
			stream: vi.fn(async function* () {
				yield { content: 'Partial' };
				throw new DOMException('Aborted', 'AbortError');
			})
		};

		vi.mocked(getChatTask).mockReturnValue({
			status: 'generating',
			content: 'Partial'
		});

		await runChat(mockChatId, { handlerOverride: mockHandler, saveOnAbort: true });

		expect(createMessage).toHaveBeenCalled();
		expect(clearChatTask).toHaveBeenCalledWith(mockChatId);
	});

	it('should discard content on abort when saveOnAbort is false', async () => {
		const mockHandler: LLMStreamHandler = {
			stream: vi.fn(async function* () {
				yield { content: 'Partial' };
				throw new DOMException('Aborted', 'AbortError');
			})
		};

		vi.mocked(getChatTask).mockReturnValue({
			status: 'generating',
			content: 'Partial'
		});

		await runChat(mockChatId, { handlerOverride: mockHandler, saveOnAbort: false });

		expect(consumeChatTask).not.toHaveBeenCalled();
		expect(clearChatTask).toHaveBeenCalledWith(mockChatId);
	});

	it('should surface handler errors without persisting', async () => {
		const mockHandler: LLMStreamHandler = {
			stream: vi.fn(async function* () {
				yield { content: '' };
				throw new Error('Network fail');
			})
		};

		await runChat(mockChatId, { handlerOverride: mockHandler });

		expect(setChatTaskError).toHaveBeenCalledWith(mockChatId, 'Network fail');
		expect(clearChatTask).not.toHaveBeenCalled();
	});

	it('should use handler override when provided', async () => {
		const mockHandler: LLMStreamHandler = {
			stream: vi.fn(async function* () {
				yield { content: 'Override response' };
			})
		};

		vi.mocked(getChatTask).mockReturnValue({
			status: 'generating',
			content: 'Override response'
		});

		await runChat(mockChatId, { handlerOverride: mockHandler });

		expect(selectLLMHandler).not.toHaveBeenCalled();
		expect(createChatTask).toHaveBeenCalledWith(mockChatId);
	});

	it('should select handler from preset when no override', async () => {
		const mockHandler: LLMStreamHandler = {
			stream: vi.fn(async function* () {
				yield { content: 'Preset response' };
			})
		};

		vi.mocked(selectLLMHandler).mockReturnValue(mockHandler);
		vi.mocked(getChatTask).mockReturnValue({
			status: 'generating',
			content: 'Preset response'
		});

		await runChat(mockChatId);

		expect(selectLLMHandler).toHaveBeenCalled();
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
