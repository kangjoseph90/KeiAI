import type { DataScopeType } from '$lib/adapters/db';

export type SyncCursorStream = 'records' | 'multi_meta';

export interface SyncCursorIdentity {
    serverUrl: string;
    userId: string;
    stream: SyncCursorStream;
    scopeType: DataScopeType;
    scopeId: string;
}

export interface SyncCursorState {
    serverPullCursor: number;
    localPushCursor: number;
}

export interface SyncCursorRecord extends SyncCursorIdentity, SyncCursorState {}

export type SyncCursorUpdate = Partial<SyncCursorState>;

export interface SyncCursorStreamQuery {
    serverUrl: string;
    userId: string;
    stream: SyncCursorStream;
}

export interface ISyncCursorAdapter {
    get(identity: SyncCursorIdentity): Promise<SyncCursorState>;
    advance(identity: SyncCursorIdentity, update: SyncCursorUpdate): Promise<void>;
    delete(identity: SyncCursorIdentity): Promise<void>;
    deleteByStream(query: SyncCursorStreamQuery): Promise<void>;
    deleteByUser(userId: string): Promise<void>;
}
