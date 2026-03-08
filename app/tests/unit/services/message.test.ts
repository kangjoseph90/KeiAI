/**
 * Message Service Tests
 *
 * Tests the MessageService which handles message CRUD operations
 * with encryption, pagination, and fractional indexing for sortOrder.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageService } from '$lib/services/content/message';
import type { Message, MessageFields } from '$lib/services/content/message';
import type { BaseRecord } from '$lib/adapters/db/types';

// Mock all dependencies
vi.mock('$lib/crypto', () => ({
	encrypt: vi.fn(),
	decrypt: vi.fn()
}));

vi.mock('$lib/services/session', () => ({
	getActiveSession: vi.fn()
}));

vi.mock('$lib/adapters/db', () => ({
	localDB: {
		getRecordsBackward: vi.fn(),
		getRecordsForward: vi.fn(),
		getRecord: vi.fn(),
		putRecord: vi.fn(),
		softDeleteRecord: vi.fn()
	}
}));

vi.mock('$lib/services/sync', () => ({
	DataSyncService: {
		pushRecord: vi.fn(),
		pushById: vi.fn()
	}
}));

vi.mock('$lib/services/content/guards', () => ({
	assertChatExists: vi.fn(),
	assertMessageInChat: vi.fn()
}));

vi.mock('$lib/shared/id', () => ({
	generateId: vi.fn(() => 'test-msg-id')
}));

vi.mock('$lib/shared/defaults', () => ({
	deepMerge: vi.fn((target: unknown, source: unknown) => {
		if (
			typeof target === 'object' &&
			target !== null &&
			typeof source === 'object' &&
			source !== null
		) {
			return { ...target, ...source };
		}
		return source ?? target;
	})
}));

vi.mock('fractional-indexing', () => ({
	generateKeyBetween: vi.fn((a: string | null, b: string | null) => 'a0')
}));

import { encrypt, decrypt } from '$lib/crypto';
import { getActiveSession } from '$lib/services/session';
import { localDB } from '$lib/adapters/db';
import { DataSyncService } from '$lib/services/sync';
import { assertChatExists, assertMessageInChat } from '$lib/services/content/guards';
import { generateId } from '$lib/shared/id';
import { deepMerge } from '$lib/shared/defaults';
import { generateKeyBetween } from 'fractional-indexing';

describe('MessageService', () => {
	const mockMasterKey = {} as CryptoKey;
	const mockUserId = 'user-123';
	const mockEncryptedData = new Uint8Array([1, 2, 3]);
	const mockIV = new Uint8Array([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

	beforeEach(() => {
		vi.clearAllMocks();

		// Default session mock
		vi.mocked(getActiveSession).mockReturnValue({
			masterKey: mockMasterKey,
			userId: mockUserId,
			isGuest: false
		});

		// Default encrypt mock
		vi.mocked(encrypt).mockResolvedValue({
			ciphertext: mockEncryptedData,
			iv: mockIV
		});

		// Default decrypt mock
		vi.mocked(decrypt).mockResolvedValue(JSON.stringify({ role: 'user', content: 'Hello' }));

		// Default deepMerge mock
		vi.mocked(deepMerge).mockImplementation((target: unknown, source: unknown) => ({
			...(target as Record<string, unknown>),
			...(source as Record<string, unknown>)
		}));

		// Default generateId mock
		vi.mocked(generateId).mockReturnValue('test-msg-id');

		// Default generateKeyBetween mock
		vi.mocked(generateKeyBetween).mockReturnValue('a0');

		// Guards pass by default
		vi.mocked(assertChatExists).mockResolvedValue(undefined);
		vi.mocked(assertMessageInChat).mockResolvedValue(undefined);

		// DataSyncService void calls
		vi.mocked(DataSyncService.pushRecord).mockResolvedValue(undefined);
		vi.mocked(DataSyncService.pushById).mockResolvedValue(undefined);
	});

	describe('getMessagesBefore (pagination)', () => {
		it('should return messages before a cursor (older messages)', async () => {
			// getRecordsBackward returns newest first, then service reverses to oldest first
			const mockRecords = [
				{
					id: 'msg-2',
					chatId: 'chat-1',
					sortOrder: 'a1',
					userId: mockUserId,
					createdAt: 2000,
					updatedAt: 2000,
					isDeleted: false,
					encryptedData: new Uint8Array([3]),
					encryptedDataIV: new Uint8Array([4])
				} as unknown as BaseRecord,
				{
					id: 'msg-1',
					chatId: 'chat-1',
					sortOrder: 'a0',
					userId: mockUserId,
					createdAt: 1000,
					updatedAt: 1000,
					isDeleted: false,
					encryptedData: new Uint8Array([1]),
					encryptedDataIV: new Uint8Array([2])
				} as unknown as BaseRecord
			] as BaseRecord[];

			vi.mocked(localDB.getRecordsBackward).mockResolvedValue(mockRecords);
			vi.mocked(decrypt)
				.mockResolvedValueOnce(JSON.stringify({ role: 'user', content: 'Msg 1' }))
				.mockResolvedValueOnce(JSON.stringify({ role: 'char', content: 'Msg 2' }));

			const result = await MessageService.getMessagesBefore('chat-1', 'a1', 10);

			expect(result).toHaveLength(2);
			expect(result[0].id).toBe('msg-1');
			expect(result[1].id).toBe('msg-2');
		});

		it('should use default cursor when not provided', async () => {
			vi.mocked(localDB.getRecordsBackward).mockResolvedValue([]);
			vi.mocked(decrypt).mockResolvedValue(JSON.stringify({ role: 'user', content: 'Hi' }));

			await MessageService.getMessagesBefore('chat-1');

			expect(localDB.getRecordsBackward).toHaveBeenCalledWith(
				'messages',
				'[chatId+sortOrder]',
				['chat-1', ''],
				['chat-1', '\uffff'],
				50
			);
		});

		it('should respect custom limit', async () => {
			vi.mocked(localDB.getRecordsBackward).mockResolvedValue([]);
			vi.mocked(decrypt).mockResolvedValue(JSON.stringify({ role: 'user', content: 'Hi' }));

			await MessageService.getMessagesBefore('chat-1', 'a0', 100);

			expect(localDB.getRecordsBackward).toHaveBeenCalledWith(
				'messages',
				'[chatId+sortOrder]',
				['chat-1', ''],
				['chat-1', 'a0'],
				100
			);
		});
	});

	describe('getMessagesAfter (pagination)', () => {
		it('should return messages after a cursor (newer messages)', async () => {
			const mockRecords = [
				{
					id: 'msg-1',
					chatId: 'chat-1',
					sortOrder: 'a0',
					userId: mockUserId,
					createdAt: 1000,
					updatedAt: 1000,
					isDeleted: false,
					encryptedData: new Uint8Array([1]),
					encryptedDataIV: new Uint8Array([2])
				} as unknown as BaseRecord,
				{
					id: 'msg-2',
					chatId: 'chat-1',
					sortOrder: 'a1',
					userId: mockUserId,
					createdAt: 2000,
					updatedAt: 2000,
					isDeleted: false,
					encryptedData: new Uint8Array([3]),
					encryptedDataIV: new Uint8Array([4])
				} as unknown as BaseRecord
			] as BaseRecord[];

			vi.mocked(localDB.getRecordsForward).mockResolvedValue(mockRecords);
			vi.mocked(decrypt)
				.mockResolvedValueOnce(JSON.stringify({ role: 'user', content: 'Msg 1' }))
				.mockResolvedValueOnce(JSON.stringify({ role: 'char', content: 'Msg 2' }));

			const result = await MessageService.getMessagesAfter('chat-1', 'a0', 10);

			expect(result).toHaveLength(2);
			expect(result[0].id).toBe('msg-1');
			expect(result[1].id).toBe('msg-2');
		});
	});

	describe('get', () => {
		it('should return a message by id', async () => {
			const mockRecord = {
				id: 'msg-1',
				chatId: 'chat-1',
				sortOrder: 'a0',
				userId: mockUserId,
				createdAt: 1000,
				updatedAt: 1000,
				isDeleted: false,
				encryptedData: new Uint8Array([1]),
				encryptedDataIV: new Uint8Array([2])
			} as unknown as BaseRecord;

			vi.mocked(localDB.getRecord).mockResolvedValue(mockRecord);
			vi.mocked(decrypt).mockResolvedValue(JSON.stringify({ role: 'user', content: 'Hello' }));

			const result = await MessageService.get('msg-1');

			expect(result).not.toBeNull();
			expect(result?.id).toBe('msg-1');
			expect(result?.role).toBe('user');
			expect(result?.content).toBe('Hello');
		});

		it('should return null when message does not exist', async () => {
			vi.mocked(localDB.getRecord).mockResolvedValue(undefined as unknown as BaseRecord);

			const result = await MessageService.get('non-existent');

			expect(result).toBeNull();
		});

		it('should return null when message is deleted', async () => {
			vi.mocked(localDB.getRecord).mockResolvedValue({
				id: 'msg-1',
				chatId: 'chat-1',
				sortOrder: 'a0',
				userId: mockUserId,
				createdAt: 1000,
				updatedAt: 1000,
				isDeleted: true,
				encryptedData: new Uint8Array([1]),
				encryptedDataIV: new Uint8Array([2])
			} as unknown as BaseRecord);

			const result = await MessageService.get('msg-1');

			expect(result).toBeNull();
		});
	});

	describe('create', () => {
		it('should create a message with auto-generated sortOrder', async () => {
			vi.mocked(localDB.getRecordsBackward).mockResolvedValue([]);
			vi.mocked(generateKeyBetween).mockReturnValue('a0');

			const result = await MessageService.create('chat-1', { role: 'user', content: 'Hi' });

			expect(result.id).toBe('test-msg-id');
			expect(result.chatId).toBe('chat-1');
			expect(result.role).toBe('user');
			expect(result.content).toBe('Hi');
			expect(result.sortOrder).toBe('a0');

			expect(assertChatExists).toHaveBeenCalledWith('chat-1');
			expect(generateKeyBetween).toHaveBeenCalledWith(null, null);
		});

		it('should use provided sortOrder when given', async () => {
			vi.mocked(localDB.getRecordsBackward).mockResolvedValue([]);

			const result = await MessageService.create(
				'chat-1',
				{ role: 'char', content: 'Hello' },
				'a5'
			);

			expect(result.sortOrder).toBe('a5');
			// Should not call generateKeyBetween when sortOrder is provided
			expect(generateKeyBetween).not.toHaveBeenCalled();
		});

		it('should generate sortOrder after last message when not provided', async () => {
			const lastRecords = [
				{
					id: 'msg-last',
					chatId: 'chat-1',
					sortOrder: 'a5',
					userId: mockUserId,
					createdAt: 1000,
					updatedAt: 1000,
					isDeleted: false,
					encryptedData: new Uint8Array([1]),
					encryptedDataIV: new Uint8Array([2])
				} as unknown as BaseRecord
			] as BaseRecord[];

			vi.mocked(localDB.getRecordsBackward).mockResolvedValue(lastRecords);
			vi.mocked(generateKeyBetween).mockReturnValue('a6');

			const result = await MessageService.create('chat-1', { role: 'user', content: 'Next' });

			expect(result.sortOrder).toBe('a6');
			expect(generateKeyBetween).toHaveBeenCalledWith('a5', null);
		});
	});

	describe('update', () => {
		it('should update message content', async () => {
			const existingRecord = {
				id: 'msg-1',
				chatId: 'chat-1',
				sortOrder: 'a0',
				userId: mockUserId,
				createdAt: 1000,
				updatedAt: 1000,
				isDeleted: false,
				encryptedData: new Uint8Array([1]),
				encryptedDataIV: new Uint8Array([2])
			} as unknown as BaseRecord;

			vi.mocked(localDB.getRecord).mockResolvedValue(existingRecord);
			vi.mocked(decrypt).mockResolvedValue(JSON.stringify({ role: 'user', content: 'Old' }));
			vi.mocked(encrypt).mockResolvedValue({
				ciphertext: new Uint8Array([99]),
				iv: new Uint8Array([88])
			});

			const result = await MessageService.update('msg-1', { content: 'New content' });

			expect(result.content).toBe('New content');
			expect(localDB.putRecord).toHaveBeenCalledWith('messages', {
				...existingRecord,
				encryptedData: new Uint8Array([99]),
				encryptedDataIV: new Uint8Array([88]),
				updatedAt: expect.any(Number)
			} as unknown as BaseRecord);
		});

		it('should verify chat ownership when expectedChatId is provided', async () => {
			vi.mocked(localDB.getRecord).mockResolvedValue({
				id: 'msg-1',
				chatId: 'chat-1',
				sortOrder: 'a0',
				userId: mockUserId,
				createdAt: 1000,
				updatedAt: 1000,
				isDeleted: false,
				encryptedData: new Uint8Array([1]),
				encryptedDataIV: new Uint8Array([2])
			} as unknown as BaseRecord);

			await MessageService.update('msg-1', { content: 'New' }, 'chat-1');

			expect(assertMessageInChat).toHaveBeenCalledWith('chat-1', 'msg-1');
		});

		it('should throw NOT_FOUND when message does not exist', async () => {
			vi.mocked(localDB.getRecord).mockResolvedValue(undefined as unknown as BaseRecord);

			await expect(MessageService.update('non-existent', { content: 'New' })).rejects.toThrow();
		});
	});

	describe('delete', () => {
		it('should soft delete a message', async () => {
			await MessageService.delete('msg-1');

			expect(localDB.softDeleteRecord).toHaveBeenCalledWith('messages', 'msg-1');
			expect(DataSyncService.pushById).toHaveBeenCalledWith('messages', 'msg-1');
		});

		it('should verify chat ownership when expectedChatId is provided', async () => {
			await MessageService.delete('msg-1', 'chat-1');

			expect(assertMessageInChat).toHaveBeenCalledWith('chat-1', 'msg-1');
		});
	});
});
