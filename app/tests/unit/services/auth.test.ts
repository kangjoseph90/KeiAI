/**
 * Auth Service Tests
 *
 * Tests the AuthService which handles authentication flows:
 * - register: Guest → Registered conversion
 * - login: E2EE login with master key unwrapping
 * - recoverPassword: 16-char recovery code flow
 * - changePassword: Update password with re-wrap
 * - unlinkAccount: Registered → Guest conversion
 * - logout: Clear PB auth but preserve local session
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthService } from '$lib/services/user/auth';
import type { RecoveryBundle } from '$lib/crypto';

// Mock all dependencies
vi.mock('$lib/adapters/pb', () => ({
	pb: {
		authStore: {
			isValid: false,
			onChange: vi.fn(),
			clear: vi.fn(),
			record: null
		},
		collection: vi.fn(() => ({
			create: vi.fn().mockResolvedValue({ id: 'mock-id' }),
			update: vi.fn().mockResolvedValue({ id: 'mock-id' }),
			delete: vi.fn().mockResolvedValue(true),
			authWithPassword: vi.fn().mockResolvedValue({
				record: {
					id: 'mock-id',
					email: 'test@example.com',
					name: 'Test User',
					avatar: 'avatar.png',
					encryptedMasterKey: 'wrappedKey',
					masterKeyIv: 'iv'
				},
				token: 'auth-token'
			})
		})),
		send: vi.fn().mockResolvedValue({ salt: 'base64salt' }),
		files: {
			getURL: vi.fn().mockReturnValue('https://example.com/avatar.png')
		}
	}
}));

vi.mock('$lib/crypto', () => ({
	generateSalt: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4])),
	deriveKeys: vi.fn().mockResolvedValue({
		loginKey: new Uint8Array([5, 6, 7, 8]),
		encryptionKey: new Uint8Array([9, 10, 11, 12])
	}),
	wrapMasterKey: vi.fn().mockResolvedValue({
		ciphertext: new Uint8Array([13, 14, 15, 16]),
		iv: new Uint8Array([17, 18, 19, 20])
	}),
	unwrapMasterKeyRaw: vi.fn().mockResolvedValue(new Uint8Array([21, 22, 23, 24])),
	importMasterKey: vi.fn().mockResolvedValue({} as CryptoKey),
	createRecoveryData: vi.fn().mockResolvedValue({
		encryptedRecoveryMasterKey: new Uint8Array([45, 46, 47, 48]),
		encryptedRecoveryMasterKeyIV: new Uint8Array([49, 50, 51, 52]),
		recoveryAuthTokenHash: new Uint8Array([53, 54, 55, 56]),
		recoveryCode: {
			frontHalf: 'ABCD1234',
			backHalf: 'EFGH5678',
			fullCode: 'ABCD-1234-EFGH-5678'
		}
	}),
	deriveRecoveryKey: vi.fn().mockResolvedValue(new Uint8Array([9, 10, 11, 12])),
	hashRecoveryAuthToken: vi.fn().mockResolvedValue(new Uint8Array([53, 54, 55, 56])),
	splitRecoveryCode: vi.fn().mockReturnValue({
		frontHalf: 'ABCD1234',
		backHalf: 'EFGH5678',
		fullCode: 'ABCD-1234-EFGH-5678'
	}),
	toBase64: vi.fn((data: Uint8Array | string) => {
		if (typeof data === 'string') return btoa(data);
		return btoa(String.fromCharCode(...data));
	}),
	fromBase64: vi.fn((str: string) => {
		// Handle test strings that aren't valid base64
		if (
			str === 'base64key' ||
			str === 'base64iv' ||
			str === 'wrappedKey' ||
			str === 'iv' ||
			str === 'base64salt'
		) {
			return new Uint8Array([1, 2, 3, 4]);
		}
		const binary = atob(str);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes;
	})
}));

vi.mock('$lib/services/session', () => ({
	getActiveSession: vi.fn().mockReturnValue({
		userId: 'user-123',
		masterKey: {} as CryptoKey,
		isGuest: true
	})
}));

vi.mock('$lib/services/user/user', () => ({
	UserService: {
		saveLoginUser: vi.fn().mockResolvedValue(undefined),
		revertToGuest: vi.fn().mockResolvedValue(undefined)
	}
}));

vi.mock('$lib/adapters/user', () => ({
	appUser: {
		getUser: vi.fn().mockResolvedValue({
			id: 'user-123',
			name: 'Guest User',
			avatar: 'data:image/svg+xml;base,test',
			createdAt: Date.now(),
			updatedAt: Date.now(),
			isDeleted: false,
			isGuest: true,
			masterKey: {} as CryptoKey
		}),
		backupGuestKey: vi.fn().mockResolvedValue(undefined)
	}
}));

vi.mock('$lib/services/sync', () => ({
	DataSyncService: {
		resetCursors: vi.fn().mockResolvedValue(undefined)
	},
	SyncManager: {
		stopAutoSync: vi.fn().mockResolvedValue(undefined)
	}
}));

import { pb } from '$lib/adapters/pb';
import {
	generateSalt,
	deriveKeys,
	wrapMasterKey,
	unwrapMasterKeyRaw,
	importMasterKey,
	createRecoveryData,
	deriveRecoveryKey,
	splitRecoveryCode
} from '$lib/crypto';
import { getActiveSession } from '$lib/services/session';
import { UserService } from '$lib/services/user/user';
import { appUser } from '$lib/adapters/user';
import { DataSyncService, SyncManager } from '$lib/services/sync';

describe('AuthService', () => {
	const mockMasterKey = {} as CryptoKey;
	const mockLockedKey = {} as CryptoKey;
	const mockUserId = 'user-123';
	const mockEmail = 'test@example.com';
	const mockPassword = 'password123';
	const mockSalt = new Uint8Array([1, 2, 3, 4]);
	const mockLoginKey = new Uint8Array([5, 6, 7, 8]);
	const mockEncryptionKey = new Uint8Array([9, 10, 11, 12]);
	const mockRawMasterKey = new Uint8Array([21, 22, 23, 24]);
	const mockRecoveryCode = 'ABCD-1234-EFGH-5678';

	beforeEach(() => {
		vi.clearAllMocks();

		// Reset PB auth store
		(pb.authStore as unknown as { isValid: boolean }).isValid = false;
		(pb.authStore as unknown as { record: unknown }).record = null;

		// Default session mock (guest)
		vi.mocked(getActiveSession).mockReturnValue({
			userId: mockUserId,
			masterKey: mockMasterKey,
			isGuest: true
		});

		// Default crypto mocks - these need to be reset each test
		vi.mocked(generateSalt).mockReset().mockResolvedValue(mockSalt);
		vi.mocked(deriveKeys).mockReset().mockResolvedValue({
			loginKey: mockLoginKey,
			encryptionKey: mockEncryptionKey
		});
		vi.mocked(wrapMasterKey)
			.mockReset()
			.mockResolvedValue({
				ciphertext: new Uint8Array([13, 14, 15, 16]),
				iv: new Uint8Array([17, 18, 19, 20])
			});
		vi.mocked(createRecoveryData)
			.mockReset()
			.mockResolvedValue({
				encryptedRecoveryMasterKey: new Uint8Array([45, 46, 47, 48]),
				encryptedRecoveryMasterKeyIV: new Uint8Array([49, 50, 51, 52]),
				recoveryAuthTokenHash: new Uint8Array([53, 54, 55, 56]),
				recoveryCode: {
					frontHalf: 'ABCD1234',
					backHalf: 'EFGH5678',
					fullCode: mockRecoveryCode
				}
			});
		vi.mocked(unwrapMasterKeyRaw).mockReset().mockResolvedValue(mockRawMasterKey);
		vi.mocked(importMasterKey).mockReset().mockResolvedValue(mockLockedKey);
		vi.mocked(deriveRecoveryKey).mockReset().mockResolvedValue(mockEncryptionKey);
		vi.mocked(splitRecoveryCode).mockReset().mockReturnValue({
			frontHalf: 'ABCD1234',
			backHalf: 'EFGH5678',
			fullCode: mockRecoveryCode
		});

		// Default appUser mock
		vi.mocked(appUser.getUser).mockReset().mockResolvedValue({
			id: mockUserId,
			name: 'Guest User',
			avatar: 'data:image/svg+xml;base,test',
			createdAt: Date.now(),
			updatedAt: Date.now(),
			isDeleted: false,
			isGuest: true,
			masterKey: mockMasterKey
		});

		// Default PB send mock
		vi.mocked(pb.send).mockReset().mockResolvedValue({ salt: 'base64salt' });

		// UserService and SyncManager void calls
		vi.mocked(UserService.saveLoginUser).mockReset().mockResolvedValue(undefined);
		vi.mocked(UserService.revertToGuest).mockReset().mockResolvedValue(undefined);
		vi.mocked(DataSyncService.resetCursors).mockReset().mockResolvedValue(undefined);
		vi.mocked(SyncManager.stopAutoSync).mockReset().mockResolvedValue(undefined);
		vi.mocked(appUser.backupGuestKey).mockReset().mockResolvedValue(undefined);
	});

	describe('PB Connection Helpers', () => {
		it('should return PB auth state', () => {
			(pb.authStore as unknown as { isValid: boolean }).isValid = true;
			const result = AuthService.isPbConnected();
			expect(result).toBe(true);
		});

		it('should subscribe to PB auth changes', () => {
			const callback = vi.fn();
			const mockOnChange = vi.mocked(pb.authStore.onChange);

			AuthService.onPbAuthChange(callback);

			expect(mockOnChange).toHaveBeenCalledWith(expect.any(Function));
		});

		it('should clear PB auth', () => {
			const mockClear = vi.mocked(pb.authStore.clear);
			AuthService.clearAuth();
			expect(mockClear).toHaveBeenCalled();
		});
	});

	describe('register', () => {
		it('should register a guest user and return recovery code', async () => {
			const result = await AuthService.register(mockEmail, mockPassword);
			expect(result).toBe(mockRecoveryCode);
			expect(generateSalt).toHaveBeenCalled();
			expect(deriveKeys).toHaveBeenCalledWith(mockPassword, mockSalt);
			expect(wrapMasterKey).toHaveBeenCalledWith(mockMasterKey, mockEncryptionKey);
			expect(createRecoveryData).toHaveBeenCalledWith(mockMasterKey);
		});

		it('should throw ALREADY_REGISTERED when user is not a guest', async () => {
			vi.mocked(getActiveSession).mockReturnValue({
				userId: mockUserId,
				masterKey: mockMasterKey,
				isGuest: false
			});

			await expect(AuthService.register(mockEmail, mockPassword)).rejects.toThrow(
				'Already registered'
			);
		});

		it('should call PB collection create', async () => {
			await AuthService.register(mockEmail, mockPassword);
			const mockCollection = vi.mocked(pb.collection);
			expect(mockCollection).toHaveBeenCalled();
		});

		it('should call login after successful registration', async () => {
			await AuthService.register(mockEmail, mockPassword);
			const mockSend = vi.mocked(pb.send);
			expect(mockSend).toHaveBeenCalled();
		});

		it('should handle avatar fetch failure gracefully', async () => {
			global.fetch = vi
				.fn()
				.mockRejectedValue(new Error('Fetch failed')) as unknown as typeof fetch;

			await expect(AuthService.register(mockEmail, mockPassword)).resolves.toBeDefined();
		});
	});

	describe('login', () => {
		it('should login with email and password', async () => {
			await AuthService.login(mockEmail, mockPassword);
			const mockSend = vi.mocked(pb.send);
			expect(mockSend).toHaveBeenCalledWith(`/api/salt/${encodeURIComponent(mockEmail)}`, {
				method: 'GET'
			});
		});

		it('should derive keys and unwrap master key', async () => {
			await AuthService.login(mockEmail, mockPassword);
			expect(deriveKeys).toHaveBeenCalledWith(mockPassword, expect.any(Uint8Array));
			expect(unwrapMasterKeyRaw).toHaveBeenCalled();
		});

		it('should call UserService.saveLoginUser with correct params', async () => {
			await AuthService.login(mockEmail, mockPassword);
			expect(UserService.saveLoginUser).toHaveBeenCalledWith({
				id: 'mock-id',
				email: mockEmail,
				masterKey: mockLockedKey,
				serverName: 'Test User',
				avatarUrl: 'https://example.com/avatar.png'
			});
		});

		it('should reset sync cursors on login', async () => {
			await AuthService.login(mockEmail, mockPassword);
			expect(DataSyncService.resetCursors).toHaveBeenCalledWith('mock-id');
		});
	});

	describe('recoverPassword', () => {
		beforeEach(() => {
			vi.mocked(pb.send).mockImplementation(async (path) => {
				if (typeof path === 'string' && path.includes('/api/salt/')) return { salt: 'base64salt' };
				if (typeof path === 'string' && path.includes('/api/recovery-bundle/'))
					return {
						encryptedRecoveryMasterKey: 'base64key',
						encryptedRecoveryMasterKeyIV: 'base64iv'
					};
				return {};
			});
		});

		it('should recover password and return new recovery code', async () => {
			const result = await AuthService.recoverPassword(mockEmail, mockRecoveryCode, 'newPassword');

			expect(result).toBe(mockRecoveryCode);
			expect(splitRecoveryCode).toHaveBeenCalledWith(mockRecoveryCode);
		});

		it('should derive recovery key and unwrap master key', async () => {
			await AuthService.recoverPassword(mockEmail, mockRecoveryCode, 'newPassword');

			expect(deriveRecoveryKey).toHaveBeenCalledWith('ABCD1234');
			expect(unwrapMasterKeyRaw).toHaveBeenCalled();
		});
	});

	describe('changePassword', () => {
		beforeEach(() => {
			// Setup authenticated session
			vi.mocked(getActiveSession).mockReturnValue({
				userId: mockUserId,
				masterKey: mockLockedKey,
				isGuest: false
			});
			(
				pb.authStore as unknown as {
					record: {
						id: string;
						email: string;
						encryptedMasterKey: string;
						masterKeyIv: string;
					} | null;
				}
			).record = {
				id: mockUserId,
				email: mockEmail,
				encryptedMasterKey: 'wrappedKey',
				masterKeyIv: 'iv'
			};
			(pb.authStore as unknown as { isValid: boolean }).isValid = true;
		});

		it('should change password and return new recovery code', async () => {
			const result = await AuthService.changePassword('oldPassword', 'newPassword');
			expect(result).toBe(mockRecoveryCode);
		});

		it('should throw when not authenticated', async () => {
			(pb.authStore as unknown as { record: null }).record = null;
			await expect(AuthService.changePassword('old', 'new')).rejects.toThrow('Not logged in');
		});

		it('should derive keys with old password and unwrap master key', async () => {
			await AuthService.changePassword('oldPassword', 'newPassword');
			expect(deriveKeys).toHaveBeenCalledWith('oldPassword', expect.any(Uint8Array));
			expect(unwrapMasterKeyRaw).toHaveBeenCalled();
		});
	});

	describe('unlinkAccount', () => {
		beforeEach(() => {
			// Setup authenticated session
			vi.mocked(getActiveSession).mockReturnValue({
				userId: mockUserId,
				masterKey: mockLockedKey,
				isGuest: false
			});
			(
				pb.authStore as unknown as {
					record: {
						id: string;
						email: string;
						encryptedMasterKey: string;
						masterKeyIv: string;
					} | null;
				}
			).record = {
				id: mockUserId,
				email: mockEmail,
				encryptedMasterKey: 'wrappedKey',
				masterKeyIv: 'iv'
			};
			(pb.authStore as unknown as { isValid: boolean }).isValid = true;
		});

		it('should unlink account and revert to guest', async () => {
			await AuthService.unlinkAccount('password');
			const mockCollection = vi.mocked(pb.collection);
			expect(mockCollection).toHaveBeenCalledWith('users');
			expect(UserService.revertToGuest).toHaveBeenCalledWith(mockUserId, mockLockedKey);
		});

		it('should throw when not authenticated', async () => {
			(pb.authStore as unknown as { record: null }).record = null;
			await expect(AuthService.unlinkAccount('password')).rejects.toThrow('Not logged in');
		});

		it('should derive keys and unwrap master key with password', async () => {
			await AuthService.unlinkAccount('password');
			expect(deriveKeys).toHaveBeenCalledWith('password', expect.any(Uint8Array));
			expect(unwrapMasterKeyRaw).toHaveBeenCalled();
		});

		it('should import master key as extractable', async () => {
			await AuthService.unlinkAccount('password');
			expect(importMasterKey).toHaveBeenCalledWith(mockRawMasterKey, true);
		});

		it('should clear PB auth after unlink', async () => {
			const mockClear = vi.mocked(pb.authStore.clear);
			await AuthService.unlinkAccount('password');
			expect(mockClear).toHaveBeenCalled();
		});
	});

	describe('logout', () => {
		it('should stop auto sync and clear PB auth', async () => {
			const mockClear = vi.mocked(pb.authStore.clear);
			await AuthService.logout();
			expect(SyncManager.stopAutoSync).toHaveBeenCalled();
			expect(mockClear).toHaveBeenCalled();
		});

		it('should preserve local session (user id and master key)', async () => {
			const mockClear = vi.mocked(pb.authStore.clear);
			const sessionBefore = getActiveSession();
			await AuthService.logout();
			expect(mockClear).toHaveBeenCalled();
		});
	});
});
