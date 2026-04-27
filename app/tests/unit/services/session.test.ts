import { beforeEach, describe, expect, it } from 'vitest';
import {
    clearSession,
    getActiveSession,
    hasActiveSession,
    setSession
} from '$lib/services/session';

describe('session', () => {
    const masterKey = {} as CryptoKey;
    const identityKeyPair = {} as CryptoKeyPair;

    beforeEach(() => {
        clearSession();
    });

    it('stores active local identity state', () => {
        setSession('user-1', masterKey, identityKeyPair);

        expect(getActiveSession().userId).toBe('user-1');
    });

    it('tracks active and sync availability', () => {
        expect(hasActiveSession()).toBe(false);

        setSession('user-1', masterKey, identityKeyPair);

        expect(hasActiveSession()).toBe(true);
    });

    it('throws when no session is initialized', () => {
        expect(() => getActiveSession()).toThrow('Session not initialized.');
    });

    it('clears session state', () => {
        setSession('user-1', masterKey, identityKeyPair);
        clearSession();

        expect(hasActiveSession()).toBe(false);
    });
});
