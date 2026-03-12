/**
 * Generation Pipeline Tests — Chat
 *
 * Tests the full streaming lifecycle using the simplified architecture:
 *   - AbortController lives in the pipeline
 *   - Finalization (createMessage) happens in the pipeline
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runChat, stopChat, dismissChat } from '$lib/runtime/task/chat';
import type { StreamProvider } from '$lib/llm/types';

// ─── Mock store modules ───────────────────────────────────────────────────────

vi.mock('$lib/stores/runtime/task', () => ({
	createTask: vi.fn().mockReturnValue('task-1'),
	appendChunk: vi.fn(),
	setTaskContent: vi.fn(),
	setTaskError: vi.fn(),
	getTask: vi.fn(),
	clearTask: vi.fn(),
	clearChatTask: vi.fn()
}));

vi.mock('$lib/stores/content/message', () => ({
	createMessage: vi.fn().mockResolvedValue(undefined)
}));

import {
	createTask,
	setTaskContent,
	setTaskError,
	getTask,
	clearTask,
	clearChatTask
} from '$lib/stores/runtime/task';
import { createMessage } from '$lib/stores/content/message';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Chat Pipeline', () => {
	const mockChatId = 'chat-1';
	const mockTaskId = 'task-1';

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(createTask).mockReturnValue(mockTaskId);
		vi.mocked(getTask).mockReturnValue(null); // Default to not found
	});

	it('should run a successful chat generation', async () => {
		const mockProvider: StreamProvider = {
			stream: vi.fn(async function* () {
				yield 'Hello';
				yield ' world';
			})
		};

		vi.mocked(getTask).mockReturnValue({
			id: mockTaskId,
			status: 'generating',
			content: 'Hello world',
			meta: { kind: 'chat', chatId: mockChatId }
		});

		await runChat(mockChatId, mockProvider);

		expect(createTask).toHaveBeenCalledWith({ kind: 'chat', chatId: mockChatId });
		expect(setTaskContent).toHaveBeenCalledWith(mockTaskId, 'Hello');
		expect(setTaskContent).toHaveBeenCalledWith(mockTaskId, 'Hello world');
		expect(createMessage).toHaveBeenCalledWith(mockChatId, {
			role: 'char',
			content: 'Hello world'
		});
		expect(clearTask).toHaveBeenCalledWith(mockTaskId);
	});

	it('should handle empty response', async () => {
		const mockProvider: StreamProvider = {
			stream: vi.fn(async function* () {
				const empty: string[] = [];
				for (const chunk of empty) yield chunk;
			})
		};

		await runChat(mockChatId, mockProvider);

		expect(setTaskError).toHaveBeenCalledWith(mockTaskId, 'Empty response from model');
		expect(createMessage).not.toHaveBeenCalled();
	});

	it('should save partial content on abort when saveOnAbort is true', async () => {
		const mockProvider: StreamProvider = {
			stream: vi.fn(async function* () {
				yield 'Partial';
				throw new DOMException('Aborted', 'AbortError');
			})
		};

		vi.mocked(getTask).mockReturnValue({
			id: mockTaskId,
			status: 'generating',
			content: 'Partial',
			meta: { kind: 'chat', chatId: mockChatId }
		});

		await runChat(mockChatId, mockProvider, { saveOnAbort: true });

		expect(createMessage).toHaveBeenCalledWith(mockChatId, { role: 'char', content: 'Partial' });
		expect(clearTask).toHaveBeenCalledWith(mockTaskId);
	});

	it('should discard content on abort when saveOnAbort is false', async () => {
		const mockProvider: StreamProvider = {
			stream: vi.fn(async function* () {
				yield 'Partial';
				throw new DOMException('Aborted', 'AbortError');
			})
		};

		vi.mocked(getTask).mockReturnValue({
			id: mockTaskId,
			status: 'generating',
			content: 'Partial',
			meta: { kind: 'chat', chatId: mockChatId }
		});

		await runChat(mockChatId, mockProvider, { saveOnAbort: false });

		expect(createMessage).not.toHaveBeenCalled();
		expect(clearTask).toHaveBeenCalledWith(mockTaskId);
	});

	it('should surface provider errors without persisting', async () => {
		const mockProvider: StreamProvider = {
			stream: vi.fn(async function* () {
				yield ''; // satisfy generator lint
				throw new Error('Network fail');
			})
		};

		await runChat(mockChatId, mockProvider);

		expect(setTaskError).toHaveBeenCalledWith(mockTaskId, 'Network fail');
		expect(createMessage).not.toHaveBeenCalled();
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
