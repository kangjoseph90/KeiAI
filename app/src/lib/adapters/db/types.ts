/**
 * Local Database Types — KeiAI
 *
 * Relationship patterns:
 *   1:N — Parent's encrypted blob holds OrderedRef[] of child IDs
 *         (order + folder managed by parent). Exception: messages use chatId FK.
 *   N:M — Consumer's encrypted blob holds ResourceRef[] with per-context state.
 *
 * Every table stores AES-GCM encrypted JSON blobs.
 * Entities needing list previews are split into Summary + Data tables.
 */

type Bytes = Uint8Array<ArrayBuffer>;

// ─── Constants ───────────────────────────────────────────────────────
export const DB_DEBOUNCE_MS = 500;

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
	| 'presetData';

export const TABLES: TableName[] = [
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
	'presetData'
];

export type DatabaseWriteOperation =
	| 'put'
	| 'putMany'
	| 'delete'
	| 'deleteByIndex'
	| 'softDelete'
	| 'softDeleteByIndex';

export type DatabaseMutationOrigin = 'local' | 'sync';

export interface DatabaseWriteOptions {
	origin?: DatabaseMutationOrigin;
	immediate?: boolean;
}

export interface DatabaseWriteEvent {
	tableName: TableName;
	operation: DatabaseWriteOperation;
	ids: string[];
	origin: DatabaseMutationOrigin;
}

export type DatabaseWriteEventListener = (events: DatabaseWriteEvent[]) => void;

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

// ─── Adapter Interface ──────────────────────────────────────────────

export interface IDatabaseAdapter {
	subscribeWriteEvents(listener: DatabaseWriteEventListener): () => void;
	flush(): Promise<void>;
	getRecord<T extends BaseRecord>(tableName: TableName, id: string): Promise<T | undefined>;
	putRecord<T extends BaseRecord>(
		tableName: TableName,
		record: T,
		options?: DatabaseWriteOptions
	): Promise<void>;
	putRecords<T extends BaseRecord>(
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
	softDeleteRecord(tableName: TableName, id: string, options?: DatabaseWriteOptions): Promise<void>;
	softDeleteByIndex(
		tableName: TableName,
		indexName: string,
		indexValue: string,
		options?: DatabaseWriteOptions
	): Promise<void>;
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
