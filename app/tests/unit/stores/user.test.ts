import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    currentUserId: 'user-1',
    persistPbAuth: vi.fn(),
    restorePbAuth: vi.fn(),
    clearAllPbAuthForUser: vi.fn(),
    setActiveUser: vi.fn(),
    createUser: vi.fn(),
    deleteUser: vi.fn(),
    getAllUsers: vi.fn(),
    stopAutoSync: vi.fn(),
    initDefaultContents: vi.fn(),
    reload: vi.fn()
}));

vi.mock('$lib/services', () => ({
    getActiveSession: () => ({ userId: mocks.currentUserId }),
    hasActiveSession: () => true,
    AuthService: {
        persistPbAuth: mocks.persistPbAuth,
        restorePbAuth: mocks.restorePbAuth,
        clearAllPbAuthForUser: mocks.clearAllPbAuthForUser
    },
    ConnectionService: {
        isServerTransitionLocked: () => false
    },
    UserService: {
        setActiveUser: mocks.setActiveUser,
        createUser: mocks.createUser,
        deleteUser: mocks.deleteUser,
        getAllUsers: mocks.getAllUsers
    }
}));

vi.mock('$lib/services/sync', () => ({
    SyncManager: { stopAutoSync: mocks.stopAutoSync }
}));

vi.mock('$lib/stores/init', () => ({
    initDefaultContents: mocks.initDefaultContents
}));

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

    it('switches users through the auth save and restore flow', async () => {
        await switchLocalUser('user-2');

        expect(mocks.persistPbAuth).toHaveBeenCalledWith('user-1');
        expect(mocks.setActiveUser).toHaveBeenCalledWith('user-2');
        expect(mocks.restorePbAuth).toHaveBeenCalledWith('user-2');
        expect(mocks.reload).toHaveBeenCalledOnce();
        expect(mocks.persistPbAuth.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.setActiveUser.mock.invocationCallOrder[0]
        );
        expect(mocks.setActiveUser.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.restorePbAuth.mock.invocationCallOrder[0]
        );
    });

    it('creates a local user through the same activation flow', async () => {
        await createAndSwitchLocalUser();

        expect(mocks.persistPbAuth).toHaveBeenCalledWith('user-1');
        expect(mocks.setActiveUser).toHaveBeenCalledWith('user-new');
        expect(mocks.restorePbAuth).toHaveBeenCalledWith('user-new');
        expect(mocks.initDefaultContents).toHaveBeenCalledOnce();
        expect(mocks.reload).toHaveBeenCalledOnce();
    });

    it('deletes the active user and restores the fallback user auth', async () => {
        await deleteActiveLocalUser();

        expect(mocks.clearAllPbAuthForUser).toHaveBeenCalledWith('user-1');
        expect(mocks.deleteUser).toHaveBeenCalledWith('user-1');
        expect(mocks.setActiveUser).toHaveBeenCalledWith('user-2');
        expect(mocks.restorePbAuth).toHaveBeenCalledWith('user-2');
        expect(mocks.createUser).not.toHaveBeenCalled();
        expect(mocks.reload).toHaveBeenCalledOnce();
    });

    it('creates a replacement when deleting the final local user', async () => {
        mocks.getAllUsers.mockResolvedValue([{ id: 'user-1' }]);

        await deleteActiveLocalUser();

        expect(mocks.createUser).toHaveBeenCalledOnce();
        expect(mocks.setActiveUser).toHaveBeenCalledWith('user-new');
        expect(mocks.restorePbAuth).toHaveBeenCalledWith('user-new');
        expect(mocks.initDefaultContents).toHaveBeenCalledOnce();
    });
});
