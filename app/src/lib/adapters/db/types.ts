/**
 * Local Database Types — KeiAI
 *
 * Relationship patterns:
 *   1:N — Parent's encrypted blob holds OrderedRef[] of child IDs
 *         (order + folder managed by parent). Exception: messages use chatId FK.
 *   N:M — Consumer's encrypted blob holds ResourceRef[] with per-context state.
 *
 * Every table (except `users`) stores AES-GCM encrypted JSON blobs.
 * The `cacheRegistry` table is a local-only LRU eviction ledger and is never synced.
 * Entities needing list previews are split into Summary + Data tables.
 */

type Bytes = Uint8Array<ArrayBuffer>;

// ─── Table Registry ──────────────────────────────────────────────────

export type TableName =
	| 'characterSummaries'
	| 'characterData'
	| 'chatSummaries'
	| 'chatData'
	| 'messages'
	| 'settings'
	| 'personas'
	| 'lorebooks'
	| 'scripts'
	| 'modules'
	| 'plugins'
	| 'presetSummaries'
	| 'presetData'
	| 'assets'
	| 'cacheRegistry';

export const SYNC_TABLES: TableName[] = [
	'characterSummaries',
	'characterData',
	'chatSummaries',
	'chatData',
	'messages',
	'settings',
	'personas',
	'lorebooks',
	'scripts',
	'modules',
	'plugins',
	'presetSummaries',
	'presetData',
	'assets'
];

export const TABLES: TableName[] = [
	...SYNC_TABLES,
	'cacheRegistry'
];

// ─── Base Types ──────────────────────────────────────────────────────

export interface BaseRecord {
	id: string;
	userId: string;
	createdAt: number;
	updatedAt: number;
	isDeleted: boolean;
}

/** Standard encrypted payload — used by every table except `users` */
export interface EncryptedRecord extends BaseRecord {
	encryptedData: Bytes; // AES-GCM ciphertext of JSON.stringify(...)
	encryptedDataIV: Bytes; // Random 12-byte nonce
}

// ─── Characters (Summary + Data) ─────────────────────────────────────

export type CharacterSummaryRecord = EncryptedRecord;
export type CharacterDataRecord = EncryptedRecord;

// ─── Chats (Summary + Data) ───

export interface ChatSummaryRecord extends EncryptedRecord {
	characterId: string;
}
export interface ChatDataRecord extends EncryptedRecord {
	characterId: string;
}

// ─── Messages ─────

// Exception to the 1:N pattern: Messages manage their own sortOrder.
// Since chats can easily exceed 10,000+ messages, storing an OrderedRef[] in the parent's
// encrypted blob would require O(n) AES-GCM decryption/encryption on every single message sent.
// Using a database index [chatId+sortOrder] ensures O(1) writes and faster pagination.
export interface MessageRecord extends EncryptedRecord {
	chatId: string;
	sortOrder: string;
}

// ─── Settings ────────────────────────────────────────────────────────

export type SettingsRecord = EncryptedRecord;

// ─── Personas ────────────────────────────────────────────────────────

export type PersonaRecord = EncryptedRecord;

// ─── Single-table entities ───────────────────────────────────────────

export interface LorebookRecord extends EncryptedRecord {
	ownerId: string;
}
export interface ScriptRecord extends EncryptedRecord {
	ownerId: string;
}
export type ModuleRecord = EncryptedRecord;
export type PluginRecord = EncryptedRecord;

// ─── Presets (Summary + Data) ────────────────────────────────────────

export type PresetSummaryRecord = EncryptedRecord;
export type PresetDataRecord = EncryptedRecord;

// ─── Assets ────────────────────────────────────────────────────────
//
// All asset kinds (private, inlay, public) live in the same EncryptedRecord table.
// encryptedData contains: { kind, mimeType, remoteUrl? }
//   - remoteUrl absent  → local-only asset (never evictable)
//   - remoteUrl present → remote asset (local storage = LRU cache)

export type AssetRecord = EncryptedRecord;

// ─── Cache Registry ─────────────────────────────────────────────────
//
// LOCAL-ONLY table — never synced to the server.
// Tracks remote asset caches stored in IStorageAdapter so the LRU eviction
// logic knows which files are safe to delete.
// Files present in IStorageAdapter but NOT in cacheRegistry = persistent
// local-only assets → must never be evicted.
//
// Note: extends BaseRecord to satisfy IDatabaseAdapter generics.
// `userId`, `createdAt`, `updatedAt`, `isDeleted` are unused sentinels.

export interface CacheRegistryRecord extends BaseRecord {
	lastAccessedAt: number; // Unix ms — updated every time the asset is rendered
	size: number;           // Bytes on disk — used to calculate total cache size
}

// ─── Adapter Interface ──────────────────────────────────────────────

export interface IDatabaseAdapter {
	getRecord<T extends BaseRecord>(tableName: TableName, id: string): Promise<T | undefined>;
	putRecord<T extends BaseRecord>(tableName: TableName, record: T): Promise<void>;
	putRecords<T extends BaseRecord>(tableName: TableName, records: T[]): Promise<void>;
	deleteRecord(tableName: TableName, id: string): Promise<void>;
	deleteByIndex(tableName: TableName, indexName: string, indexValue: string): Promise<void>;
	softDeleteRecord(tableName: TableName, id: string): Promise<void>;
	softDeleteByIndex(tableName: TableName, indexName: string, indexValue: string): Promise<void>;
	getAll<T extends BaseRecord>(tableName: TableName, userId: string): Promise<T[]>;
	getByIndex<T extends BaseRecord>(
		tableName: TableName,
		indexName: string,
		indexValue: string,
		limit?: number,
		offset?: number
	): Promise<T[]>;
	getRecordsBackward<T extends BaseRecord>(
		tableName: TableName,
		indexName: string,
		lowerBound: unknown[],
		upperBound: unknown[],
		limit?: number
	): Promise<T[]>;
	getRecordsForward<T extends BaseRecord>(
		tableName: TableName,
		indexName: string,
		lowerBound: unknown[],
		upperBound: unknown[],
		limit?: number
	): Promise<T[]>;
	getUnsyncedChanges<T extends BaseRecord>(
		tableName: TableName,
		userId: string,
		sinceUpdatedAt: number
	): Promise<T[]>;
	transaction<R>(tables: TableName[], mode: 'r' | 'rw', callback: () => Promise<R>): Promise<R>;
}
