import { isErrorCode } from '$lib/types/errors';
import type { DataScope } from '$lib/adapters/db';
import type { SyncState } from './base';
import { hasActiveSession, getActiveSession } from '../session';
import { pb } from '$lib/adapters/pb';

export const PAGE_SIZE = 200;
export const CHUNK_SIZE = 100;
export const MAX_DELETE_MARKER_ATTEMPTS = 5;

export type RealtimeEvent = {
    action: string;
    record: Record<string, unknown>;
};

export function isReadyToSync(): boolean {
    return pb.authStore.isValid && hasActiveSession();
}

export function getSyncKey(entity: string, ...segments: string[]): string {
    if (segments.length === 0) return `lastSync_${entity}`;
    return `lastSync_${entity}_${segments.join('_')}`;
}

export function belongsToScope(
    record: { scopeType: string; scopeId: string },
    scope: DataScope
): boolean {
    return record.scopeType === scope.scopeType && record.scopeId === scope.scopeId;
}

export interface SyncScope {
    scope: DataScope;
    key: CryptoKey;
    collection: string;
    ownerField: 'userId' | 'roomId';
}

export function getActiveSyncScopes(userCollection: string, roomCollection: string): SyncScope[] {
    const { userId, masterKey, roomId, roomKey } = getActiveSession();
    const scopes: SyncScope[] = [
        {
            scope: { scopeType: 'user', scopeId: userId },
            key: masterKey,
            collection: userCollection,
            ownerField: 'userId'
        }
    ];

    if (roomId && roomKey) {
        scopes.push({
            scope: { scopeType: 'room', scopeId: roomId },
            key: roomKey,
            collection: roomCollection,
            ownerField: 'roomId'
        });
    }

    return scopes;
}

export function getRealtimeScope(
    userCollection: string,
    collection: string,
    record: Record<string, unknown>
): SyncScope | null {
    const { userId, masterKey, roomId, roomKey } = getActiveSession();

    if (collection === userCollection) {
        if (record.userId !== userId) return null;
        return {
            scope: { scopeType: 'user', scopeId: userId },
            key: masterKey,
            collection,
            ownerField: 'userId'
        };
    }

    if (!roomId || !roomKey || record.roomId !== roomId) return null;
    return {
        scope: { scopeType: 'room', scopeId: roomId },
        key: roomKey,
        collection,
        ownerField: 'roomId'
    };
}

export function isQuotaError(error: unknown): boolean {
    if (isErrorCode(error, 'QUOTA_EXCEEDED')) return true;
    const status = (error as { status?: unknown })?.status;
    return status === 402 || status === 413 || status === 429;
}

export function isAuthError(error: unknown): boolean {
    if (isErrorCode(error, 'NOT_AUTHENTICATED') || isErrorCode(error, 'SESSION_EXPIRED')) {
        return true;
    }
    const status = (error as { status?: unknown })?.status;
    return status === 401 || status === 403;
}

export function toErrorState(error: unknown): SyncState {
    if (isQuotaError(error)) return 'quota_error';
    if (isAuthError(error)) return 'auth_error';
    return 'network_error';
}

export function isAbortError(error: unknown): boolean {
    return error instanceof DOMException
        ? error.name === 'AbortError'
        : error instanceof Error && error.name === 'AbortError';
}

export function normalizeTimestamp(primary: unknown, fallback: unknown): number {
    if (typeof primary === 'number') return primary;

    if (typeof primary === 'string') {
        const parsed = Number(primary);
        if (!Number.isNaN(parsed)) return parsed;
        const asDate = new Date(primary).getTime();
        if (!Number.isNaN(asDate)) return asDate;
    }

    if (typeof fallback === 'string') {
        const asDate = new Date(fallback).getTime();
        if (!Number.isNaN(asDate)) return asDate;
    }

    return 0;
}
