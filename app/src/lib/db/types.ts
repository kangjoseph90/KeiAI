/**
 * Local Database Adapter Types for KeiAI
 * 
 * Defines the generic interface that any local database implementation
 * (Dexie for web, Tauri SQLite for desktop, Capacitor SQLite for mobile) must follow.
 */

// List of all managed tables
export type TableName = 'users' | 'characters' | 'chats' | 'messages' | 'settings';

/**
 * Base record structure required for all entities to support sync.
 */
export interface BaseRecord {
	id: string; // UUID v4
	userId: string; // Owner of this data
	createdAt: number; // Unix timestamp
	updatedAt: number; // For LWW (Last-Write-Wins) syncing
	isDeleted: boolean; // Logical deletion (Tombstone) for syncing
}

type Bytes = Uint8Array<ArrayBuffer>;

// ─── Entities ─────────────────────────────────────────────────────────

export interface UserRecord extends BaseRecord {
	isGuest: boolean;
	masterKey: Bytes; // Keep as bytes for now; later we'll move to OS secure storage
}

export interface CharacterRecord extends BaseRecord {
	encryptedSummary: Bytes; // Decrypted: { name, avatarAssetId, shortDescription }
	summaryIv: Bytes;

	encryptedData: Bytes; // Decrypted: { systemPrompt, advancedConfig, scenarios, etc. }
	dataIv: Bytes;
}

export interface ChatRecord extends BaseRecord {
	characterId: string; // Foreign Key
	encryptedSummary: Bytes; // Decrypted: { title, lastMessagePreview }
	summaryIv: Bytes;
}

export interface MessageRecord extends BaseRecord {
	chatId: string; // Foreign Key
	encryptedData: Bytes; // Decrypted: { role, content, hasEdits, etc. }
	dataIv: Bytes;
}

export interface SettingsRecord extends BaseRecord {
	encryptedData: Bytes; // Global settings payload
	dataIv: Bytes;
}

// ─── Adapter Interface ────────────────────────────────────────────────

export interface IDatabaseAdapter {
	/** Retrieve a single record by ID */
	getRecord<T extends BaseRecord>(tableName: TableName, id: string): Promise<T | undefined>;
	
	/** Insert or update a single record */
	putRecord<T extends BaseRecord>(tableName: TableName, record: T): Promise<void>;
	
	/** Bulk insert/update records (efficient for sync) */
	putRecords<T extends BaseRecord>(tableName: TableName, records: T[]): Promise<void>;
	
	/** Logically delete a record (sets isDeleted = true) */
	softDeleteRecord(tableName: TableName, id: string): Promise<void>;

	/** Get all non-deleted records for a specific user */
	getAll<T extends BaseRecord>(tableName: TableName, userId: string): Promise<T[]>;
	
	/** Map to a specific index (e.g. chatId) with pagination */
	getByIndex<T extends BaseRecord>(
		tableName: TableName,
		indexName: string,
		indexValue: string,
		limit?: number,
		offset?: number
	): Promise<T[]>;

	/** Fetch all records modified after a given timestamp (for sync) */
	getUnsyncedChanges<T extends BaseRecord>(
		tableName: TableName,
		userId: string,
		sinceUpdatedAt: number
	): Promise<T[]>;
}
