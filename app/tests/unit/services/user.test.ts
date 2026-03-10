/**
 * User Service Tests
 *
 * Tests the UserService which handles local user lifecycle (boot, guest creation,
 * login save, account unlink, and data cleanup).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserService } from '$lib/services/user/user';
import type { UserRecord } from '$lib/adapters/user';
import type { AssetRecord } from '$lib/adapters/db/types';

// Mock all dependencies
vi.mock('$lib/adapters/user', () => ({
	appUser: {
		getUser: vi.fn(),
		getAllUsers: vi.fn(),
		saveUser: vi.fn(),
		deleteUser: vi.fn()
	}
}));

vi.mock('$lib/adapters/db', () => ({
	localDB: {
		getAll: vi.fn(),
		deleteByIndex: vi.fn()
	},
	TABLES: ['messages', 'chatSummaries'],
	SYNC_TABLES: ['messages']
}));

vi.mock('$lib/adapters/storage', () => ({
	appStorage: {
		delete: vi.fn()
	}
}));

vi.mock('$lib/adapters/asset/index', () => ({
	appAsset: {
		delete: vi.fn()
	}
}));

vi.mock('$lib/adapters/kv', () => ({
	appKV: {
		get: vi.fn(),
		set: vi.fn(),
		remove: vi.fn()
	}
}));

vi.mock('$lib/crypto', () => ({
	generateMasterKey: vi.fn()
}));

vi.mock('$lib/shared/id', () => ({
	generateId: vi.fn(() => 'test-guest-id')
}));

vi.mock('$lib/services/session', () => ({
	setSession: vi.fn()
}));

vi.mock('minidenticons', () => ({
	minidenticon: vi.fn((seed) => `<svg>${seed}</svg>`)
}));

import { appUser } from '$lib/adapters/user';
import { localDB } from '$lib/adapters/db';
import { appStorage } from '$lib/adapters/storage';
import { appKV } from '$lib/adapters/kv';
import { generateMasterKey } from '$lib/crypto';
import { setSession } from '$lib/services/session';
import { minidenticon } from 'minidenticons';

describe('UserService', () => {
	const mockMasterKey = {} as CryptoKey;

	const createMockUser = (overrides: Partial<UserRecord> = {}): UserRecord => ({
		id: 'test-id',
		name: 'Test',
		avatar: '',
		createdAt: 1000,
		updatedAt: 1000,
		isDeleted: false,
		isGuest: false,
		masterKey: mockMasterKey,
		...overrides
	});

	beforeEach(() => {
		vi.clearAllMocks();

		// Mock Window location API for switchUser test
		Object.defineProperty(window, 'location', {
			value: { reload: vi.fn() },
			writable: true
		});

		// Crypto default mocks
		vi.mocked(generateMasterKey).mockResolvedValue(mockMasterKey);

		// Adapter default mocks
		vi.mocked(appUser.getAllUsers).mockResolvedValue([]);
		vi.mocked(appUser.saveUser).mockResolvedValue(undefined);
		vi.mocked(appUser.deleteUser).mockResolvedValue(undefined);
		vi.mocked(appStorage.delete).mockResolvedValue(undefined);
		vi.mocked(appKV.set).mockResolvedValue(undefined);
		vi.mocked(appKV.remove).mockResolvedValue(undefined);
		vi.mocked(appStorage.delete).mockResolvedValue(undefined);
		vi.mocked(localDB.deleteByIndex).mockResolvedValue(undefined);
	});

	describe('getDefaultAvatarUrl', () => {
		it('should generated SVG data URL using minidenticons', () => {
			const url = UserService.getDefaultAvatarUrl('some-seed');
			expect(minidenticon).toHaveBeenCalledWith('some-seed');
			expect(url).toBe('data:image/svg+xml;utf8,%3Csvg%3Esome-seed%3C%2Fsvg%3E');
		});
	});

	describe('restoreOrCreateGuest', () => {
		it('should restore existing user and return true', async () => {
			const mockUserId = 'user-123';
			const userRecord = createMockUser({ id: mockUserId });

			vi.mocked(appKV.get).mockResolvedValue(mockUserId);
			vi.mocked(appUser.getUser).mockResolvedValue(userRecord);

			const result = await UserService.restoreOrCreateGuest();

			expect(result).toBe(true);
			expect(setSession).toHaveBeenCalledWith(mockUserId, mockMasterKey, false);
			// Should not create new guest
			expect(appUser.saveUser).not.toHaveBeenCalled();
		});

		it('should ignore deleted user and create guest', async () => {
			const mockUserId = 'user-del';
			vi.mocked(appKV.get).mockResolvedValue(mockUserId);
			vi.mocked(appUser.getUser).mockResolvedValue(
				createMockUser({
					id: mockUserId,
					isDeleted: true
				})
			);

			const result = await UserService.restoreOrCreateGuest();

			expect(result).toBe(false);
			expect(appUser.saveUser).toHaveBeenCalledWith(
				expect.objectContaining({ id: 'test-guest-id', isGuest: true })
			);
		});

		it('should create new guest when no active user ID stored', async () => {
			vi.mocked(appKV.get).mockResolvedValue(null);

			const result = await UserService.restoreOrCreateGuest();

			expect(result).toBe(false);
			expect(generateMasterKey).toHaveBeenCalled();
			expect(appUser.saveUser).toHaveBeenCalledWith(
				expect.objectContaining({ id: 'test-guest-id', isGuest: true })
			);
			expect(appKV.set).toHaveBeenCalledWith('activeUserId', 'test-guest-id');
		});
	});

	describe('createGuest', () => {
		it('should create guest with auto-generated name and master key', async () => {
			vi.mocked(appUser.getAllUsers).mockResolvedValue([createMockUser()]); // 1 existing user

			await UserService.createGuest();

			expect(generateMasterKey).toHaveBeenCalled();
			expect(appUser.saveUser).toHaveBeenCalledWith({
				id: 'test-guest-id',
				name: 'Guest 2', // 1 + 1
				avatar: 'data:image/svg+xml;utf8,%3Csvg%3Etest-guest-id%3C%2Fsvg%3E',
				createdAt: expect.any(Number),
				updatedAt: expect.any(Number),
				isDeleted: false,
				isGuest: true,
				masterKey: mockMasterKey
			});
			expect(appKV.set).toHaveBeenCalledWith('activeUserId', 'test-guest-id');
			expect(setSession).toHaveBeenCalledWith('test-guest-id', mockMasterKey, true);
		});
	});

	describe('saveLoginUser', () => {
		it('should create a new user record if none exists', async () => {
			vi.mocked(appUser.getUser).mockResolvedValue(null); // No existing record

			await UserService.saveLoginUser({
				id: 'new-id',
				email: 'test@ms.com',
				masterKey: mockMasterKey,
				serverName: 'Server Name',
				avatarUrl: 'server.png'
			});

			expect(appUser.saveUser).toHaveBeenCalledWith({
				id: 'new-id',
				name: 'Server Name',
				email: 'test@ms.com',
				avatar: 'server.png',
				createdAt: expect.any(Number),
				updatedAt: expect.any(Number),
				isDeleted: false,
				isGuest: false,
				masterKey: mockMasterKey
			});
			expect(appKV.set).toHaveBeenCalledWith('activeUserId', 'new-id');
			expect(setSession).toHaveBeenCalledWith('new-id', mockMasterKey, false);
		});

		it('should update and preserve name/avatar from existing local record', async () => {
			const existingUser = createMockUser({
				id: 'existing-id',
				name: 'Local Name',
				avatar: 'local.png',
				isGuest: true
			});
			vi.mocked(appUser.getUser).mockResolvedValue(existingUser);

			await UserService.saveLoginUser({
				id: 'existing-id',
				email: 'test@ms.com',
				masterKey: mockMasterKey,
				serverName: 'Server Name', // Should be ignored in favor of local
				avatarUrl: 'server.png' // Should be ignored in favor of local
			});

			expect(appUser.saveUser).toHaveBeenCalledWith({
				id: 'existing-id',
				name: 'Local Name',
				email: 'test@ms.com',
				avatar: 'local.png',
				createdAt: 1000,
				updatedAt: expect.any(Number),
				isDeleted: false,
				isGuest: false, // Upgraded from guest
				masterKey: mockMasterKey
			});
		});
	});

	describe('revertToGuest', () => {
		it('should change user to guest state with new key', async () => {
			const existingUser = createMockUser({
				id: 'user-id',
				name: 'Name',
				avatar: 'avatar',
				isGuest: false
			});
			vi.mocked(appUser.getUser).mockResolvedValue(existingUser);
			const newKey = {} as CryptoKey;

			await UserService.revertToGuest('user-id', newKey);

			expect(appUser.saveUser).toHaveBeenCalledWith(
				expect.objectContaining({
					id: 'user-id',
					isGuest: true,
					masterKey: newKey,
					updatedAt: expect.any(Number)
				})
			);
			expect(setSession).toHaveBeenCalledWith('user-id', newKey, true);
		});

		it('should throw if user not found', async () => {
			vi.mocked(appUser.getUser).mockResolvedValue(null);

			await expect(UserService.revertToGuest('not-found', mockMasterKey)).rejects.toThrow(
				'User not found: not-found'
			);
		});
	});

	describe('switchUser', () => {
		it('should set KV and reload page', async () => {
			await UserService.switchUser('target-user');

			expect(appKV.set).toHaveBeenCalledWith('activeUserId', 'target-user');
			expect(window.location.reload).toHaveBeenCalled();
		});
	});

	describe('deleteUser', () => {
		it('should completely wipe user data, assets, and sync states', async () => {
			const asset1 = { id: 'asset-1' } as AssetRecord;
			const asset2 = { id: 'asset-2' } as AssetRecord;
			vi.mocked(localDB.getAll).mockResolvedValue([asset1, asset2]);

			await UserService.deleteUser('delete-me');

			expect(appUser.deleteUser).toHaveBeenCalledWith('delete-me');

			// Assets cleanup
			expect(localDB.getAll).toHaveBeenCalledWith('assets', 'delete-me');
			expect(appStorage.delete).toHaveBeenCalledWith('asset-1');
			expect(appStorage.delete).toHaveBeenCalledWith('asset-2');

			// Tables cleanup (from mocked TABLES: ['messages', 'chatSummaries'])
			expect(localDB.deleteByIndex).toHaveBeenCalledWith('messages', 'userId', 'delete-me');
			expect(localDB.deleteByIndex).toHaveBeenCalledWith('chatSummaries', 'userId', 'delete-me');

			// Sync tracking cleanup (from mocked SYNC_TABLES: ['messages'])
			expect(appKV.remove).toHaveBeenCalledWith('lastSync_messages_delete-me');
		});
	});

	describe('getAllUsers', () => {
		it('should proxy to appUser.getAllUsers', async () => {
			const users = [createMockUser({ id: '1' })];
			vi.mocked(appUser.getAllUsers).mockResolvedValue(users);

			const result = await UserService.getAllUsers();
			expect(result).toBe(users);
			expect(appUser.getAllUsers).toHaveBeenCalled();
		});
	});
});
