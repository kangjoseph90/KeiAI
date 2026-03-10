import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProfileSyncService } from '$lib/services/sync/profile';
import { pb } from '$lib/adapters/pb';
import { getActiveSession } from '$lib/services/session';
import { ProfileService } from '$lib/services/user/profile';
import { appUser } from '$lib/adapters/user';
import type { RecordModel } from 'pocketbase';
import type { Profile } from '$lib/services';
import type { UserRecord } from '$lib/adapters/user';

// Mock Collection Mock
const mockCollection = {
	update: vi.fn(),
	subscribe: vi.fn(),
	unsubscribe: vi.fn(),
	getOne: vi.fn()
};

// Mock Dependencies
vi.mock('$lib/adapters/pb', () => ({
	pb: {
		authStore: { isValid: true },
		collection: vi.fn(() => mockCollection),
		files: {
			getURL: vi.fn(() => 'http://server/avatar.png')
		}
	}
}));

vi.mock('$lib/services/session', () => ({
	getActiveSession: vi.fn()
}));

vi.mock('$lib/services/user/profile', () => ({
	ProfileService: {
		applyRemoteUpdate: vi.fn()
	}
}));

vi.mock('$lib/adapters/user', () => ({
	appUser: {
		getUser: vi.fn(),
		saveUser: vi.fn()
	}
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ProfileSyncService', () => {
	const mockUserId = 'user-123';

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getActiveSession).mockReturnValue({
			userId: mockUserId,
			isGuest: false,
			masterKey: {} as CryptoKey
		});
		(pb.authStore as unknown as { isValid: boolean }).isValid = true;
		(ProfileSyncService as unknown as { subscribed: boolean }).subscribed = false;
	});

	describe('pushProfile', () => {
		it('should update PocketBase record', async () => {
			vi.mocked(appUser.getUser).mockResolvedValue({
				id: mockUserId,
				name: 'New Name',
				avatar: 'avatar.png'
			} as UserRecord);
			vi.mocked(mockCollection.update).mockResolvedValue({
				id: mockUserId
			} as unknown as RecordModel);

			await ProfileSyncService.pushProfile();

			expect(mockCollection.update).toHaveBeenCalledWith(mockUserId, { name: 'New Name' });
		});

		it('should handle avatar data URI upload and keep it locally', async () => {
			const mockBlob = new Blob(['test'], { type: 'image/png' });
			mockFetch.mockResolvedValue({
				blob: vi.fn().mockResolvedValue(mockBlob)
			});
			vi.mocked(mockCollection.update).mockResolvedValue({
				id: mockUserId,
				avatar: 'abc.png'
			} as unknown as RecordModel);
			vi.mocked(appUser.getUser).mockResolvedValue({
				id: mockUserId,
				name: 'Name',
				avatar: 'data:image/png;base64,abc'
			} as UserRecord);

			await ProfileSyncService.pushProfile();

			expect(mockFetch).toHaveBeenCalledWith('data:image/png;base64,abc');
			expect(mockCollection.update).toHaveBeenCalledWith(
				mockUserId,
				expect.objectContaining({
					name: 'Name',
					avatar: mockBlob
				})
			);
			// Local avatar should NOT be updated with server URL anymore
			expect(appUser.saveUser).not.toHaveBeenCalled();
		});

		it('should skip if guest or invalid auth', async () => {
			(pb.authStore as unknown as { isValid: boolean }).isValid = false;
			await ProfileSyncService.pushProfile();
			expect(pb.collection).not.toHaveBeenCalled();

			(pb.authStore as unknown as { isValid: boolean }).isValid = true;
			vi.mocked(getActiveSession).mockReturnValue({
				isGuest: true,
				userId: mockUserId,
				masterKey: {} as CryptoKey
			});
			await ProfileSyncService.pushProfile();
			expect(pb.collection).not.toHaveBeenCalled();
		});
	});

	describe('pullProfile', () => {
		it('should fetch from PocketBase and convert avatar to Data URI', async () => {
			const mockServerRecord = {
				name: 'Remote Name',
				avatar: 'remote.png',
				updated: '2023-01-01T00:00:00Z'
			};
			vi.mocked(mockCollection.getOne).mockResolvedValue(
				mockServerRecord as unknown as RecordModel
			);

			// Mock conversion process
			const mockDataUri = 'data:image/png;base64,cmVtb3Rl'; // 'remote' in base64
			mockFetch.mockResolvedValue({
				ok: true,
				blob: vi.fn().mockResolvedValue({
					type: 'image/png',
					arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode('remote').buffer)
				})
			});

			await ProfileSyncService.pullProfile();

			expect(mockCollection.getOne).toHaveBeenCalledWith(mockUserId);
			expect(ProfileService.applyRemoteUpdate).toHaveBeenCalledWith(
				mockUserId,
				'Remote Name',
				mockDataUri,
				expect.any(Number)
			);
		});
	});

	describe('Realtime Subscription', () => {
		it('should subscribe to user record', async () => {
			await ProfileSyncService.subscribeRealtime();

			expect(mockCollection.subscribe).toHaveBeenCalledWith(mockUserId, expect.any(Function));
		});

		it('should unsubscribe', async () => {
			// Use type casting to access private static member for testing
			(ProfileSyncService as unknown as { subscribed: boolean }).subscribed = true;

			await ProfileSyncService.unsubscribeRealtime();

			expect(mockCollection.unsubscribe).toHaveBeenCalledWith(mockUserId);
		});
	});
});
