/**
 * Session — In-Memory Auth Context
 *
 * Pure runtime state: masterKey + userId + isGuest + identityKeyPair.
 * No adapter imports, no side effects. Just module-scoped variables.
 *
 * Services call getActiveSession() to obtain credentials for DB operations.
 * UserService and AuthService call setSession()/clearSession() to mutate state.
 *
 * Master key storage strategy:
 *   - Guest:      CryptoKey with extractable: true  (can create M(Y) later)
 *   - Registered: CryptoKey with extractable: false (XSS cannot export raw bytes)
 *
 * Identity key pair storage strategy:
 *   - Guest:      private key extractable: true  (can wrap with M later)
 *   - Registered: private key extractable: false (XSS protection)
 */

// ─── In-Memory Session State ─────────────────────────────────────────

let activeMasterKey: CryptoKey | null = null;
let activeUserId: string | null = null;
let isGuestUser: boolean = true;
let activeIdentityKeyPair: CryptoKeyPair | null = null;

// ─── Accessors ───────────────────────────────────────────────────────

import { AppError } from '$lib/types/errors';

export function getActiveSession(): {
	userId: string;
	masterKey: CryptoKey;
	isGuest: boolean;
	identityKeyPair: CryptoKeyPair;
} {
	if (!activeUserId || !activeMasterKey || !activeIdentityKeyPair) {
		throw new AppError('SESSION_EXPIRED', 'Session not initialized.');
	}
	return {
		userId: activeUserId,
		masterKey: activeMasterKey,
		isGuest: isGuestUser,
		identityKeyPair: activeIdentityKeyPair
	};
}

export function hasActiveSession(): boolean {
	return activeMasterKey !== null && activeUserId !== null && activeIdentityKeyPair !== null;
}

// ─── Mutation ────────────────────────────────────────────────────────

/**
 * Set the in-memory session state.
 * KV persistence (activeUserId) is managed by UserService, not here.
 */
export function setSession(
	userId: string,
	masterKey: CryptoKey,
	isGuest: boolean,
	identityKeyPair: CryptoKeyPair
): void {
	activeUserId = userId;
	activeMasterKey = masterKey;
	isGuestUser = isGuest;
	activeIdentityKeyPair = identityKeyPair;
}

export function clearSession(): void {
	activeMasterKey = null;
	activeUserId = null;
	isGuestUser = true;
	activeIdentityKeyPair = null;
}
