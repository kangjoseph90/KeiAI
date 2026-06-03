/**
 * User Service Tests
 *
 * Tests the UserService which manages the current user's user data
 * and connects with the User adapter and UserRecordSyncEngine.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserService } from '$lib/services/user';
import type { UserRecord } from '$lib/adapters/user';

// Mock all dependencies
vi.mock('$lib/adapters/user', () => ({
    appUser: {
        getUser: vi.fn(),
        saveUser: vi.fn()
    }
}));

import { appUser } from '$lib/adapters/user';

describe('UserService', () => {
    const mockUserId = 'user-123';
    const baseMockUser: UserRecord = {
        id: mockUserId,
        name: 'John Doe',
        avatar: 'avatar.png',
        email: 'john@example.com',
        createdAt: 1000,
        updatedAt: 2000,
        masterKey: {} as CryptoKey,
        identityKeyPair: {} as CryptoKeyPair
    };

    beforeEach(() => {
        vi.clearAllMocks();

        // Default user adapter mock
        vi.mocked(appUser.getUser).mockResolvedValue({ ...baseMockUser });
        vi.mocked(appUser.saveUser).mockResolvedValue(undefined);
    });

    describe('getUser', () => {
        it('should return the profile for the active session user', async () => {
            const result = await UserService.getUser(mockUserId);

            expect(result).toEqual({
                id: mockUserId,
                name: 'John Doe',
                avatar: 'avatar.png',
                email: 'john@example.com'
            });
            expect(appUser.getUser).toHaveBeenCalledWith(mockUserId);
        });

        it('should throw an error if the user is not found', async () => {
            vi.mocked(appUser.getUser).mockResolvedValue(null);

            await expect(UserService.getUser(mockUserId)).rejects.toThrow(
                `User not found: ${mockUserId}`
            );
        });
    });

    describe('updateUser', () => {
        it('should update name and avatar fields and trigger sync', async () => {
            const result = await UserService.updateUser(mockUserId, {
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
            const result = await UserService.updateUser(mockUserId, { name: 'Jane Doe' });

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

            await expect(UserService.updateUser(mockUserId, { name: 'New Name' })).rejects.toThrow(
                `User not found: ${mockUserId}`
            );
            expect(appUser.saveUser).not.toHaveBeenCalled();
        });
    });
});
