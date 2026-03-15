import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	loadInitialMessages,
	loadOlderMessages,
	loadNewerMessages,
	createMessage,
	updateMessage,
	deleteMessage
} from '$lib/stores/content/message';
import { messages, chats, activeChat, activeChatId } from '$lib/stores/state';
import {
	MessageService,
	ChatService,
	type Message,
	type Chat,
	type ChatDetail
} from '$lib/services';
import { AppError } from '$lib/types/errors';

// Mock Services
vi.mock('$lib/services', () => ({
	MessageService: {
		getMessagesBefore: vi.fn(),
		getMessagesAfter: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		delete: vi.fn()
	},
	ChatService: {
		updateSummary: vi.fn()
	}
}));

describe('Message Store', () => {
	const mockChatId = 'chat-1';
	const mockMessage: Message = {
		id: 'msg-1',
		chatId: mockChatId,
		role: 'user',
		content: 'Hello',
		sortOrder: 'a'
	};

	beforeEach(() => {
		vi.clearAllMocks();
		messages.set([]);
		chats.set([]);
		activeChat.set({ id: mockChatId, messageCount: 0 } as ChatDetail);
	});

	describe('loadInitialMessages', () => {
		it('should load and set messages if activeChatId matches', async () => {
			const mockMsgs = [mockMessage];
			vi.mocked(MessageService.getMessagesBefore).mockResolvedValue(mockMsgs);

			await loadInitialMessages(mockChatId);

			expect(MessageService.getMessagesBefore).toHaveBeenCalled();
			expect(get(messages)).toEqual(mockMsgs);
		});

		it('should not update store if activeChatId has changed', async () => {
			activeChat.set({ id: 'other-chat' } as ChatDetail);
			vi.mocked(MessageService.getMessagesBefore).mockResolvedValue([mockMessage]);

			await loadInitialMessages(mockChatId);

			expect(get(messages)).toEqual([]);
		});
	});

	describe('Pagination', () => {
		it('loadOlderMessages should prepend older messages', async () => {
			messages.set([mockMessage]);
			const olderMsg = { ...mockMessage, id: 'msg-old', sortOrder: '0' };
			vi.mocked(MessageService.getMessagesBefore).mockResolvedValue([olderMsg]);

			await loadOlderMessages(mockChatId);

			expect(MessageService.getMessagesBefore).toHaveBeenCalledWith(mockChatId, 'a', 50);
			expect(get(messages)).toEqual([olderMsg, mockMessage]);
		});

		it('loadNewerMessages should append newer messages', async () => {
			messages.set([mockMessage]);
			const newerMsg = { ...mockMessage, id: 'msg-new', sortOrder: 'b' };
			vi.mocked(MessageService.getMessagesAfter).mockResolvedValue([newerMsg]);

			await loadNewerMessages(mockChatId);

			expect(MessageService.getMessagesAfter).toHaveBeenCalledWith(mockChatId, 'a', 50);
			expect(get(messages)).toEqual([mockMessage, newerMsg]);
		});
	});

	describe('createMessage', () => {
		it('should create message and update chat preview', async () => {
			const newMessage = { ...mockMessage, id: 'new-id' };
			const updatedChat = { id: mockChatId, lastMessagePreview: 'New...' } as Chat;

			vi.mocked(MessageService.create).mockResolvedValue(newMessage);
			vi.mocked(ChatService.updateSummary).mockResolvedValue(updatedChat);
			chats.set([{ id: mockChatId } as Chat]);

			await createMessage(mockChatId, { content: 'New message content' });

			expect(get(messages)).toContainEqual(newMessage);
			expect(ChatService.updateSummary).toHaveBeenCalledWith(mockChatId, {
				lastMessagePreview: 'New message content',
				messageCount: 1
			});
			expect(get(activeChat)).toMatchObject({ lastMessagePreview: 'New...' });
		});
	});

	describe('updateMessage', () => {
		it('should update message content', async () => {
			messages.set([mockMessage]);
			const updatedMsg = { ...mockMessage, content: 'Updated' };
			vi.mocked(MessageService.update).mockResolvedValue(updatedMsg);

			await updateMessage('msg-1', { content: 'Updated' });

			expect(get(messages)[0].content).toBe('Updated');
		});

		it('should update chat preview if it is the last message', async () => {
			messages.set([mockMessage]);
			const updatedMsg = { ...mockMessage, content: 'Last updated' };
			vi.mocked(MessageService.update).mockResolvedValue(updatedMsg);
			vi.mocked(ChatService.updateSummary).mockResolvedValue({ id: mockChatId } as Chat);

			await updateMessage('msg-1', { content: 'Last updated' });

			expect(ChatService.updateSummary).toHaveBeenCalled();
		});
	});

	describe('deleteMessage', () => {
		it('should remove message from store', async () => {
			messages.set([mockMessage]);
			vi.mocked(MessageService.delete).mockResolvedValue(undefined);

			await deleteMessage(mockChatId, 'msg-1');

			expect(get(messages)).toHaveLength(0);
			expect(ChatService.updateSummary).toHaveBeenCalledWith(mockChatId, {
				lastMessagePreview: '',
				messageCount: 0
			});
		});
	});
});
