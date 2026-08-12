import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, getActiveSession, hasActiveSession } from '$lib/services/session';
import { UserService } from '$lib/services/user';

vi.mock('$lib/adapters/user', () => ({
    appUser: {
        getUser: vi.fn()
    }
}));

vi.mock('$lib/adapters/kv', () => ({
    appKV: {
        set: vi.fn(),
        get: vi.fn(),
        remove: vi.fn()
    }
}));

vi.mock('$lib/adapters/multi', () => ({
    appMulti: {
        purgeUserLocal: vi.fn()
    }
}));

import { appUser } from '$lib/adapters/user';
import { appKV } from '$lib/adapters/kv';

describe('UserService Session Management', () => {
    const masterKey = {} as CryptoKey;
    const identityKeyPair = {} as CryptoKeyPair;

    beforeEach(async () => {
        clearSession();
        vi.clearAllMocks();
        vi.mocked(appKV.get).mockResolvedValue('user-1');
        vi.mocked(appUser.getUser).mockResolvedValue({
            id: 'user-1',
            name: 'User',
            avatar: '',
            createdAt: 1,
            updatedAt: 1,
            masterKey,
            identityKeyPair,
            connections: { server: { mode: 'default' }, proxy: { mode: 'default' } }
        });
    });

    it('loads active local identity state', async () => {
        await UserService.restoreOrCreateUser();

        expect(getActiveSession().userId).toBe('user-1');
    });

    it('tracks active and sync availability', async () => {
        expect(hasActiveSession()).toBe(false);

        await UserService.restoreOrCreateUser();

        expect(hasActiveSession()).toBe(true);
    });

    it('throws when no session is initialized', () => {
        expect(() => getActiveSession()).toThrow('Active session not found');
    });
});
