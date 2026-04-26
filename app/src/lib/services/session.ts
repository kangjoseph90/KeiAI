/**
 * Session — In-Memory Auth Context
 *
 * Pure runtime state: masterKey + userId + isGuest + identityKeyPair.
 * No adapter imports, no side effects. Just module-scoped variables.
 *
 * Services call getActiveSession() to obtain credentials for DB operations.
 * UserService and AuthService call setSession()/clearSession() to mutate state.
 *
 * Master key is optional — guests don't need one, and local DB operations
 * no longer require encryption. Only the Sync Engine needs masterKey via
 * getSyncSession().
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
    masterKey: CryptoKey | null;
    isGuest: boolean;
    identityKeyPair: CryptoKeyPair;
} {
    if (!activeUserId || !activeIdentityKeyPair) {
        throw new AppError('SESSION_EXPIRED', 'Session not initialized.');
    }
    return {
        userId: activeUserId,
        masterKey: activeMasterKey,
        isGuest: isGuestUser,
        identityKeyPair: activeIdentityKeyPair
    };
}

/** Sync Engine only: masterKey must exist for encryption at sync boundary */
export function getSyncSession(): {
    userId: string;
    masterKey: CryptoKey;
} {
    if (!activeUserId || !activeMasterKey) {
        throw new AppError('SESSION_EXPIRED', 'Sync session not available.');
    }
    return { userId: activeUserId, masterKey: activeMasterKey };
}

export function hasActiveSession(): boolean {
    return activeUserId !== null && activeIdentityKeyPair !== null;
}

export function hasSyncSession(): boolean {
    return activeUserId !== null && activeMasterKey !== null;
}

// ─── Mutation ────────────────────────────────────────────────────────

/**
 * Set the in-memory session state.
 * KV persistence (activeUserId) is managed by UserService, not here.
 */
export function setSession(
    userId: string,
    masterKey: CryptoKey | null,
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
