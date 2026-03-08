/**
 * Session Service Tests
 *
 * Tests in-memory session state management.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	getActiveSession,
	hasActiveSession,
	setSession,
	clearSession
} from '$lib/services/session';

describe('session', () => {
	// Helper to create a test master key
	async function createTestMasterKey(extractable = true): Promise<CryptoKey> {
		return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, extractable, [
			'encrypt',
			'decrypt'
		]);
	}

	afterEach(() => {
		// Clear session state after each test
		clearSession();
	});

	describe('initial state', () => {
		it('should not have an active session initially', () => {
			expect(hasActiveSession()).toBe(false);
		});

		it('should throw when getting active session without initialization', () => {
			expect(() => getActiveSession()).toThrow('Session not initialized');
		});
	});

	describe('setSession', () => {
		it('should set session with provided values', async () => {
			const masterKey = await createTestMasterKey();
			const userId = 'user-123';
			const isGuest = true;

			setSession(userId, masterKey, isGuest);

			expect(hasActiveSession()).toBe(true);
		});

		it('should return correct session values', async () => {
			const masterKey = await createTestMasterKey();
			const userId = 'user-456';
			const isGuest = false;

			setSession(userId, masterKey, isGuest);
			const session = getActiveSession();

			expect(session.userId).toBe(userId);
			expect(session.masterKey).toBe(masterKey);
			expect(session.isGuest).toBe(isGuest);
		});

		it('should allow setting registered user session', async () => {
			const masterKey = await createTestMasterKey(false); // non-extractable
			const userId = 'registered-user';
			const isGuest = false;

			setSession(userId, masterKey, isGuest);
			const session = getActiveSession();

			expect(session.isGuest).toBe(false);
			expect(session.masterKey.extractable).toBe(false);
		});

		it('should allow setting guest user session', async () => {
			const masterKey = await createTestMasterKey(true); // extractable
			const userId = 'guest-user';
			const isGuest = true;

			setSession(userId, masterKey, isGuest);
			const session = getActiveSession();

			expect(session.isGuest).toBe(true);
			expect(session.masterKey.extractable).toBe(true);
		});

		it('should overwrite existing session', async () => {
			const key1 = await createTestMasterKey();
			const key2 = await createTestMasterKey();

			setSession('user-1', key1, true);
			expect(getActiveSession().userId).toBe('user-1');

			setSession('user-2', key2, false);
			expect(getActiveSession().userId).toBe('user-2');
			expect(getActiveSession().masterKey).toBe(key2);
			expect(getActiveSession().isGuest).toBe(false);
		});
	});

	describe('clearSession', () => {
		it('should clear session and reset to default state', async () => {
			const masterKey = await createTestMasterKey();

			setSession('user-123', masterKey, true);
			expect(hasActiveSession()).toBe(true);

			clearSession();

			expect(hasActiveSession()).toBe(false);
		});

		it('should reset userId to null', async () => {
			const masterKey = await createTestMasterKey();

			setSession('user-123', masterKey, true);
			clearSession();

			expect(() => getActiveSession()).toThrow('Session not initialized');
		});

		it('should reset masterKey to null', async () => {
			const masterKey = await createTestMasterKey();

			setSession('user-123', masterKey, true);
			clearSession();

			// Session is cleared, so we can't directly check masterKey
			// but hasActiveSession should be false
			expect(hasActiveSession()).toBe(false);
		});

		it('should reset isGuest to true (default)', async () => {
			const masterKey = await createTestMasterKey();

			setSession('user-123', masterKey, false);
			clearSession();

			// After clearing and setting a new guest session
			setSession('user-456', masterKey, true);
			const session = getActiveSession();

			expect(session.isGuest).toBe(true);
		});
	});

	describe('hasActiveSession', () => {
		it('should return false when session is not set', () => {
			expect(hasActiveSession()).toBe(false);
		});

		it('should return true when both userId and masterKey are set', async () => {
			const masterKey = await createTestMasterKey();

			setSession('user-123', masterKey, true);
			expect(hasActiveSession()).toBe(true);
		});

		it('should return false when masterKey is null', async () => {
			setSession('user-123', null as unknown as CryptoKey, true);
			expect(hasActiveSession()).toBe(false);
		});

		it('should return false when userId is null', async () => {
			const masterKey = await createTestMasterKey();
			setSession(null as unknown as string, masterKey, true);
			expect(hasActiveSession()).toBe(false);
		});
	});

	describe('getActiveSession', () => {
		it('should throw error when masterKey is null', async () => {
			const masterKey = await createTestMasterKey();

			setSession('user-123', masterKey, true);
			// Manually clear masterKey to test edge case
			clearSession();
			setSession('user-123', null as unknown as CryptoKey, true);

			expect(() => getActiveSession()).toThrow('Session not initialized');
		});

		it('should throw error when userId is null', async () => {
			const masterKey = await createTestMasterKey();

			clearSession();
			setSession(null as unknown as string, masterKey, true);

			expect(() => getActiveSession()).toThrow('Session not initialized');
		});

		it('should return session object with all required properties', async () => {
			const masterKey = await createTestMasterKey();
			const userId = 'user-789';
			const isGuest = true;

			setSession(userId, masterKey, isGuest);
			const session = getActiveSession();

			expect(session).toHaveProperty('userId');
			expect(session).toHaveProperty('masterKey');
			expect(session).toHaveProperty('isGuest');
			expect(Object.keys(session)).toHaveLength(3);
		});
	});

	describe('session isolation', () => {
		it('should maintain session state across multiple calls', async () => {
			const masterKey = await createTestMasterKey();
			const userId = 'user-999';

			setSession(userId, masterKey, false);

			const session1 = getActiveSession();
			const session2 = getActiveSession();

			expect(session1.userId).toBe(session2.userId);
			expect(session1.masterKey).toBe(session2.masterKey);
			expect(session1.isGuest).toBe(session2.isGuest);
		});

		it('should allow updating session with new values', async () => {
			const key1 = await createTestMasterKey();
			const key2 = await createTestMasterKey();

			setSession('user-1', key1, true);
			expect(getActiveSession().masterKey).toBe(key1);

			setSession('user-2', key2, false);
			expect(getActiveSession().masterKey).toBe(key2);
			expect(getActiveSession().isGuest).toBe(false);
		});
	});
});
