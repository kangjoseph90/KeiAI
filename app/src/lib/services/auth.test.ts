import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    authRefresh: vi.fn(),
    clear: vi.fn(),
    state: { token: 'token', valid: true }
}));

vi.mock('$lib/adapters/pb', () => ({
    pb: {
        authStore: {
            get token() {
                return mocks.state.token;
            },
            get isValid() {
                return mocks.state.valid;
            },
            clear: mocks.clear,
            onChange: vi.fn()
        },
        collection: () => ({ authRefresh: mocks.authRefresh })
    }
}));
vi.mock('./user', () => ({ UserService: {} }));
vi.mock('./sync', () => ({
    DataRecordSyncEngine: {},
    MultiRecordSyncEngine: {},
    SyncManager: {}
}));
vi.mock('./sync/user', () => ({ decryptUserProfile: vi.fn(), encryptUserProfile: vi.fn() }));
vi.mock('$lib/adapters/logger', () => ({
    createLogger: () => ({ warn: vi.fn() })
}));

import { AuthService } from './auth';

describe('AuthService.refreshPbAuth', () => {
    beforeEach(() => {
        mocks.state.token = 'token';
        mocks.state.valid = true;
        mocks.clear.mockReset();
        mocks.clear.mockImplementation(() => {
            mocks.state.token = '';
            mocks.state.valid = false;
        });
        mocks.authRefresh.mockReset();
    });

    it('refreshes a valid token', async () => {
        mocks.authRefresh.mockResolvedValue({});

        await expect(AuthService.refreshPbAuth({ force: true })).resolves.toBe(true);
        expect(mocks.authRefresh).toHaveBeenCalledOnce();
        expect(mocks.clear).not.toHaveBeenCalled();
    });

    it('keeps only one refresh request in flight', async () => {
        let resolveRefresh: (() => void) | undefined;
        mocks.authRefresh.mockImplementation(
            () => new Promise<void>((resolve) => (resolveRefresh = resolve))
        );

        const first = AuthService.refreshPbAuth({ force: true });
        const second = AuthService.refreshPbAuth({ force: true });
        resolveRefresh?.();

        await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
        expect(mocks.authRefresh).toHaveBeenCalledOnce();
    });

    it('preserves a valid token after a transient failure', async () => {
        mocks.authRefresh.mockRejectedValue({ status: 0 });

        await expect(AuthService.refreshPbAuth({ force: true })).resolves.toBe(true);
        expect(mocks.clear).not.toHaveBeenCalled();
    });

    it('clears a token rejected by the server', async () => {
        mocks.authRefresh.mockRejectedValue({ status: 401 });

        await expect(AuthService.refreshPbAuth({ force: true })).resolves.toBe(false);
        expect(mocks.clear).toHaveBeenCalledOnce();
    });
});
