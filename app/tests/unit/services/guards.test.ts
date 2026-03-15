/**
 * Guards Tests
 *
 * Tests the assertion guards used for validating resource existence and ownership.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as guards from '$lib/services/content/guards';
import {
	localDB,
	type ChatSummaryRecord,
	type CharacterSummaryRecord,
	type LorebookRecord,
	type ScriptRecord,
	type MessageRecord
} from '$lib/adapters/db';
import { AppError } from '$lib/types/errors';

// Mock localDB
vi.mock('$lib/adapters/db', () => ({
	localDB: {
		getRecord: vi.fn()
	}
}));

describe('Guards', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('assertCharacterExists', () => {
		it('should pass if character exists and not deleted', async () => {
			vi.mocked(localDB.getRecord).mockResolvedValue({
				id: 'char-1',
				userId: 'u1',
				createdAt: 0,
				updatedAt: 0,
				isDeleted: false
			});
			await expect(guards.assertCharacterExists('char-1')).resolves.not.toThrow();
		});

		it('should throw NOT_FOUND if character missing', async () => {
			vi.mocked(localDB.getRecord).mockResolvedValue(undefined);
			await expect(guards.assertCharacterExists('none')).rejects.toThrow(AppError);
			await expect(guards.assertCharacterExists('none')).rejects.toThrow(/Character not found/);
		});
	});

	describe('assertChatOwnedByCharacter', () => {
		it('should pass if owner matches', async () => {
			vi.mocked(localDB.getRecord).mockResolvedValue({
				id: 'chat-1',
				userId: 'u1',
				createdAt: 0,
				updatedAt: 0,
				characterId: 'char-1',
				isDeleted: false
			} as ChatSummaryRecord);
			await expect(guards.assertChatOwnedByCharacter('chat-1', 'char-1')).resolves.not.toThrow();
		});

		it('should throw OWNERSHIP_VIOLATION if owner differs', async () => {
			vi.mocked(localDB.getRecord).mockResolvedValue({
				id: 'chat-1',
				userId: 'u1',
				createdAt: 0,
				updatedAt: 0,
				characterId: 'other',
				isDeleted: false
			} as ChatSummaryRecord);
			await expect(guards.assertChatOwnedByCharacter('chat-1', 'char-1')).rejects.toThrow(AppError);
			await expect(guards.assertChatOwnedByCharacter('chat-1', 'char-1')).rejects.toThrow(
				/does not belong to character/
			);
		});
	});

	describe('assertOwnedResourceParentExists', () => {
		it('should pass if at least one parent type exists', async () => {
			vi.mocked(localDB.getRecord).mockImplementation((table) => {
				if (table === 'characterSummaries')
					return Promise.resolve({
						id: 'id',
						userId: 'u1',
						createdAt: 0,
						updatedAt: 0,
						isDeleted: false
					});
				return Promise.resolve(undefined);
			});
			await expect(guards.assertOwnedResourceParentExists('id')).resolves.not.toThrow();
		});

		it('should throw if no parent exists', async () => {
			vi.mocked(localDB.getRecord).mockResolvedValue(undefined);
			await expect(guards.assertOwnedResourceParentExists('none')).rejects.toThrow(AppError);
		});
	});

	describe('assertLorebookOwnedBy', () => {
		it('should pass if owner matches', async () => {
			vi.mocked(localDB.getRecord).mockResolvedValue({
				id: 'lb-1',
				userId: 'u1',
				createdAt: 0,
				updatedAt: 0,
				ownerId: 'owner-1',
				isDeleted: false
			} as LorebookRecord);
			await expect(guards.assertLorebookOwnedBy('owner-1', 'lb-1')).resolves.not.toThrow();
		});

		it('should throw OWNERSHIP_VIOLATION if owner differs', async () => {
			vi.mocked(localDB.getRecord).mockResolvedValue({
				id: 'lb-1',
				userId: 'u1',
				createdAt: 0,
				updatedAt: 0,
				ownerId: 'other',
				isDeleted: false
			} as LorebookRecord);
			await expect(guards.assertLorebookOwnedBy('owner-1', 'lb-1')).rejects.toThrow(AppError);
		});
	});

	describe('assertMessageInChat', () => {
		it('should pass if message in chat', async () => {
			vi.mocked(localDB.getRecord).mockResolvedValue({
				id: 'msg-1',
				userId: 'u1',
				createdAt: 0,
				updatedAt: 0,
				chatId: 'chat-1',
				isDeleted: false
			} as MessageRecord);
			await expect(guards.assertMessageInChat('chat-1', 'msg-1')).resolves.not.toThrow();
		});

		it('should throw OWNERSHIP_VIOLATION if wrong chat', async () => {
			vi.mocked(localDB.getRecord).mockResolvedValue({
				id: 'msg-1',
				userId: 'u1',
				createdAt: 0,
				updatedAt: 0,
				chatId: 'other',
				isDeleted: false
			} as MessageRecord);
			await expect(guards.assertMessageInChat('chat-1', 'msg-1')).rejects.toThrow(AppError);
		});
	});
});
