/**
 * Chat Service Tests
 *
 * Tests the ChatService which handles chat CRUD operations
 * with encryption and database transactions.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatService } from '$lib/services/content/chat';
import type {
	Chat,
	ChatDetail,
	ChatSummaryFields,
	ChatDataFields
} from '$lib/services/content/chat';
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
		getByIndex: vi.fn(),
		getRecord: vi.fn(),
		putRecord: vi.fn(),
		transaction: vi.fn(),
		softDeleteRecord: vi.fn(),
		softDeleteByIndex: vi.fn()
	}
}));

vi.mock('$lib/utils/id', () => ({
	generateId: vi.fn(() => 'test-chat-id')
}));

vi.mock('$lib/utils/defaults', () => ({
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

import { encrypt, decrypt } from '$lib/crypto';
import { getActiveSession } from '$lib/services/session';
import { localDB } from '$lib/adapters/db';
import { generateId } from '$lib/utils/id';
import { deepMerge } from '$lib/utils/defaults';

describe('ChatService', () => {
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
			isGuest: false,
			identityKeyPair: {} as CryptoKeyPair
		});

		// Default encrypt mock
		vi.mocked(encrypt).mockResolvedValue({
			ciphertext: mockEncryptedData,
			iv: mockIV
		});

		// Default decrypt mock
		vi.mocked(decrypt).mockResolvedValue(
			JSON.stringify({ title: 'Test Chat', lastMessagePreview: 'Hello', messageCount: 0 })
		);

		// Default deepMerge mock
		vi.mocked(deepMerge).mockImplementation((target: unknown, source: unknown) => ({
			...(target as Record<string, unknown>),
			...(source as Record<string, unknown>)
		}));

		// Default generateId mock
		vi.mocked(generateId).mockReturnValue('test-chat-id');
	});

	describe('listByCharacter', () => {
		it('should return list of chats for a character', async () => {
			const mockRecords = [
				{
					id: 'chat-1',
					characterId: 'char-1',
					userId: mockUserId,
					createdAt: 1000,
					updatedAt: 1000,
					isDeleted: false,
					encryptedData: new Uint8Array([1]),
					encryptedDataIV: new Uint8Array([2])
				} as unknown as BaseRecord,
				{
					id: 'chat-2',
					characterId: 'char-1',
					userId: mockUserId,
					createdAt: 2000,
					updatedAt: 2000,
					isDeleted: false,
					encryptedData: new Uint8Array([3]),
					encryptedDataIV: new Uint8Array([4])
				} as unknown as BaseRecord
			] as BaseRecord[];

			vi.mocked(localDB.getByIndex).mockResolvedValue(mockRecords);
			vi.mocked(decrypt)
				.mockResolvedValueOnce(
					JSON.stringify({ title: 'Chat 1', lastMessagePreview: 'Msg 1', messageCount: 0 })
				)
				.mockResolvedValueOnce(
					JSON.stringify({ title: 'Chat 2', lastMessagePreview: 'Msg 2', messageCount: 0 })
				);

			const result = await ChatService.listByCharacter('char-1');

			expect(result).toHaveLength(2);
			expect(result[0].id).toBe('chat-1');
			expect(result[0].title).toBe('Chat 1');
			expect(result[1].id).toBe('chat-2');
			expect(result[1].title).toBe('Chat 2');
		});

		it('should return empty array when no chats exist', async () => {
			vi.mocked(localDB.getByIndex).mockResolvedValue([]);

			const result = await ChatService.listByCharacter('char-1');

			expect(result).toEqual([]);
		});

		it('should call getByIndex with correct parameters', async () => {
			vi.mocked(localDB.getByIndex).mockResolvedValue([]);
			vi.mocked(decrypt).mockResolvedValue(JSON.stringify({ title: 'Test' }));

			await ChatService.listByCharacter('char-123');

			expect(localDB.getByIndex).toHaveBeenCalledWith(
				'chatSummaries',
				'characterId',
				'char-123',
				Number.MAX_SAFE_INTEGER
			);
		});
	});

	describe('getDetail', () => {
		it('should return full chat detail when both records exist', async () => {
			const mockSummary = {
				id: 'chat-1',
				characterId: 'char-1',
				userId: mockUserId,
				createdAt: 1000,
				updatedAt: 1000,
				isDeleted: false,
				encryptedData: new Uint8Array([1]),
				encryptedDataIV: new Uint8Array([2])
			} as unknown as BaseRecord;
			const mockData = {
				id: 'chat-1',
				characterId: 'char-1',
				userId: mockUserId,
				createdAt: 1000,
				updatedAt: 1000,
				isDeleted: false,
				encryptedData: new Uint8Array([3]),
				encryptedDataIV: new Uint8Array([4])
			} as unknown as BaseRecord;

			vi.mocked(localDB.getRecord)
				.mockResolvedValueOnce(mockSummary)
				.mockResolvedValueOnce(mockData);

			vi.mocked(decrypt)
				.mockResolvedValueOnce(
					JSON.stringify({ title: 'Test Chat', lastMessagePreview: 'Hi', messageCount: 0 })
				)
				.mockResolvedValueOnce(JSON.stringify({ systemPromptOverride: 'Override' }));

			const result = await ChatService.getDetail('chat-1');

			expect(result).not.toBeNull();
			expect(result?.id).toBe('chat-1');
			expect(result?.title).toBe('Test Chat');
			expect(result?.data.systemPromptOverride).toBe('Override');
		});

		it('should return null when summary record does not exist', async () => {
			vi.mocked(localDB.getRecord).mockResolvedValue(undefined as unknown as BaseRecord);

			const result = await ChatService.getDetail('non-existent');

			expect(result).toBeNull();
		});

		it('should return null when summary record is deleted', async () => {
			vi.mocked(localDB.getRecord).mockResolvedValue({
				id: 'chat-1',
				userId: mockUserId,
				createdAt: 1000,
				updatedAt: 1000,
				isDeleted: true,
				encryptedData: new Uint8Array([1]),
				encryptedDataIV: new Uint8Array([2])
			} as unknown as BaseRecord);

			const result = await ChatService.getDetail('chat-1');

			expect(result).toBeNull();
		});
	});

	describe('create', () => {
		it('should create a new chat for a character', async () => {
			vi.mocked(localDB.transaction).mockImplementation(async (_tables, _mode, callback) => {
				await callback();
			});

			const result = await ChatService.create('char-1', { title: 'New Chat' });

			expect(result.id).toBe('test-chat-id');
			expect(result.characterId).toBe('char-1');
			expect(result.title).toBe('New Chat');

			expect(localDB.transaction).toHaveBeenCalledWith(
				['chatSummaries', 'chatData'],
				'rw',
				expect.any(Function)
			);
		});

		it('should use default values when not provided', async () => {
			vi.mocked(deepMerge).mockImplementation((target: unknown, source: unknown) => ({
				...(target as Record<string, unknown>),
				...(source as Record<string, unknown>)
			}));

			const result = await ChatService.create('char-1');

			expect(result.title).toBe('New Chat');
			expect(result.data).toEqual({});
		});
	});

	describe('updateSummary', () => {
		it('should update chat summary fields', async () => {
			const existingRecord = {
				id: 'chat-1',
				characterId: 'char-1',
				userId: mockUserId,
				createdAt: 1000,
				updatedAt: 1000,
				isDeleted: false,
				encryptedData: new Uint8Array([1]),
				encryptedDataIV: new Uint8Array([2])
			} as unknown as BaseRecord;

			vi.mocked(localDB.getRecord).mockResolvedValue(existingRecord);
			vi.mocked(decrypt).mockResolvedValue(
				JSON.stringify({ title: 'Old Title', lastMessagePreview: 'Old', messageCount: 5 })
			);
			vi.mocked(encrypt).mockResolvedValue({
				ciphertext: new Uint8Array([99]),
				iv: new Uint8Array([88])
			});

			const result = await ChatService.updateSummary('chat-1', { title: 'New Title' });

			expect(result.title).toBe('New Title');
			expect(localDB.putRecord).not.toHaveBeenCalled();
		});

		it('should throw NOT_FOUND when chat does not exist', async () => {
			vi.mocked(localDB.getRecord).mockResolvedValue(undefined as unknown as BaseRecord);

			await expect(ChatService.updateSummary('non-existent', { title: 'New' })).rejects.toThrow();
		});
	});

	describe('updateData', () => {
		it('should update chat data fields', async () => {
			const existingRecord = {
				id: 'chat-1',
				characterId: 'char-1',
				userId: mockUserId,
				createdAt: 1000,
				updatedAt: 1000,
				isDeleted: false,
				encryptedData: new Uint8Array([1]),
				encryptedDataIV: new Uint8Array([2])
			} as unknown as BaseRecord;

			vi.mocked(localDB.getRecord).mockResolvedValue(existingRecord);
			vi.mocked(decrypt).mockResolvedValue(JSON.stringify({ variables: { old: 'value' } }));
			vi.mocked(encrypt).mockResolvedValue({
				ciphertext: new Uint8Array([99]),
				iv: new Uint8Array([88])
			});

			const result = await ChatService.updateData('chat-1', { variables: { new: 'value' } });

			expect(result.variables).toEqual({ new: 'value' });
			expect(localDB.putRecord).not.toHaveBeenCalled();
		});
	});

	describe('update (combined)', () => {
		it('should update both summary and data in a transaction', async () => {
			const mockSummary = {
				id: 'chat-1',
				characterId: 'char-1',
				userId: mockUserId,
				createdAt: 1000,
				updatedAt: 1000,
				isDeleted: false,
				encryptedData: new Uint8Array([1]),
				encryptedDataIV: new Uint8Array([2])
			} as unknown as BaseRecord;
			const mockData = {
				id: 'chat-1',
				characterId: 'char-1',
				userId: mockUserId,
				createdAt: 1000,
				updatedAt: 1000,
				isDeleted: false,
				encryptedData: new Uint8Array([3]),
				encryptedDataIV: new Uint8Array([4])
			} as unknown as BaseRecord;

			vi.mocked(localDB.getRecord).mockImplementation(async (table, id) => {
				if (table === 'chatSummaries') return mockSummary;
				return mockData;
			});

			vi.mocked(decrypt)
				.mockResolvedValue(JSON.stringify({ title: 'Old', lastMessagePreview: '' }))
				.mockResolvedValue(JSON.stringify({ title: 'Old', lastMessagePreview: '' }))
				.mockResolvedValue(JSON.stringify({ systemPromptOverride: 'Old' }))
				.mockResolvedValue(JSON.stringify({ systemPromptOverride: 'Old' }));

			vi.mocked(encrypt).mockResolvedValue({
				ciphertext: new Uint8Array([99]),
				iv: new Uint8Array([88])
			});

			vi.mocked(localDB.transaction).mockImplementation(async (_tables, _mode, callback) => {
				await callback();
			});

			const result = await ChatService.update(
				'chat-1',
				{ title: 'New' },
				{
					systemPromptOverride: 'New Override'
				}
			);

			expect(result.title).toBe('New');
			expect(result.data.systemPromptOverride).toBe('New Override');
		});
	});

	describe('delete', () => {
		it('should soft delete chat and related data', async () => {
			vi.mocked(localDB.transaction).mockImplementation(async (_tables, _mode, callback) => {
				await callback();
			});

			await ChatService.delete('chat-1');

			expect(localDB.transaction).toHaveBeenCalledWith(
				['lorebooks', 'scripts', 'messages', 'chatSummaries', 'chatData', 'toolCalls'],
				'rw',
				expect.any(Function)
			);
		});

		it('should soft delete related lorebooks, scripts, and messages', async () => {
			vi.mocked(localDB.transaction).mockImplementation(async (_tables, _mode, callback) => {
				await callback();
			});

			await ChatService.delete('chat-1');

			expect(localDB.softDeleteByIndex).toHaveBeenCalledWith('lorebooks', 'ownerId', 'chat-1');
			expect(localDB.softDeleteByIndex).toHaveBeenCalledWith('scripts', 'ownerId', 'chat-1');
			expect(localDB.softDeleteByIndex).toHaveBeenCalledWith('messages', 'chatId', 'chat-1');
		});
	});
});
