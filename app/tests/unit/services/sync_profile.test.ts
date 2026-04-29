import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserSyncService } from '$lib/services/sync/user';
import { pb } from '$lib/adapters/pb';
import { getActiveSession, hasActiveSession } from '$lib/services/user';
import { appUser } from '$lib/adapters/user';
import type { RecordModel } from 'pocketbase';
import type { User } from '$lib/services';
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

vi.mock('$lib/services/user', () => ({
    UserService: {},
    getActiveSession: vi.fn(),
    hasActiveSession: vi.fn(),
    toUser: vi.fn((u) => u)
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

describe('UserSyncService', () => {
    const mockUserId = 'user-123';

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getActiveSession).mockReturnValue({
            userId: mockUserId,
            masterKey: {} as CryptoKey,
            identityKeyPair: {} as CryptoKeyPair
        });
        vi.mocked(hasActiveSession).mockReturnValue(true);
        (pb.authStore as unknown as { isValid: boolean }).isValid = true;
        (UserSyncService as unknown as { subscribed: boolean }).subscribed = false;
    });

    describe('pushUser', () => {
        it('should update PocketBase record', async () => {
            vi.mocked(appUser.getUser).mockResolvedValue({
                id: mockUserId,
                name: 'New Name',
                avatar: 'avatar.png',
                syncServerUrl: 'http://test'
            } as UserRecord);
            vi.mocked(mockCollection.update).mockResolvedValue({
                id: mockUserId
            } as unknown as RecordModel);

            await UserSyncService.pushUser();

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
                avatar: 'data:image/png;base64,abc',
                syncServerUrl: 'http://test'
            } as UserRecord);

            await UserSyncService.pushUser();

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
            await UserSyncService.pushUser();
            expect(pb.collection).not.toHaveBeenCalled();

            (pb.authStore as unknown as { isValid: boolean }).isValid = true;
            vi.mocked(getActiveSession).mockReturnValue({
                userId: mockUserId,
                masterKey: {} as CryptoKey,
                identityKeyPair: {} as CryptoKeyPair
            });
            // Simulate a local-only user
            vi.mocked(appUser.getUser).mockResolvedValue({
                id: mockUserId,
                name: 'Local User'
            } as UserRecord);
            await UserSyncService.pushUser();
            expect(pb.collection).not.toHaveBeenCalled();
        });
    });

    describe('pullUser', () => {
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
            const realBlob = new Blob([new TextEncoder().encode('remote')], {
                type: 'image/png'
            });
            mockFetch.mockResolvedValue({
                ok: true,
                blob: vi.fn().mockResolvedValue(realBlob)
            });

            vi.mocked(appUser.getUser).mockResolvedValue({
                id: mockUserId,
                name: 'Local Name',
                avatar: '',
                syncServerUrl: 'http://test'
            } as UserRecord);

            await UserSyncService.pullUser();

            expect(mockCollection.getOne).toHaveBeenCalledWith(mockUserId);
            expect(appUser.saveUser).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: mockUserId,
                    name: 'Remote Name',
                    avatar: mockDataUri,
                    updatedAt: expect.any(Number)
                }),
                { origin: 'sync' }
            );
        });
    });

    describe('Realtime Subscription', () => {
        it('should subscribe to user record', async () => {
            vi.mocked(appUser.getUser).mockResolvedValue({
                id: mockUserId,
                name: 'Name',
                avatar: '',
                syncServerUrl: 'http://test'
            } as UserRecord);
            await UserSyncService.subscribeRealtime();

            expect(mockCollection.subscribe).toHaveBeenCalledWith(mockUserId, expect.any(Function));
        });

        it('should unsubscribe', async () => {
            // Use type casting to access private static member for testing
            (UserSyncService as unknown as { subscribed: boolean }).subscribed = true;

            await UserSyncService.unsubscribeRealtime();

            expect(mockCollection.unsubscribe).toHaveBeenCalledWith(mockUserId);
        });
    });
});
