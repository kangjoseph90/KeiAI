/**
 * User Service Tests
 *
 * Tests the UserService which handles local user lifecycle (boot, guest creation,
 * login save, account unlink, and data cleanup).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserService } from '$lib/services/user/user';
import type { UserRecord } from '$lib/adapters/user';
import type { AssetRecord, AssetRegistryRecord } from '$lib/adapters/asset';

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
		deleteByIndex: vi.fn()
	},
	TABLES: ['messages', 'chatSummaries'],
	SYNC_TABLES: ['messages']
}));

vi.mock('$lib/adapters/asset', () => ({
	appAsset: {
		getAllAssets: vi.fn(),
		getAllRegistry: vi.fn(),
		deleteRegistry: vi.fn(),
		putAsset: vi.fn()
	}
}));

vi.mock('$lib/adapters/storage', () => ({
	appStorage: {
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
	generateMasterKey: vi.fn(),
	generateIdentityKeyPair: vi.fn()
}));

vi.mock('$lib/utils/id', () => ({
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
import { appAsset } from '$lib/adapters/asset';
import { appStorage } from '$lib/adapters/storage';
import { appKV } from '$lib/adapters/kv';
import { generateMasterKey, generateIdentityKeyPair } from '$lib/crypto';
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
		identityKeyPair: {} as CryptoKeyPair,
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
		vi.mocked(generateIdentityKeyPair).mockResolvedValue({} as CryptoKeyPair);

		// Adapter default mocks
		vi.mocked(appUser.getAllUsers).mockResolvedValue([]);
		vi.mocked(appUser.saveUser).mockResolvedValue(undefined);
		vi.mocked(appUser.deleteUser).mockResolvedValue(undefined);
		vi.mocked(appAsset.getAllAssets).mockResolvedValue([]);
		vi.mocked(appAsset.getAllRegistry).mockResolvedValue([]);
		vi.mocked(appAsset.deleteRegistry).mockResolvedValue(undefined);
		vi.mocked(appAsset.putAsset).mockResolvedValue(undefined);
		vi.mocked(appStorage.delete).mockResolvedValue(undefined);
		vi.mocked(appKV.set).mockResolvedValue(undefined);
		vi.mocked(appKV.remove).mockResolvedValue(undefined);
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
			expect(setSession).toHaveBeenCalledWith(
				mockUserId,
				mockMasterKey,
				false,
				{} as CryptoKeyPair
			);
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
				masterKey: mockMasterKey,
				identityKeyPair: {} as CryptoKeyPair
			});
			expect(appKV.set).toHaveBeenCalledWith('activeUserId', 'test-guest-id');
			expect(setSession).toHaveBeenCalledWith(
				'test-guest-id',
				mockMasterKey,
				true,
				{} as CryptoKeyPair
			);
		});
	});

	describe('saveLoginUser', () => {
		it('should create a new user record if none exists', async () => {
			vi.mocked(appUser.getUser).mockResolvedValue(null); // No existing record

			await UserService.saveLoginUser({
				id: 'new-id',
				email: 'test@ms.com',
				masterKey: mockMasterKey,
				identityKeyPair: {} as CryptoKeyPair,
				serverName: 'Server Name',
				avatarUrl: 'server.png'
			});

			expect(appUser.saveUser).toHaveBeenCalledWith(
				{
					id: 'new-id',
					name: 'Server Name',
					email: 'test@ms.com',
					avatar: 'server.png',
					createdAt: expect.any(Number),
					updatedAt: expect.any(Number),
					isDeleted: false,
					isGuest: false,
					masterKey: mockMasterKey,
					identityKeyPair: {} as CryptoKeyPair
				},
				{ origin: 'sync' }
			);
			expect(appKV.set).toHaveBeenCalledWith('activeUserId', 'new-id');
			expect(setSession).toHaveBeenCalledWith('new-id', mockMasterKey, false, expect.anything());
		});

		it('should update and preserve name/avatar from existing local record', async () => {
			const existingUser = createMockUser({
				id: 'existing-id',
				name: 'Local Name',
				avatar: 'local.png',
				isGuest: true,
				identityKeyPair: {} as CryptoKeyPair
			});
			vi.mocked(appUser.getUser).mockResolvedValue(existingUser);

			await UserService.saveLoginUser({
				id: 'existing-id',
				email: 'test@ms.com',
				masterKey: mockMasterKey,
				identityKeyPair: {} as CryptoKeyPair,
				serverName: 'Server Name', // Should be ignored in favor of local
				avatarUrl: 'server.png' // Should be ignored in favor of local
			});

			expect(appUser.saveUser).toHaveBeenCalledWith(
				{
					id: 'existing-id',
					name: 'Local Name',
					email: 'test@ms.com',
					avatar: 'local.png',
					createdAt: 1000,
					updatedAt: expect.any(Number),
					isDeleted: false,
					isGuest: false, // Upgraded from guest
					masterKey: mockMasterKey,
					identityKeyPair: {} as CryptoKeyPair
				},
				{ origin: 'sync' }
			);
		});
	});

	describe('revertToGuest', () => {
		it('should change user to guest state with new key', async () => {
			const existingUser = createMockUser({
				id: 'user-id',
				name: 'Name',
				avatar: 'avatar',
				isGuest: false,
				identityKeyPair: {} as CryptoKeyPair
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
			expect(setSession).toHaveBeenCalledWith('user-id', newKey, true, expect.anything());
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
			const mockAssets = [{ id: 'a1' }, { id: 'a2' }] as AssetRecord[];
			const mockRegistry = [{ id: 'a2' }, { id: 'a3' }] as AssetRegistryRecord[];
			vi.mocked(appAsset.getAllAssets).mockResolvedValue(mockAssets);
			vi.mocked(appAsset.getAllRegistry).mockResolvedValue(mockRegistry);

			await UserService.deleteUser('delete-me');

			expect(appUser.deleteUser).toHaveBeenCalledWith('delete-me', { origin: 'sync' });

			// Assets cleanup
			expect(appAsset.getAllAssets).toHaveBeenCalledWith('delete-me');
			expect(appAsset.getAllRegistry).toHaveBeenCalledWith('delete-me');

			// Union of IDs: a1, a2, a3
			expect(appStorage.delete).toHaveBeenCalledWith('assets/a1');
			expect(appStorage.delete).toHaveBeenCalledWith('assets/a2');
			expect(appStorage.delete).toHaveBeenCalledWith('assets/a3');

			expect(appAsset.deleteRegistry).toHaveBeenCalledWith('a1', { origin: 'sync' });
			expect(appAsset.deleteRegistry).toHaveBeenCalledWith('a2', { origin: 'sync' });
			expect(appAsset.deleteRegistry).toHaveBeenCalledWith('a3', { origin: 'sync' });

			// Hard metadata delete
			expect(appAsset.putAsset).toHaveBeenCalledWith(
				expect.objectContaining({ id: 'a1', isDeleted: true }),
				{ origin: 'sync' }
			);
			expect(appAsset.putAsset).toHaveBeenCalledWith(
				expect.objectContaining({ id: 'a2', isDeleted: true }),
				{ origin: 'sync' }
			);

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
