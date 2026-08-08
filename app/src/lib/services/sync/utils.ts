import { AppError, isErrorCode } from '$lib/types/errors';
import type { DataScope } from '$lib/adapters/db';
import type { SyncState } from './base';
import { hasActiveSession, getActiveSession } from '../session';
import { pb } from '$lib/adapters/pb';
import { normalizeUrl } from '$lib/utils/url';
import type { SyncCursorIdentity, SyncCursorStream } from '$lib/adapters/sync';

export const PAGE_SIZE = 200;
export const CHUNK_SIZE = 100;

export type RealtimeEvent = {
    action: string;
    record: Record<string, unknown>;
};

export function isReadyToSync(): boolean {
    return pb.authStore.isValid && hasActiveSession();
}

export function getSyncCursorIdentity(
    stream: SyncCursorStream,
    userId: string,
    scope: DataScope
): SyncCursorIdentity {
    return {
        serverUrl: normalizeUrl(pb.baseUrl),
        userId,
        stream,
        scopeType: scope.scopeType,
        scopeId: scope.scopeId
    };
}

export async function getServerNow(): Promise<number> {
    const response = (await pb.send('/api/now', {
        method: 'GET',
        requestKey: null
    })) as { now?: unknown };
    if (typeof response.now !== 'number' || !Number.isFinite(response.now) || response.now <= 0) {
        throw new AppError('NETWORK_ERROR', 'Sync server returned an invalid timestamp');
    }
    return response.now;
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

    const errObj = error && typeof error === 'object' ? (error as Record<string, unknown>) : null;
    const status = errObj?.status;

    if (status === 402 || status === 413 || status === 429) return true;

    if (status === 400) {
        const message = error instanceof Error ? error.message : String(errObj?.message ?? '');
        return message.toLowerCase().includes('quota');
    }

    return false;
}

export function isAuthError(error: unknown): boolean {
    if (isErrorCode(error, 'NOT_AUTHENTICATED') || isErrorCode(error, 'SESSION_EXPIRED')) {
        return true;
    }
    const errObj = error && typeof error === 'object' ? (error as Record<string, unknown>) : null;
    return errObj?.status === 401 || errObj?.status === 403;
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
