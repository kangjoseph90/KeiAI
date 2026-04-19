/**
 * Local Database Types — KeiAI
 *
 * Relationship patterns:
 *   1:N — Parent's encrypted blob holds OrderedRef[] of child IDs
 *         (order + folder managed by parent). Exception: messages use chatId FK.
 *   N:M — Consumer's encrypted blob holds ResourceRef[] with per-context state.
 *
 * Every table stores AES-GCM encrypted JSON blobs.
 */

type Bytes = Uint8Array<ArrayBuffer>;

// ─── Table Registry ──────────────────────────────────────────────────

export type TableName =
	| 'characters'
	| 'chats'
	| 'presets'
	| 'messages'
	| 'settings'
	| 'personas'
	| 'lorebooks'
	| 'scripts'
	| 'modules'
	| 'plugins'
	| 'toolCalls'
	| 'charjs';

export const SYNC_TABLES: TableName[] = [
	'characters',
	'chats',
	'presets',
	'messages',
	'settings',
	'personas',
	'lorebooks',
	'scripts',
	'modules',
	'plugins',
	'charjs'
];

export const LOCAL_TABLES: TableName[] = ['toolCalls'];

export const TABLES: TableName[] = [...SYNC_TABLES, ...LOCAL_TABLES];

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

// ─── Characters ──────────────────────────────────────────────────────

export type CharacterRecord = EncryptedRecord;

// ─── Chats ───────────────────────────────────────────────────────────

export interface ChatRecord extends EncryptedRecord {
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
export interface CharJSRecord extends EncryptedRecord {
	ownerId: string;
}
export type ModuleRecord = EncryptedRecord;
export type PluginRecord = EncryptedRecord;

// ─── Presets ─────────────────────────────────────────────────────────

export type PresetRecord = EncryptedRecord;

// ─── Tool Calls ──────────────────────────────────────────────────────

export interface ToolCallRecord extends EncryptedRecord {
	chatId: string;
}

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
		limit?: number,
		offset?: number
	): Promise<T[]>;
	getRecordsForward<T extends BaseRecord>(
		tableName: TableName,
		indexName: string,
		lowerBound: unknown[],
		upperBound: unknown[],
		limit?: number,
		offset?: number
	): Promise<T[]>;
	getUnsyncedChanges<T extends BaseRecord>(
		tableName: TableName,
		userId: string,
		sinceUpdatedAt: number
	): Promise<T[]>;
	transaction<R>(tables: TableName[], mode: 'r' | 'rw', callback: () => Promise<R>): Promise<R>;
}
