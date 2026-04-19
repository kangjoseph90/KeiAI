import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	loadInitialMessages,
	loadOlderMessages,
	loadNewerMessages,
	createMessage,
	updateMessage,
	deleteMessage,
	getMessage
} from '$lib/stores/content/message';
import { messages, messageMap, chats, activeChat } from '$lib/stores/state';
import {
	MessageService,
	ChatService,
	type Message,
	type Chat,
	type ChatDetail
} from '$lib/services';

// Mock Services
vi.mock('$lib/services', () => ({
	MessageService: {
		getMessagesBefore: vi.fn(),
		getMessagesAfter: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
		get: vi.fn()
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
		swipes: { s1: { id: 's1', content: 'Hello', createdAt: 1000 } },
		activeSwipeId: 's1',
		sortOrder: 'a'
	};

	beforeEach(() => {
		vi.clearAllMocks();
		// Reset via messageMap (the writable source)
		messageMap.set(new Map());
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
		it('loadOlderMessages should prepend older messages (sorted via derived)', async () => {
			// sortOrder 'a' — existing message
			messageMap.set(new Map([['msg-1', mockMessage]]));
			const olderMsg = { ...mockMessage, id: 'msg-old', sortOrder: '0' };
			vi.mocked(MessageService.getMessagesBefore).mockResolvedValue([olderMsg]);

			await loadOlderMessages(mockChatId);

			expect(MessageService.getMessagesBefore).toHaveBeenCalledWith(mockChatId, 'a', 50);
			// derived store sorts by sortOrder: '0' < 'a'
			expect(get(messages)).toEqual([olderMsg, mockMessage]);
		});

		it('loadNewerMessages should append newer messages (sorted via derived)', async () => {
			messageMap.set(new Map([['msg-1', mockMessage]]));
			const newerMsg = { ...mockMessage, id: 'msg-new', sortOrder: 'b' };
			vi.mocked(MessageService.getMessagesAfter).mockResolvedValue([newerMsg]);

			await loadNewerMessages(mockChatId);

			expect(MessageService.getMessagesAfter).toHaveBeenCalledWith(mockChatId, 'a', 50);
			// derived store sorts by sortOrder: 'a' < 'b'
			expect(get(messages)).toEqual([mockMessage, newerMsg]);
		});
	});

	describe('getMessage', () => {
		it('should return from store cache without hitting IDB', async () => {
			messageMap.set(new Map([['msg-1', mockMessage]]));

			const result = await getMessage('msg-1');

			expect(result).toEqual(mockMessage);
			expect(MessageService.get).not.toHaveBeenCalled();
		});

		it('should fall back to IDB if not in cache', async () => {
			vi.mocked(MessageService.get).mockResolvedValue(mockMessage);

			const result = await getMessage('msg-1');

			expect(result).toEqual(mockMessage);
			expect(MessageService.get).toHaveBeenCalledWith('msg-1');
		});

		it('should throw NOT_FOUND if not in cache and not in IDB', async () => {
			vi.mocked(MessageService.get).mockResolvedValue(null);

			await expect(getMessage('missing-id')).rejects.toMatchObject({ code: 'NOT_FOUND' });
		});
	});

	describe('createMessage', () => {
		it('should create message and update chat preview', async () => {
			const newMessage = { ...mockMessage, id: 'new-id' };
			const updatedChat = { id: mockChatId, lastMessagePreview: 'New...' } as Chat;

			vi.mocked(MessageService.create).mockResolvedValue(newMessage);
			vi.mocked(ChatService.updateSummary).mockResolvedValue(updatedChat);
			chats.set([{ id: mockChatId } as Chat]);

			await createMessage(mockChatId, {
				swipes: { s1: { id: 's1', content: 'New message content', createdAt: Date.now() } },
				activeSwipeId: 's1'
			});

			expect(get(messages)).toContainEqual(newMessage);
			expect(ChatService.updateSummary).toHaveBeenCalledWith(mockChatId, {
				lastMessagePreview: 'New message content',
				messageCount: 1
			});
			expect(get(activeChat)).toMatchObject({ lastMessagePreview: 'New...' });
		});
	});

	describe('updateMessage', () => {
		it('should update message swipes in messageMap', async () => {
			messageMap.set(new Map([['msg-1', mockMessage]]));
			const updatedMsg: Message = {
				...mockMessage,
				swipes: { s1: { id: 's1', content: 'Updated', createdAt: 2000 } }
			};
			vi.mocked(MessageService.update).mockResolvedValue(updatedMsg);

			await updateMessage('msg-1', {
				swipes: { s1: { id: 's1', content: 'Updated', createdAt: 2000 } }
			});

			expect(get(messages)[0].swipes['s1'].content).toBe('Updated');
			// O(1) lookup: verify Map contains updated value
			expect(get(messageMap).get('msg-1')?.swipes['s1'].content).toBe('Updated');
		});

		it('should update chat preview if it is the last message', async () => {
			messageMap.set(new Map([['msg-1', mockMessage]]));
			const updatedMsg: Message = {
				...mockMessage,
				swipes: { s1: { id: 's1', content: 'Last updated', createdAt: 2000 } }
			};
			vi.mocked(MessageService.update).mockResolvedValue(updatedMsg);
			vi.mocked(ChatService.updateSummary).mockResolvedValue({ id: mockChatId } as Chat);

			await updateMessage('msg-1', {
				swipes: { s1: { id: 's1', content: 'Last updated', createdAt: 2000 } }
			});

			expect(ChatService.updateSummary).toHaveBeenCalled();
		});
	});

	describe('deleteMessage', () => {
		it('should remove message from messageMap', async () => {
			messageMap.set(new Map([['msg-1', mockMessage]]));
			vi.mocked(MessageService.delete).mockResolvedValue(undefined);

			await deleteMessage(mockChatId, 'msg-1');

			expect(get(messages)).toHaveLength(0);
			expect(get(messageMap).has('msg-1')).toBe(false);
			expect(ChatService.updateSummary).toHaveBeenCalledWith(mockChatId, {
				lastMessagePreview: '',
				messageCount: 0
			});
		});
	});
});
