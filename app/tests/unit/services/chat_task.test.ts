/**
 * Generation Pipeline Tests — Chat
 *
 * Tests the full streaming lifecycle with integrated components.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runChat, stopChat, dismissChat } from '$lib/runtime/task/chat';
import type { StreamProvider, StreamContent } from '$lib/llm/types';

// ─── Mock all dependencies ───────────────────────────────────────────────────

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

vi.mock('$lib/runtime/context/chat', () => {
	class MockChatContext {
		public readonly chatId: string;
		constructor(chatId: string) {
			this.chatId = chatId;
		}
		public async getPreset() {
			return { id: 'preset-1', data: { templateOrder: [] } };
		}
		public async getScripts() {
			return [];
		}
		public async getChat() {
			return { id: this.chatId, characterId: 'char-1', messageCount: 0 };
		}
		public async getCharacter() {
			return { id: 'char-1', data: { systemPrompt: '' } };
		}
		public async getSettings() {
			return { personaId: null, presetId: null };
		}
		public async getPersona() {
			return null;
		}
		public async getLorebooks() {
			return [];
		}
		public async getMessages() {
			return [];
		}
	}
	return { ChatContext: MockChatContext };
});

vi.mock('$lib/runtime/prompt/builder', () => ({
	buildPrompt: vi.fn().mockResolvedValue([])
}));

vi.mock('$lib/runtime/task/provider', () => ({
	selectProvider: vi.fn().mockResolvedValue(null)
}));

vi.mock('$lib/runtime/scripts/executor', () => ({
	applyScripts: vi.fn((text: string) => Promise.resolve(text))
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
import { buildPrompt } from '$lib/runtime/prompt/builder';
import { selectProvider } from '$lib/runtime/task/provider';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Chat Pipeline', () => {
	const mockChatId = 'chat-1';

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getChatTask).mockReturnValue(null);
		vi.mocked(consumeChatTask).mockReturnValue(null);
		vi.mocked(buildPrompt).mockResolvedValue([{ role: 'user', content: 'test' }]);
		vi.mocked(selectProvider).mockResolvedValue({
			stream: vi.fn(async function* () {
				yield { content: 'Response' };
			})
		});
	});

	it('should run a successful chat generation', async () => {
		const mockProvider: StreamProvider = {
			stream: vi.fn(async function* () {
				yield { content: 'Hello' };
				yield { content: 'Hello world' };
			})
		};

		vi.mocked(getChatTask).mockReturnValue({
			status: 'generating',
			content: 'Hello world'
		});

		await runChat(mockChatId, { providerOverride: mockProvider });

		expect(createChatTask).toHaveBeenCalledWith(mockChatId);
		expect(updateChatTask).toHaveBeenCalledWith(mockChatId, { content: 'Hello' });
		expect(updateChatTask).toHaveBeenCalledWith(mockChatId, { content: 'Hello world' });
		expect(createMessage).toHaveBeenCalled();
		expect(clearChatTask).toHaveBeenCalledWith(mockChatId);
	});

	it('should prevent duplicate runs for the same chat', async () => {
		const foreverProvider: StreamProvider = {
			stream: vi.fn(async function* (_msgs, signal) {
				yield { content: '' };
				if (signal.aborted) return;
				await new Promise((resolve) => {
					signal.addEventListener('abort', resolve, { once: true });
				});
			})
		};

		// Start first run
		const firstRun = runChat(mockChatId, { providerOverride: foreverProvider });

		// Attempt second run
		await runChat(mockChatId, { providerOverride: foreverProvider });

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
		vi.mocked(buildPrompt).mockRejectedValue(new Error('Prompt error'));

		await runChat(mockChatId);

		expect(setChatTaskError).toHaveBeenCalledWith(mockChatId, 'Prompt error');
	});

	it('should handle empty response', async () => {
		const mockProvider: StreamProvider = {
			stream: vi.fn(async function* () {
				const empty: StreamContent[] = [];
				for (const chunk of empty) yield chunk;
			})
		};

		await runChat(mockChatId, { providerOverride: mockProvider });

		expect(setChatTaskError).toHaveBeenCalledWith(mockChatId, 'Empty response from model');
		expect(clearChatTask).not.toHaveBeenCalled();
	});

	it('should save partial content on abort when saveOnAbort is true', async () => {
		const mockProvider: StreamProvider = {
			stream: vi.fn(async function* () {
				yield { content: 'Partial' };
				throw new DOMException('Aborted', 'AbortError');
			})
		};

		vi.mocked(getChatTask).mockReturnValue({
			status: 'generating',
			content: 'Partial'
		});

		await runChat(mockChatId, { providerOverride: mockProvider, saveOnAbort: true });

		expect(createMessage).toHaveBeenCalled();
		expect(clearChatTask).toHaveBeenCalledWith(mockChatId);
	});

	it('should discard content on abort when saveOnAbort is false', async () => {
		const mockProvider: StreamProvider = {
			stream: vi.fn(async function* () {
				yield { content: 'Partial' };
				throw new DOMException('Aborted', 'AbortError');
			})
		};

		vi.mocked(getChatTask).mockReturnValue({
			status: 'generating',
			content: 'Partial'
		});

		await runChat(mockChatId, { providerOverride: mockProvider, saveOnAbort: false });

		expect(consumeChatTask).not.toHaveBeenCalled();
		expect(clearChatTask).toHaveBeenCalledWith(mockChatId);
	});

	it('should surface provider errors without persisting', async () => {
		const mockProvider: StreamProvider = {
			stream: vi.fn(async function* () {
				yield { content: '' };
				throw new Error('Network fail');
			})
		};

		await runChat(mockChatId, { providerOverride: mockProvider });

		expect(setChatTaskError).toHaveBeenCalledWith(mockChatId, 'Network fail');
		expect(clearChatTask).not.toHaveBeenCalled();
	});

	it('should use provider override when provided', async () => {
		const mockProvider: StreamProvider = {
			stream: vi.fn(async function* () {
				yield { content: 'Override response' };
			})
		};

		vi.mocked(getChatTask).mockReturnValue({
			status: 'generating',
			content: 'Override response'
		});

		await runChat(mockChatId, { providerOverride: mockProvider });

		expect(selectProvider).not.toHaveBeenCalled();
		expect(createChatTask).toHaveBeenCalledWith(mockChatId);
	});

	it('should select provider from preset when no override', async () => {
		const mockProvider: StreamProvider = {
			stream: vi.fn(async function* () {
				yield { content: 'Preset response' };
			})
		};

		vi.mocked(selectProvider).mockResolvedValue(mockProvider);
		vi.mocked(getChatTask).mockReturnValue({
			status: 'generating',
			content: 'Preset response'
		});

		await runChat(mockChatId);

		expect(selectProvider).toHaveBeenCalled();
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
