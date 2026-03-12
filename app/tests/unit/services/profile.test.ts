/**
 * Profile Service Tests
 *
 * Tests the ProfileService which manages the current user's profile data
 * and connects with the User adapter and ProfileSyncService.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProfileService } from '$lib/services/user/profile';
import type { UserRecord } from '$lib/adapters/user';

// Mock all dependencies
vi.mock('$lib/services/session', () => ({
	getActiveSession: vi.fn()
}));

vi.mock('$lib/adapters/user', () => ({
	appUser: {
		getUser: vi.fn(),
		saveUser: vi.fn()
	}
}));

import { getActiveSession } from '$lib/services/session';
import { appUser } from '$lib/adapters/user';

describe('ProfileService', () => {
	const mockUserId = 'user-123';
	const baseMockUser: UserRecord = {
		id: mockUserId,
		name: 'John Doe',
		avatar: 'avatar.png',
		email: 'john@example.com',
		isGuest: false,
		createdAt: 1000,
		updatedAt: 2000,
		isDeleted: false,
		masterKey: {} as CryptoKey,
		identityKeyPair: {} as CryptoKeyPair
	};

	beforeEach(() => {
		vi.clearAllMocks();

		// Default session mock
		vi.mocked(getActiveSession).mockReturnValue({
			userId: mockUserId,
			masterKey: {} as CryptoKey,
			isGuest: false,
			identityKeyPair: {} as CryptoKeyPair
		});

		// Default user adapter mock
		vi.mocked(appUser.getUser).mockResolvedValue({ ...baseMockUser });
		vi.mocked(appUser.saveUser).mockResolvedValue(undefined);
	});

	describe('get', () => {
		it('should return the profile for the active session user', async () => {
			const result = await ProfileService.get();

			expect(result).toEqual({
				id: mockUserId,
				name: 'John Doe',
				avatar: 'avatar.png',
				email: 'john@example.com',
				isGuest: false
			});
			expect(appUser.getUser).toHaveBeenCalledWith(mockUserId);
		});

		it('should throw an error if the user is not found', async () => {
			vi.mocked(appUser.getUser).mockResolvedValue(null);

			await expect(ProfileService.get()).rejects.toThrow(`User not found: ${mockUserId}`);
		});
	});

	describe('update', () => {
		it('should update name and avatar fields and trigger sync', async () => {
			const result = await ProfileService.update({
				name: 'Jane Doe',
				avatar: 'new_avatar.png'
			});

			expect(result.name).toBe('Jane Doe');
			expect(result.avatar).toBe('new_avatar.png');

			expect(appUser.saveUser).toHaveBeenCalledWith(
				expect.objectContaining({
					name: 'Jane Doe',
					avatar: 'new_avatar.png',
					updatedAt: expect.any(Number)
				})
			);
		});

		it('should update only the provided fields', async () => {
			const result = await ProfileService.update({ name: 'Jane Doe' });

			expect(result.name).toBe('Jane Doe');
			expect(result.avatar).toBe('avatar.png'); // Unchanged

			expect(appUser.saveUser).toHaveBeenCalledWith(
				expect.objectContaining({
					name: 'Jane Doe',
					avatar: 'avatar.png',
					updatedAt: expect.any(Number)
				})
			);
		});

		it('should throw an error if the user is not found', async () => {
			vi.mocked(appUser.getUser).mockResolvedValue(null);

			await expect(ProfileService.update({ name: 'New Name' })).rejects.toThrow(
				`User not found: ${mockUserId}`
			);
			expect(appUser.saveUser).not.toHaveBeenCalled();
		});
	});

	describe('applyRemoteUpdate', () => {
		it('should apply remote update if server timestamp is strictly newer', async () => {
			const newServerTime = baseMockUser.updatedAt + 1000;

			const result = await ProfileService.applyRemoteUpdate(
				mockUserId,
				'Remote Name',
				'remote_avatar.png',
				newServerTime
			);

			expect(result).not.toBeNull();
			expect(result?.name).toBe('Remote Name');
			expect(result?.avatar).toBe('remote_avatar.png');

			expect(appUser.saveUser).toHaveBeenCalledWith(
				expect.objectContaining({
					name: 'Remote Name',
					avatar: 'remote_avatar.png',
					updatedAt: newServerTime
				}),
				{ origin: 'sync' }
			);
		});

		it('should reject remote update if server timestamp is older or equal (LWW)', async () => {
			const oldServerTime = baseMockUser.updatedAt; // Equal

			const result = await ProfileService.applyRemoteUpdate(
				mockUserId,
				'Remote Name',
				'remote_avatar.png',
				oldServerTime
			);

			expect(result).toBeNull();
			expect(appUser.saveUser).not.toHaveBeenCalled();
		});

		it('should return null if local user is not found', async () => {
			vi.mocked(appUser.getUser).mockResolvedValue(null);

			const result = await ProfileService.applyRemoteUpdate(
				mockUserId,
				'Remote Name',
				'remote_avatar.png',
				999999
			);

			expect(result).toBeNull();
			expect(appUser.saveUser).not.toHaveBeenCalled();
		});
	});
});
