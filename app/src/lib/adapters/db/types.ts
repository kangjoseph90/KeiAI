/**
 * Local Database Types — KeiAI
 *
 * Local DB stores plaintext JSON. Encryption happens only at the sync
 * boundary (Sync Engine ↔ PocketBase).
 *
 * Relationship patterns:
 *   1:N — Parent's data blob holds EntityListConfig<OrderedRef>
 *         for child IDs (order + folder managed by parent).
 *         High-volume exceptions use local FK indexes:
 *         chats.roomId, messages.[chatId+sortOrder].
 *   N:M — Consumer's data blob holds EntityListConfig<OrderedRef> when membership is binary,
 *         or EntityListConfig<ResourceRef> when per-context enabled state is required.
 */

import type { AssetEntries } from '$lib/types/asset';

// ─── Table Registry ──────────────────────────────────────────────────

export type TableName =
    | 'rooms'
    | 'characters'
    | 'chats'
    | 'presets'
    | 'messages'
    | 'settings'
    | 'personas'
    | 'modules'
    | 'plugins'
    | 'tool_calls';

export const SYNC_TABLES: TableName[] = [
    'rooms',
    'characters',
    'chats',
    'presets',
    'messages',
    'settings',
    'personas',
    'modules',
    'plugins'
];

export const LOCAL_TABLES: TableName[] = ['tool_calls'];

export const TABLES: TableName[] = [...SYNC_TABLES, ...LOCAL_TABLES];

export type DatabaseWriteOperation =
    | 'put'
    | 'putMany'
    | 'delete'
    | 'deleteByIndex'
    | 'softDelete'
    | 'softDeleteByIndex'
    | 'softDeleteByCompoundIndex'
    | 'purge';

export type DatabaseMutationOrigin = 'local' | 'sync';

export interface DatabaseWriteOptions {
    origin?: DatabaseMutationOrigin;
}

export interface DatabaseWriteEvent {
    tableName: TableName;
    operation: DatabaseWriteOperation;
    ids: string[];
    origin: DatabaseMutationOrigin;
}

export type DatabaseWriteEventListener = (events: DatabaseWriteEvent[]) => void;

// ─── Base Types ──────────────────────────────────────────────────────

export interface DataScope {
    scopeType: DataScopeType;
    scopeId: string;
}

export type DataScopeType = 'user' | 'room';

/** Standard record — stores domain fields as plaintext JSON */
export interface DataRecord {
    id: string;
    scopeType: DataScopeType;
    scopeId: string; // userId or roomId
    createdAt: number;
    updatedAt: number;
    /** Assigned by local persistence, including accepted sync changes; absent before saving. */
    localUpdatedAt?: number;
    /** Local wall time when this replica first held the record as a tombstone; never synced. */
    tombstoneAt?: number;
    isDeleted: boolean;
    data: Record<string, unknown>;
    assetEntries?: AssetEntries;
}

// ─── Rooms ──────────────────────────────────────────────────────────

export type RoomRecord = DataRecord;

// ─── Characters ──────────────────────────────────────────────────────

export type CharacterRecord = DataRecord;

// ─── Chats ───────────────────────────────────────────────────────────

export interface ChatRecord extends DataRecord {
    roomId: string;
}

// ─── Messages ─────

// Exception to the 1:N pattern: Messages manage their own sortOrder.
// Since chats can easily exceed 10,000+ messages, storing message refs in the parent's
// data blob would require O(n) rewrites on every single message sent.
// Using a database index [chatId+sortOrder] ensures O(1) writes and faster pagination.
export interface MessageRecord extends DataRecord {
    chatId: string;
    sortOrder: string;
    activeSwipeId: string;
}

export interface DatabaseKeyEntry extends DataScope {
    primaryKey: string;
    indexKey: string[];
}

// ─── Settings ────────────────────────────────────────────────────────

export type SettingsRecord = DataRecord;

// ─── Personas ────────────────────────────────────────────────────────

export type PersonaRecord = DataRecord;

// ─── Single-table entities ───────────────────────────────────────────

export type ModuleRecord = DataRecord;
export type PluginRecord = DataRecord;

// ─── Presets ─────────────────────────────────────────────────────────

export type PresetRecord = DataRecord;

// ─── Tool Calls ──────────────────────────────────────────────────────

export interface ToolCallRecord extends DataRecord {
    chatId: string;
}

// ─── Sync Safety ─────────────────────────────────────────────────────

/** A History–Clean checkpoint held by this replica for one scope. See docs/sync-gc.md. */
export interface SyncCheckpoint {
    id: string;
    /** Own local revision whose prefix the checkpoint covers; 0 when inherited. */
    anchor: number;
    /** Local revision by which this replica knew the checkpoint's deletions. */
    heldAt: number;
    /** Local wall time, used only for retention. */
    createdAt: number;
}

/**
 * A scope's replica state on this client. `lineage` names the history its records descend
 * from; replicas of different lineages never merge. `adopting` marks a replacement by a
 * server's state in progress, and `bootstrapping` a server being filled from this replica:
 * neither partial state is a valid replica, and both restart after an interruption.
 */
export interface SyncScopeState {
    lineage: string | null;
    adopting: boolean;
    /** `token` identifies the bootstrap's lease on the server; it is recorded first. */
    bootstrapping: { serverUrl: string; lineage: string; token: string } | null;
}

export interface TombstoneCollection {
    /** Only tombstones first received at or before this wall time. */
    receivedThrough: number;
    /** Only tombstones at or below this local revision. */
    throughLocalUpdatedAt: number;
}

