import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    currentUserId: 'user-1',
    persistPbAuth: vi.fn(),
    stopAutoRefresh: vi.fn(),
    startAutoRefresh: vi.fn(),
    clearAllPbAuthForUser: vi.fn(),
    selectUser: vi.fn(),
    createUser: vi.fn(),
    deleteUser: vi.fn(),
    getAllUsers: vi.fn(),
    stopAutoSync: vi.fn(),
    startAutoSync: vi.fn(),
    stopSyncStoreBindings: vi.fn(),
    startSyncStoreBindings: vi.fn(),
    resetRouteForReload: vi.fn(),
    reload: vi.fn()
}));

vi.mock('$lib/services', () => ({
    getActiveSession: () => ({ userId: mocks.currentUserId }),
    hasActiveSession: () => true,
    AuthService: {
        persistPbAuth: mocks.persistPbAuth,
        stopAutoRefresh: mocks.stopAutoRefresh,
        startAutoRefresh: mocks.startAutoRefresh,
        clearAllPbAuthForUser: mocks.clearAllPbAuthForUser
    },
    ConnectionService: {
        isServerTransitionLocked: () => false
    },
    UserService: {
        selectUser: mocks.selectUser,
        createUser: mocks.createUser,
        deleteUser: mocks.deleteUser,
        getAllUsers: mocks.getAllUsers
    }
}));

vi.mock('$lib/services/sync', () => ({
    SyncManager: { stopAutoSync: mocks.stopAutoSync, startAutoSync: mocks.startAutoSync }
}));

vi.mock('$lib/stores/sync', () => ({
    stopSyncStoreBindings: mocks.stopSyncStoreBindings,
    startSyncStoreBindings: mocks.startSyncStoreBindings
}));

vi.mock('$lib/router', () => ({ resetRouteForReload: mocks.resetRouteForReload }));

vi.mock('$lib/adapters/window', () => ({
    appWindow: { reload: mocks.reload }
}));

import { createAndSwitchLocalUser, deleteActiveLocalUser, switchLocalUser } from '$lib/stores/user';

describe('user store actions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.currentUserId = 'user-1';
        mocks.createUser.mockResolvedValue({ id: 'user-new' });
        mocks.getAllUsers.mockResolvedValue([{ id: 'user-1' }, { id: 'user-2' }]);
    });

    it('selects the next user without replacing the current session', async () => {
        await switchLocalUser('user-2');

        expect(mocks.persistPbAuth).toHaveBeenCalledWith('user-1');
        expect(mocks.resetRouteForReload).toHaveBeenCalledOnce();
        expect(mocks.stopSyncStoreBindings).toHaveBeenCalledOnce();
        expect(mocks.stopAutoRefresh).toHaveBeenCalledOnce();
        expect(mocks.selectUser).toHaveBeenCalledWith('user-2');
        expect(mocks.reload).toHaveBeenCalledOnce();
        expect(mocks.persistPbAuth.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.selectUser.mock.invocationCallOrder[0]
        );
    });

    it('creates a local user through the same activation flow', async () => {
        await createAndSwitchLocalUser();

        expect(mocks.persistPbAuth).toHaveBeenCalledWith('user-1');
        expect(mocks.selectUser).toHaveBeenCalledWith('user-new');
        expect(mocks.reload).toHaveBeenCalledOnce();
    });

    it('restores the current selection when reload fails', async () => {
        mocks.reload.mockRejectedValueOnce(new Error('reload failed'));

        await expect(switchLocalUser('user-2')).rejects.toThrow('reload failed');

        expect(mocks.selectUser).toHaveBeenLastCalledWith('user-1');
        expect(mocks.startAutoRefresh).toHaveBeenCalledOnce();
        expect(mocks.startAutoSync).toHaveBeenCalledOnce();
        expect(mocks.startSyncStoreBindings).toHaveBeenCalledOnce();
    });

    it('deletes the active user and restores the fallback user auth', async () => {
        await deleteActiveLocalUser();

        expect(mocks.clearAllPbAuthForUser).toHaveBeenCalledWith('user-1');
        expect(mocks.resetRouteForReload).toHaveBeenCalledOnce();
        expect(mocks.stopSyncStoreBindings).toHaveBeenCalledOnce();
        expect(mocks.deleteUser).toHaveBeenCalledWith('user-1');
        expect(mocks.selectUser).toHaveBeenCalledWith('user-2');
        expect(mocks.createUser).not.toHaveBeenCalled();
        expect(mocks.reload).toHaveBeenCalledOnce();
    });

    it('creates a replacement when deleting the final local user', async () => {
        mocks.getAllUsers.mockResolvedValue([{ id: 'user-1' }]);

        await deleteActiveLocalUser();

        expect(mocks.createUser).toHaveBeenCalledOnce();
        expect(mocks.selectUser).toHaveBeenCalledWith('user-new');
    });
});
