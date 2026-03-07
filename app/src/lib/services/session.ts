/**
 * Session — In-Memory Auth Context
 *
 * Pure runtime state: masterKey + userId + isGuest.
 * No adapter imports, no side effects. Just module-scoped variables.
 *
 * Services call getActiveSession() to obtain credentials for DB operations.
 * UserService and AuthService call setSession()/clearSession() to mutate state.
 *
 * Master key storage strategy:
 *   - Guest:      CryptoKey with extractable: true  (can create M(Y) later)
 *   - Registered: CryptoKey with extractable: false (XSS cannot export raw bytes)
 */

// ─── In-Memory Session State ─────────────────────────────────────────

let activeMasterKey: CryptoKey | null = null;
let activeUserId: string | null = null;
let isGuestUser: boolean = true;

// ─── Accessors ───────────────────────────────────────────────────────

export function getActiveSession(): { userId: string; masterKey: CryptoKey; isGuest: boolean } {
	if (!activeUserId || !activeMasterKey) {
		throw new Error('Session not initialized.');
	}
	return { userId: activeUserId, masterKey: activeMasterKey, isGuest: isGuestUser };
}

export function hasActiveSession(): boolean {
	return activeMasterKey !== null && activeUserId !== null;
}

// ─── Mutation ────────────────────────────────────────────────────────

/**
 * Set the in-memory session state.
 * KV persistence (activeUserId) is managed by UserService, not here.
 */
export function setSession(userId: string, masterKey: CryptoKey, isGuest: boolean): void {
	activeUserId = userId;
	activeMasterKey = masterKey;
	isGuestUser = isGuest;
}

export function clearSession(): void {
	activeMasterKey = null;
	activeUserId = null;
	isGuestUser = true;
}