// ─── Adapter Interface ──────────────────────────────────────────────

export interface IDatabaseAdapter {
    /** Last committed local revision; later writes must receive a greater value. */
    getLocalUpdatedAt(): Promise<number>;
    subscribeWriteEvents(listener: DatabaseWriteEventListener): () => void;
    flush(): Promise<void>;
    getRecord<T extends DataRecord>(tableName: TableName, id: string): Promise<T | undefined>;
    putRecord<T extends DataRecord>(
        tableName: TableName,
        record: T,
        options?: DatabaseWriteOptions
    ): Promise<void>;
    putRecords<T extends DataRecord>(
        tableName: TableName,
        records: T[],
        options?: DatabaseWriteOptions
    ): Promise<void>;
    deleteRecord(tableName: TableName, id: string, options?: DatabaseWriteOptions): Promise<void>;
    deleteByIndex(
        tableName: TableName,
        indexName: string,
        indexValue: string,
        options?: DatabaseWriteOptions
    ): Promise<void>;
    deleteByScope(
        tableName: TableName,
        scope: DataScope,
        options?: DatabaseWriteOptions
    ): Promise<number>;
    softDeleteRecord(
        tableName: TableName,
        id: string,
        options?: DatabaseWriteOptions
    ): Promise<void>;
    softDeleteByIndex(
        tableName: TableName,
        indexName: string,
        indexValue: string,
        options?: DatabaseWriteOptions
    ): Promise<void>;
    softDeleteByCompoundIndex(
        tableName: TableName,
        indexName: string,
        indexValue: string[],
        options?: DatabaseWriteOptions
    ): Promise<void>;
    getAll<T extends DataRecord>(tableName: TableName, scope: DataScope): Promise<T[]>;
    getByIndex<T extends DataRecord>(
        tableName: TableName,
        indexName: string,
        indexValue: string,
        limit?: number,
        offset?: number
    ): Promise<T[]>;
    getScopeIdsByType(tableName: TableName, scopeType: DataScopeType): Promise<string[]>;
    getByCompoundIndex<T extends DataRecord>(
        tableName: TableName,
        indexName: string,
        indexValue: string[],
        limit?: number,
        offset?: number
    ): Promise<T[]>;
    getRecordsBackward<T extends DataRecord>(
        tableName: TableName,
        indexName: string,
        lowerBound: unknown[],
        upperBound: unknown[],
        limit?: number,
        offset?: number
    ): Promise<T[]>;
    getRecordsForward<T extends DataRecord>(
        tableName: TableName,
        indexName: string,
        lowerBound: unknown[],
        upperBound: unknown[],
        limit?: number,
        offset?: number
    ): Promise<T[]>;
    getKeys(
        tableName: TableName,
        indexName: string,
        lowerBound: unknown[],
        upperBound: unknown[],
        limit?: number,
        offset?: number
    ): Promise<DatabaseKeyEntry[]>;
    countRecordsInRange(
        tableName: TableName,
        indexName: string,
        lowerBound: unknown[],
        upperBound: unknown[]
    ): Promise<number>;
    getUnsyncedChanges<T extends DataRecord>(
        tableName: TableName,
        scope: DataScope,
        afterLocalUpdatedAt: number,
        throughLocalUpdatedAt: number
    ): Promise<T[]>;
    transaction<R>(tables: TableName[], mode: 'r' | 'rw', callback: () => Promise<R>): Promise<R>;
    countByIndex(tableName: TableName, indexName: string, indexValue: string): Promise<number>;
    /**
     * Highest local revision of a sync-table tombstone this replica no longer stores.
     * Every hard delete of such a tombstone raises it before the row disappears.
     */
    getSyncGcHigh(scope: DataScope): Promise<number>;
    /** Garbage-collect expired tombstones in every sync table; returns the new GC watermark. */
    collectTombstones(scope: DataScope, options: TombstoneCollection): Promise<number>;
    getSyncCheckpoints(scope: DataScope): Promise<SyncCheckpoint[]>;
    /** Add unknown checkpoints with a fresh local revision as `heldAt`; known ids are kept as-is. */
    addSyncCheckpoints(
        scope: DataScope,
        checkpoints: Array<Pick<SyncCheckpoint, 'id' | 'anchor'>>
    ): Promise<void>;
    pruneSyncCheckpoints(scope: DataScope, createdBefore: number): Promise<void>;
    getSyncScopeState(scope: DataScope): Promise<SyncScopeState>;
    setSyncScopeState(scope: DataScope, state: SyncScopeState): Promise<void>;
    /** Whether any sync table holds a record or tombstone of the scope. */
    hasScopeRecords(scope: DataScope): Promise<boolean>;
    /**
     * Drop the scope's records, tombstones, GC watermark and checkpoints. Only for a scope
     * marked `adopting`: its knowledge is being replaced by a server's, not forgotten.
     * `keepRecords` drops only the knowledge, for a scope adopted because it held nothing:
     * anything written since is new data of the adopted replica.
     */
    resetSyncScope(scope: DataScope, options?: { keepRecords?: boolean }): Promise<void>;
    /**
     * Take over a server's forgotten deletions at one fresh local revision: the watermark
     * moves there when `forgotten`, and the server's checkpoints are anchored there.
     */
    adoptSyncState(
        scope: DataScope,
        adopted: { forgotten: boolean; checkpoints: string[] }
    ): Promise<void>;
}
