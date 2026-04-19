/**
 * Generation Pipeline Tests — Chat
 *
 * Tests the DB-first streaming lifecycle.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runChat, stopChat, dismissChat } from '$lib/tasks/chat';
import type { LLMStreamHandler, LLMStreamContent } from '$lib/llm/types';

// ─── Mock all dependencies ───────────────────────────────────────────────────

vi.mock('$lib/stores/tasks/chat', () => ({
	createChatTask: vi.fn(),
	setChatTaskError: vi.fn(),
	getChatTask: vi.fn(),
	clearChatTask: vi.fn()
}));

vi.mock('$lib/stores/content/message', () => ({
	createMessage: vi.fn().mockResolvedValue(undefined),
	updateMessage: vi.fn().mockResolvedValue(undefined),
	deleteMessage: vi.fn().mockResolvedValue(undefined),
	getMessage: vi.fn()
}));

vi.mock('$lib/services/content/tool', () => ({
	ToolCallService: {
		create: vi
			.fn()
			.mockResolvedValue({ id: 'tc-1', call: { name: 'mock_tool' }, chatId: 'chat-1' }),
		update: vi.fn().mockResolvedValue(undefined)
	}
}));

vi.mock('$lib/services/content/message', () => {
	return {
		MessageService: {
			get: vi.fn().mockResolvedValue(null),
			getMessagesAfter: vi.fn().mockResolvedValue([]),
			getMessagesBefore: vi.fn().mockResolvedValue([])
		}
	};
});

vi.mock('$lib/stores', () => ({
	getChatDetail: vi
		.fn()
		.mockResolvedValue({ id: 'chat-1', characterId: 'char-1', data: { defaultVariables: {} } }),
	getCharacterDetail: vi.fn().mockResolvedValue({ id: 'char-1', data: { systemPrompt: '' } }),
	getAppSettings: vi.fn().mockResolvedValue({
		personaId: 'persona-1',
		presetId: 'preset-1',
		apiKeys: {},
		chat: { saveMessagesOnSwipe: true }
	}),
	getPersona: vi.fn().mockResolvedValue({ id: 'persona-1', name: '', description: '' }),
	getPresetDetail: vi.fn().mockResolvedValue({
		id: 'preset-1',
		data: { chatModel: { id: '', provider: 'openai', parameters: {} } }
	}),
	getMergedLorebooks: vi.fn().mockResolvedValue([]),
	getMergedScripts: vi.fn().mockResolvedValue([])
}));

vi.mock('$lib/stores/content/chat', () => ({
	getChatDetail: vi
		.fn()
		.mockResolvedValue({ id: 'chat-1', characterId: 'char-1', data: { defaultVariables: {} } })
}));

vi.mock('$lib/stores/content/character', () => ({
	getCharacterDetail: vi.fn().mockResolvedValue({
		id: 'char-1',
		data: { systemPrompt: '', charjs: { code: '', allowLowLevel: false } }
	})
}));

vi.mock('$lib/stores/content/merged', () => ({
	getActiveModuleIds: vi.fn().mockResolvedValue(new Set())
}));

vi.mock('$lib/stores/content/module', () => ({
	getModule: vi.fn().mockResolvedValue({ id: 'mod-1', charjs: { code: '' } })
}));

vi.mock('$lib/charjs', () => ({
	getOrCreateInstance: vi.fn().mockResolvedValue(null),
	collectCharJSInstances: vi.fn().mockResolvedValue([]),
	invokeHandler: vi.fn()
}));

vi.mock('$lib/llm/prompt/builder', () => ({
	buildPrompt: vi.fn().mockReturnValue([])
}));

vi.mock('$lib/llm/handler', () => ({
	selectLLMHandler: vi.fn().mockReturnValue(null)
}));

vi.mock('$lib/pipeline', () => ({
	runPipeline: vi.fn((_chatId: string, _phase: string, data: unknown) => Promise.resolve(data))
}));

import {
	createChatTask,
	setChatTaskError,
	getChatTask,
	clearChatTask
} from '$lib/stores/tasks/chat';
import {
	createMessage,
	updateMessage,
	deleteMessage,
	getMessage
} from '$lib/stores/content/message';
import { MessageService } from '$lib/services/content/message';
import { getAppSettings } from '$lib/stores';
import { buildPrompt } from '$lib/llm/prompt/builder';
import { selectLLMHandler } from '$lib/llm/handler';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mockNewMessage = {
	id: 'msg-new',
	chatId: 'chat-1',
	role: 'char',
	swipes: [],
	activeSwipeIndex: 0,
	sortOrder: 'a0'
};

function makeMockTask(overrides: Record<string, unknown> = {}) {
	return {
		status: 'generating' as const,
		messageId: 'msg-new',
		controller: new AbortController(),
		errorMessage: undefined,
		...overrides
	};
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Chat Pipeline', () => {
	const mockChatId = 'chat-1';

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getChatTask).mockReturnValue(null);
		vi.mocked(buildPrompt).mockReturnValue([{ role: 'user', content: 'test' }]);
		vi.mocked(selectLLMHandler).mockReturnValue({
			stream: vi.fn(async function* () {
				yield { content: 'Response' };
			})
		});
		// Default: createMessage returns a new message
		vi.mocked(createMessage).mockResolvedValue(
			mockNewMessage as unknown as import('$lib/services').Message
		);
		// Default: getMessage returns message with content
		vi.mocked(getMessage).mockResolvedValue({
			...mockNewMessage,
			swipes: [{ content: 'Hello world', createdAt: Date.now(), variables: {} }]
		} as unknown as import('$lib/services').Message);

		// Default: getMessagesBefore returns history
		vi.mocked(MessageService.getMessagesBefore).mockResolvedValue([
			mockNewMessage as unknown as import('$lib/services').Message
		]);
	});

	it('should run a successful chat generation', async () => {
		const mockHandler: LLMStreamHandler = {
			stream: vi.fn(async function* () {
				yield { content: 'Hello' };
				yield { content: 'Hello world' };
			})
		};

		await runChat(mockChatId, { handlerOverride: mockHandler });

		// Should create message in DB immediately
		expect(createMessage).toHaveBeenCalled();
		// Should register task with messageId
		expect(createChatTask).toHaveBeenCalledWith(mockChatId, 'msg-new', expect.any(AbortController));
		// Should update swipe content during streaming
		expect(updateMessage).toHaveBeenCalled();
		// Should clear task on success
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

		// Simulate existing task
		vi.mocked(getChatTask).mockReturnValue(makeMockTask());

		// Attempt run while one is active
		await runChat(mockChatId, { handlerOverride: foreverHandler });

		// Should not have created a new task
		expect(createChatTask).not.toHaveBeenCalled();
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

		// getMessage returns swipe with empty content for empty check
		vi.mocked(getMessage).mockResolvedValue({
			...mockNewMessage,
			swipes: [{ content: '', createdAt: Date.now() }]
		} as unknown as import('$lib/services').Message);

		await runChat(mockChatId, { handlerOverride: mockHandler });

		expect(setChatTaskError).toHaveBeenCalledWith(mockChatId, 'Empty response from model');
		expect(clearChatTask).not.toHaveBeenCalled();
	});

	it('should cleanup on abort', async () => {
		const mockHandler: LLMStreamHandler = {
			stream: vi.fn(async function* () {
				yield { content: 'Partial' };
				throw new DOMException('Aborted', 'AbortError');
			})
		};

		await runChat(mockChatId, { handlerOverride: mockHandler });

		expect(clearChatTask).toHaveBeenCalledWith(mockChatId);
	});

	it('should surface handler errors', async () => {
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

		await runChat(mockChatId, { handlerOverride: mockHandler });

		expect(selectLLMHandler).not.toHaveBeenCalled();
		expect(createChatTask).toHaveBeenCalledWith(mockChatId, 'msg-new', expect.any(AbortController));
	});

	it('selects handler from preset when no override', async () => {
		const mockHandler: LLMStreamHandler = {
			stream: vi.fn(async function* () {
				yield { content: 'Preset response' };
			})
		};

		vi.mocked(selectLLMHandler).mockReturnValue(mockHandler);

		await runChat(mockChatId);

		expect(selectLLMHandler).toHaveBeenCalled();
	});

	describe('Reroll (targetMessageId)', () => {
		const targetMessageId = 'msg-1';
		const mockExistingMessage = {
			id: targetMessageId,
			chatId: mockChatId,
			role: 'char',
			swipes: [{ content: 'Old content', createdAt: 1000, thought: '', toolCalls: [] }],
			activeSwipeIndex: 0,
			sortOrder: 'a0'
		};

		it('should add a new swipe for reroll', async () => {
			const mockHandler: LLMStreamHandler = {
				stream: vi.fn(async function* () {
					yield { content: 'New content' };
				})
			};

			// Mock historical context for reroll: last 2 messages are [..., existing]
			vi.mocked(MessageService.getMessagesBefore).mockResolvedValue([
				mockExistingMessage as unknown as import('$lib/services').Message
			]);

			// Return a message with the new swipe for the final empty check
			vi.mocked(getMessage)
				.mockResolvedValueOnce(mockExistingMessage as unknown as import('$lib/services').Message) // swipe creation
				.mockResolvedValue({
					...mockExistingMessage,
					swipes: [
						...mockExistingMessage.swipes,
						{ content: 'New content', createdAt: Date.now() }
					],
					activeSwipeIndex: 1
				} as unknown as import('$lib/services').Message);

			await runChat(mockChatId, { handlerOverride: mockHandler, reroll: true });

			// Should add swipe to existing message, not create new message
			expect(updateMessage).toHaveBeenCalledWith(
				targetMessageId,
				expect.objectContaining({
					activeSwipeIndex: 1,
					swipes: expect.arrayContaining([expect.objectContaining({ content: 'Old content' })])
				})
			);
			expect(createMessage).not.toHaveBeenCalled();
		});
	});

	describe('Controls', () => {
		it('dismissChat should call clearChatTask', () => {
			dismissChat(mockChatId);
			expect(clearChatTask).toHaveBeenCalledWith(mockChatId);
		});

		it('stopChat does not throw when no active controller', () => {
			expect(() => stopChat(mockChatId)).not.toThrow();
		});

		it('stopChat should abort via task controller', () => {
			const mockController = new AbortController();
			vi.mocked(getChatTask).mockReturnValue(makeMockTask({ controller: mockController }));

			stopChat(mockChatId);

			expect(mockController.signal.aborted).toBe(true);
		});
	});
});
