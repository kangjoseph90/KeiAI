import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    signIn: vi.fn(),
    recover: vi.fn(),
    persistPbAuth: vi.fn(),
    restorePbAuth: vi.fn(),
    stopAutoRefresh: vi.fn(),
    startAutoRefresh: vi.fn(),
    isUserSwitchPending: vi.fn(),
    selectUser: vi.fn(),
    stopAutoSync: vi.fn(),
    startAutoSync: vi.fn(),
    syncAll: vi.fn(),
    reload: vi.fn(),
    loadUser: vi.fn(),
    loadGlobalState: vi.fn(),
    stopSyncStoreBindings: vi.fn(),
    startSyncStoreBindings: vi.fn(),
    resetRouteForReload: vi.fn()
}));

vi.mock('$lib/services', () => ({
    getActiveSession: () => ({ userId: 'user-1' }),
    AuthService: {
        isPbConnected: () => false,
        onPbAuthChange: vi.fn(),
        signIn: mocks.signIn,
        recoverAndResetPassword: mocks.recover,
        persistPbAuth: mocks.persistPbAuth,
        restorePbAuth: mocks.restorePbAuth,
        stopAutoRefresh: mocks.stopAutoRefresh,
        startAutoRefresh: mocks.startAutoRefresh
    },
    UserService: {
        isUserSwitchPending: mocks.isUserSwitchPending,
        selectUser: mocks.selectUser
    }
}));

vi.mock('$lib/services/sync', () => ({
    SyncManager: {
        stopAutoSync: mocks.stopAutoSync,
        startAutoSync: mocks.startAutoSync,
        syncAll: mocks.syncAll
    }
}));
vi.mock('$lib/adapters/window', () => ({ appWindow: { reload: mocks.reload } }));
vi.mock('$lib/stores/state', () => ({ pbConnected: { set: vi.fn() } }));
vi.mock('$lib/stores/user', () => ({ loadUser: mocks.loadUser }));
vi.mock('$lib/stores/content/character', () => ({ clearActiveCharacter: vi.fn() }));
vi.mock('$lib/stores/content/persona', () => ({ clearActivePersona: vi.fn() }));
vi.mock('$lib/stores/init', () => ({ loadGlobalState: mocks.loadGlobalState }));
vi.mock('$lib/stores/sync', () => ({
    stopSyncStoreBindings: mocks.stopSyncStoreBindings,
    startSyncStoreBindings: mocks.startSyncStoreBindings
}));
vi.mock('$lib/router', () => ({ resetRouteForReload: mocks.resetRouteForReload }));

import { performRecoverAndReset, performSignIn } from '$lib/stores/auth';

describe('auth store transitions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isUserSwitchPending.mockResolvedValue(false);
    });

    it('reloads without restarting background work after switching users', async () => {
        mocks.isUserSwitchPending.mockResolvedValue(true);

        await performSignIn('kei', 'password');

        expect(mocks.persistPbAuth).toHaveBeenCalledWith('user-1');
        expect(mocks.resetRouteForReload).toHaveBeenCalledOnce();
        expect(mocks.stopSyncStoreBindings).toHaveBeenCalledOnce();
        expect(mocks.reload).toHaveBeenCalledOnce();
        expect(mocks.startAutoRefresh).not.toHaveBeenCalled();
        expect(mocks.startAutoSync).not.toHaveBeenCalled();
    });

    it('restores the current user before resuming after authentication fails', async () => {
        mocks.signIn.mockRejectedValueOnce(new Error('failed'));

        await expect(performSignIn('kei', 'password')).rejects.toThrow('failed');

        expect(mocks.selectUser).toHaveBeenCalledWith('user-1');
        expect(mocks.restorePbAuth).toHaveBeenCalledWith('user-1');
        expect(mocks.startAutoRefresh).toHaveBeenCalledOnce();
        expect(mocks.startAutoSync).toHaveBeenCalledOnce();
    });

    it('returns a replacement recovery code without starting a user transition', async () => {
        mocks.recover.mockResolvedValue('new-recovery-code');

        await expect(performRecoverAndReset('old-code', 'new-password')).resolves.toBe(
            'new-recovery-code'
        );
        expect(mocks.stopAutoSync).not.toHaveBeenCalled();
        expect(mocks.reload).not.toHaveBeenCalled();
    });
});
