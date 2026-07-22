import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getActiveSession, hasActiveSession } from '$lib/services/session';
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

describe('UserService Session Management', () => {
    const masterKey = {} as CryptoKey;
    const identityKeyPair = {} as CryptoKeyPair;

    beforeEach(async () => {
        await UserService.clearActiveUser();
        vi.clearAllMocks();
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
        await UserService.setActiveUser('user-1');

        expect(getActiveSession().userId).toBe('user-1');
    });

    it('tracks active and sync availability', async () => {
        expect(hasActiveSession()).toBe(false);

        await UserService.setActiveUser('user-1');

        expect(hasActiveSession()).toBe(true);
    });

    it('throws when no session is initialized', () => {
        expect(() => getActiveSession()).toThrow('Active session not found');
    });

    it('clears session state', async () => {
        await UserService.setActiveUser('user-1');
        await UserService.clearActiveUser();

        expect(hasActiveSession()).toBe(false);
    });
});
