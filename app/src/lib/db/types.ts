/**
 * Local Database Types — KeiAI
 *
 * Every table (except `users`) has the exact same shape:
 *   id, [FK?], userId, createdAt, updatedAt, isDeleted, data, iv
 *
 * `data` is always an AES-GCM encrypted JSON blob.
 * `iv`   is the random nonce used to encrypt that blob.
 *
 * Entities that need list previews are split into two tables:
 *   *Summaries  — lightweight, always loaded for lists
 *   *Data       — heavy, loaded only when the entity is opened
 * Both tables share the same `id` for a given entity.
 */

type Bytes = Uint8Array<ArrayBuffer>;

// ─── Table Registry ──────────────────────────────────────────────────

export type TableName =
	| 'users'
	| 'characterSummaries'
	| 'characterData'
	| 'chatSummaries'
	| 'chatData'
	| 'messages'
	| 'settings';

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

export interface UserRecord extends BaseRecord {
	isGuest: boolean;
	masterKey: Bytes;
}

// ─── Characters ──────────────────────────────────────────────────────

export type CharacterSummaryRecord = EncryptedRecord;
export type CharacterDataRecord = EncryptedRecord;

// ─── Chats ───────────────────────────────────────────────────────────

export interface ChatSummaryRecord extends EncryptedRecord {
	characterId: string;
}
export type ChatDataRecord = EncryptedRecord;

// ─── Messages ────────────────────────────────────────────────────────

export interface MessageRecord extends EncryptedRecord {
	chatId: string;
}

// ─── Settings ────────────────────────────────────────────────────────

export type SettingsRecord = EncryptedRecord;

// ─── Adapter Interface ──────────────────────────────────────────────

export interface IDatabaseAdapter {
	getRecord<T extends BaseRecord>(tableName: TableName, id: string): Promise<T | undefined>;
	putRecord<T extends BaseRecord>(tableName: TableName, record: T): Promise<void>;
	putRecords<T extends BaseRecord>(tableName: TableName, records: T[]): Promise<void>;
	softDeleteRecord(tableName: TableName, id: string): Promise<void>;
	getAll<T extends BaseRecord>(tableName: TableName, userId: string): Promise<T[]>;
	getByIndex<T extends BaseRecord>(
		tableName: TableName,
		indexName: string,
		indexValue: string,
		limit?: number,
		offset?: number
	): Promise<T[]>;
	getUnsyncedChanges<T extends BaseRecord>(
		tableName: TableName,
		userId: string,
		sinceUpdatedAt: number
	): Promise<T[]>;
}
