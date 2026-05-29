import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import { UserRecordSyncEngineImpl } from '$lib/services/sync/user';
import { pb } from '$lib/adapters/pb';
import { getActiveSession, hasActiveSession } from '$lib/services/session';
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
        files: {}
    }
}));

vi.mock('$lib/services/user', () => ({
    UserService: {},
    toUser: vi.fn((u) => u)
}));

vi.mock('$lib/services/session', () => ({
    getActiveSession: vi.fn(),
    hasActiveSession: vi.fn()
}));

vi.mock('$lib/adapters/user', () => ({
    appUser: {
        getUser: vi.fn(),
        saveUser: vi.fn()
    }
}));

vi.mock('$lib/crypto', () => ({
    encrypt: vi.fn(() =>
        Promise.resolve({
            ciphertext: new Uint8Array([1, 2, 3]),
            iv: new Uint8Array([4, 5, 6])
        })
    ),
    decrypt: vi.fn(() =>
        Promise.resolve(JSON.stringify({ name: 'Remote Name', avatar: 'remote-avatar' }))
    ),
    toBase64: vi.fn((data: Uint8Array) => `b64:${Array.from(data).join(',')}`),
    fromBase64: vi.fn(() => new Uint8Array([1, 2, 3]))
}));

describe('UserRecordSyncEngine', () => {
    const mockUserId = 'user-123';
    let service: UserRecordSyncEngineImpl;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new UserRecordSyncEngineImpl();
        vi.mocked(getActiveSession).mockReturnValue({
            userId: mockUserId,
            masterKey: {} as CryptoKey,
            identityKeyPair: {} as CryptoKeyPair
        });
        vi.mocked(hasActiveSession).mockReturnValue(true);
        (pb.authStore as unknown as { isValid: boolean }).isValid = true;
        (service as unknown as { subscribed: boolean }).subscribed = false;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('local write push', () => {
        it('should update PocketBase record', async () => {
            vi.useFakeTimers();
            vi.mocked(appUser.getUser).mockResolvedValue({
                id: mockUserId,
                name: 'New Name',
                avatar: 'avatar.png',
                selfHostUrl: 'http://test'
            } as UserRecord);
            vi.mocked(mockCollection.update).mockResolvedValue({
                id: mockUserId
            } as unknown as RecordModel);

            service.handleLocalWrite({
                tableName: 'users',
                operation: 'put',
                ids: [mockUserId],
                origin: 'local'
            });
            await vi.advanceTimersByTimeAsync(3000);

            expect(mockCollection.update).toHaveBeenCalledWith(mockUserId, {
                encryptedProfile: 'b64:1,2,3',
                encryptedProfileIV: 'b64:4,5,6'
            });
        });

        it('should include avatar in the encrypted profile payload', async () => {
            vi.useFakeTimers();
            vi.mocked(mockCollection.update).mockResolvedValue({
                id: mockUserId
            } as unknown as RecordModel);
            vi.mocked(appUser.getUser).mockResolvedValue({
                id: mockUserId,
                name: 'Name',
                avatar: 'data:image/png;base64,abc',
                selfHostUrl: 'http://test'
            } as UserRecord);

            service.handleLocalWrite({
                tableName: 'users',
                operation: 'put',
                ids: [mockUserId],
                origin: 'local'
            });
            await vi.advanceTimersByTimeAsync(3000);

            expect(mockCollection.update).toHaveBeenCalledWith(mockUserId, {
                encryptedProfile: 'b64:1,2,3',
                encryptedProfileIV: 'b64:4,5,6'
            });
            expect(appUser.saveUser).not.toHaveBeenCalled();
        });

        it('should skip if auth or session is unavailable', async () => {
            vi.useFakeTimers();
            (pb.authStore as unknown as { isValid: boolean }).isValid = false;
            service.handleLocalWrite({
                tableName: 'users',
                operation: 'put',
                ids: [mockUserId],
                origin: 'local'
            });
            await vi.advanceTimersByTimeAsync(3000);
            expect(pb.collection).not.toHaveBeenCalled();

            (pb.authStore as unknown as { isValid: boolean }).isValid = true;
            vi.mocked(hasActiveSession).mockReturnValue(false);
            service.handleLocalWrite({
                tableName: 'users',
                operation: 'put',
                ids: [mockUserId],
                origin: 'local'
            });
            await vi.advanceTimersByTimeAsync(3000);
            expect(pb.collection).not.toHaveBeenCalled();
        });
    });

    describe('trigger', () => {
        it('should fetch from PocketBase and apply encrypted profile', async () => {
            const mockServerRecord = {
                encryptedProfile: 'profile',
                encryptedProfileIV: 'iv',
                updated: '2023-01-01T00:00:00Z'
            };
            vi.mocked(mockCollection.getOne).mockResolvedValue(
                mockServerRecord as unknown as RecordModel
            );

            vi.mocked(appUser.getUser).mockResolvedValue({
                id: mockUserId,
                name: 'Local Name',
                avatar: '',
                selfHostUrl: 'http://test'
            } as UserRecord);

            await service.trigger();

            expect(mockCollection.getOne).toHaveBeenCalledWith(mockUserId);
            expect(appUser.saveUser).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: mockUserId,
                    name: 'Remote Name',
                    avatar: 'remote-avatar',
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
                selfHostUrl: 'http://test'
            } as UserRecord);
            await service.subscribeRealtime();

            expect(mockCollection.subscribe).toHaveBeenCalledWith(mockUserId, expect.any(Function));
        });

        it('should subscribe even when the local user record is not created yet', async () => {
            vi.mocked(appUser.getUser).mockResolvedValue(null);

            await service.subscribeRealtime();

            expect(mockCollection.subscribe).toHaveBeenCalledWith(mockUserId, expect.any(Function));
        });

        it('should unsubscribe', async () => {
            // Use type casting to access private static member for testing
            (service as unknown as { subscribed: boolean }).subscribed = true;

            await service.unsubscribeRealtime();

            expect(mockCollection.unsubscribe).toHaveBeenCalledWith(mockUserId);
        });
    });
});
