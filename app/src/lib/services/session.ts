/**
 * Session — In-Memory Auth Context
 *
 * Pure runtime state: userId + masterKey + identityKeyPair.
 * No adapter imports, no side effects. Just module-scoped variables.
 *
 * Master key is always present (generated with the local identity) but only
 * consumed at the sync boundary. Identity key pair is stored for future
 * multi-room key exchange but not yet exposed via accessors.
 */

// ─── In-Memory Session State ─────────────────────────────────────────

let activeUserId: string | null = null;
let activeMasterKey: CryptoKey | null = null;
let activeIdentityKeyPair: CryptoKeyPair | null = null;

// ─── Accessors ───────────────────────────────────────────────────────

import { AppError } from '$lib/types/errors';

/** Service layer: only userId is needed for local DB operations. */
export function getActiveSession(): {
    userId: string;
    masterKey: CryptoKey;
    identityKeyPair: CryptoKeyPair;
} {
    if (!activeUserId || !activeMasterKey || !activeIdentityKeyPair) {
        throw new AppError('SESSION_EXPIRED', 'Session not initialized.');
    }
    return {
        userId: activeUserId,
        masterKey: activeMasterKey,
        identityKeyPair: activeIdentityKeyPair
    };
}

export function hasActiveSession(): boolean {
    return activeUserId !== null && activeMasterKey !== null && activeIdentityKeyPair !== null;
}

// ─── Mutation ────────────────────────────────────────────────────────

/**
 * Set the in-memory session state.
 * KV persistence (activeUserId) is managed by UserService, not here.
 */
export function setSession(
    userId: string,
    masterKey: CryptoKey,
    identityKeyPair: CryptoKeyPair
): void {
    activeUserId = userId;
    activeMasterKey = masterKey;
    activeIdentityKeyPair = identityKeyPair;
}

export function clearSession(): void {
    activeUserId = null;
    activeMasterKey = null;
    activeIdentityKeyPair = null;
}
