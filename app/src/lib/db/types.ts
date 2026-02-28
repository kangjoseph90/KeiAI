/**
 * Local Database Types — KeiAI
 *
 * Relationship patterns:
 *   1:N — Parent's encrypted blob holds OrderedRef[] of child IDs
 *         (order + folder managed by parent). Exception: messages use chatId FK.
 *   N:M — Consumer's encrypted blob holds ResourceRef[] with per-context state.
 *
 * Every table (except `users` and `assets`) stores AES-GCM encrypted JSON blobs.
 * Entities needing list previews are split into Summary + Data tables.
 */

type Bytes = Uint8Array<ArrayBuffer>;

// ─── Shared Reference Types ─────────────────────────────────────────

/** Ordered reference for 1:N parent→child lists */
export interface OrderedRef {
	id: string;
	sortOrder: string; // Fractional index for ordering
	folderId?: string;
}

/** Reference with per-context state for N:M relationships */
export interface ResourceRef extends OrderedRef {
	enabled: boolean;
}

/** Folder definition (stored in parent's blob) */
export interface FolderDef {
	id: string;
	name: string;
	sortOrder: string;
	color?: string;
	parentId?: string; // Nested folders
}

// ─── Table Registry ──────────────────────────────────────────────────

export type TableName =
	| 'users'
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
	| 'promptPresetSummaries'
	| 'promptPresetData';

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

// ─── Users (special — master key can't encrypt itself) ───────────────
//
// masterKey is stored as a CryptoKey object directly in IndexedDB
// (via Structured Clone), not as raw bytes. This prevents XSS from
// exfiltrating key material.
//
//   Guest:      extractable: true  (needed to create M(Y) on registration)
//   Registered: extractable: false (raw bytes can never be exported)

export interface UserRecord extends BaseRecord {
	isGuest: boolean;
	masterKey: CryptoKey;
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

// ─── Prompt Presets (Summary + Data) ─────────────────────────────────

export type PromptPresetSummaryRecord = EncryptedRecord;
export type PromptPresetDataRecord = EncryptedRecord;

// ─── Assets (separate system — plaintext, no sync) ───────────────────

export interface AssetRecord {
	id: string; // SHA-256 content hash
	userId: string;
	kind: 'regular' | 'inlay';
	visibility: 'private' | 'public';
	mimeType: string;
	data: Blob;
	cdnUrl?: string;
	selfHostedUrl?: string;
	createdAt: number;
}

export interface AssetEntry {
	name: string;
	assetId: string;
}

// ─── Adapter Interface ──────────────────────────────────────────────

export interface IDatabaseAdapter {
	getRecord<T extends BaseRecord>(tableName: TableName, id: string): Promise<T | undefined>;
	putRecord<T extends BaseRecord>(tableName: TableName, record: T): Promise<void>;
	putRecords<T extends BaseRecord>(tableName: TableName, records: T[]): Promise<void>;
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
