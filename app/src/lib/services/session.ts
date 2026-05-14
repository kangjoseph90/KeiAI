import { AppError } from '$lib/types/errors';
import type { DataScope, DataScopeType } from '$lib/adapters/db';

export interface UserSession {
    userId: string;
    masterKey: CryptoKey;
    identityKeyPair: CryptoKeyPair;
}

export interface MultiRoomSession {
    roomId: string;
    roomKey: CryptoKey;
}

export interface Session extends UserSession {
    roomId?: string;
    roomKey?: CryptoKey;
}

let activeSession: Session | null = null;

export function setUserSession(session: UserSession): void {
    activeSession = session;
}

export function setMultiRoomSession(session: MultiRoomSession): void {
    if (!activeSession) {
        throw new AppError('NOT_FOUND', 'Active session not found');
    }
    activeSession = {
        ...activeSession,
        roomId: session.roomId,
        roomKey: session.roomKey
    };
}

export function clearSession(): void {
    activeSession = null;
}

export function clearMultiRoomSession(): void {
    if (!activeSession) {
        return;
    }
    activeSession = {
        userId: activeSession.userId,
        masterKey: activeSession.masterKey,
        identityKeyPair: activeSession.identityKeyPair
    };
}

export function hasActiveSession(): boolean {
    return activeSession !== null;
}

export function getActiveSession(): Session {
    if (activeSession) {
        return activeSession;
    }
    throw new AppError('SESSION_EXPIRED', 'Active session not found');
}

export function getSessionScope(scopeType: DataScopeType): DataScope {
    const { userId, roomId } = getActiveSession();
    if (scopeType === 'user') return { scopeType: 'user', scopeId: userId };
    if (scopeType === 'room' && roomId) return { scopeType: 'room', scopeId: roomId };
    throw new AppError('NOT_FOUND', 'Active room session not found');
}

export function canAccessScope(record: DataScope): boolean {
    const { userId, roomId } = getActiveSession();
    if (record.scopeType === 'user') return record.scopeId === userId;
    if (record.scopeType === 'room') return Boolean(roomId && record.scopeId === roomId);
    return false;
}

export function canAccessUserScope(record: DataScope): boolean {
    return record.scopeType === 'user' && canAccessScope(record);
}
