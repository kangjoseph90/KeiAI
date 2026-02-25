import { pb } from './pb.ts';
import { getActiveSession } from '../session.js';
import { toBase64, fromBase64 } from '../crypto/index.js';
import { localDB, type TableName, type BaseRecord } from '../db/index.ts';

/**
 * Blind Synchronization Engine
 * Pushes local encrypted bytes to PocketBase.
 * Pulls latest encrypted bytes from PocketBase and overrides local DB.
 * The server never knows what it is syncing.
 */
export class SyncService {
	// Tables to sync. Keep the order logical (Parents before children)
	private static TABLES: TableName[] = ['characters', 'chats', 'messages', 'settings'];

	/**
	 * Run a full bi-directional sync
	 */
	static async syncAll(): Promise<void> {
		if (!pb.authStore.isValid) return; // Must be logged in
		const { userId, isGuest } = getActiveSession();
		if (isGuest) return; // Guests don't sync

		console.log('🔄 Starting E2EE Blind Sync...');

		for (const table of this.TABLES) {
			await this.syncTable(table, userId);
		}

		console.log('✅ Sync Complete.');
	}

	private static async syncTable(tableName: TableName, userId: string): Promise<void> {
		// 1. Get the last time we synced this specific table
		const syncKey = `lastSync_${tableName}_${userId}`;
		const lastSyncTimeStr = localStorage.getItem(syncKey) || '0';
		const lastSyncTime = parseInt(lastSyncTimeStr, 10);
		
		const syncStartTime = Date.now();

		// --- 2. PUSH: Send local offline changes to Server ---
		const unsyncedLocal = await localDB.getUnsyncedChanges(tableName, userId, lastSyncTime);
		if (unsyncedLocal.length > 0) {
			console.log(`Pushing ${unsyncedLocal.length} records to PocketBase for ${tableName}...`);
			for (const record of unsyncedLocal) {
				const pbPayload = this.localToPbRecord(record);
				try {
					// We use upsert logic. In PB, you generally check if it exists or use a custom endpoint.
					// For standard PB setup, try create, catch and update.
					// *NOTE*: Using client-supplied IDs requires `id` field to be 15 chars alphanumeric in PB config,
					// OR you send the UUID as a separate `clientId` column and use that to search/update.
					try {
						await pb.collection(tableName).create(pbPayload);
					} catch (e: any) {
						if (e.status === 400) {
							// Exists, update it
							await pb.collection(tableName).update(record.id, pbPayload);
						} else {
							throw e;
						}
					}
				} catch (err) {
					console.error(`Failed to push record ${record.id} in ${tableName}`, err);
				}
			}
		}

		// --- 3. PULL: Get fresh encrypted blobs from Server ---
		try {
			// PocketBase filter syntax
			const serverChanges = await pb.collection(tableName).getFullList({
				filter: `updatedAt > ${lastSyncTime}`,
				sort: 'updatedAt'
			});

			if (serverChanges.length > 0) {
				console.log(`Pulling ${serverChanges.length} fresh records from server for ${tableName}...`);
				
				const recordsToPut: BaseRecord[] = [];
				for (const pbRecord of serverChanges) {
					recordsToPut.push(this.pbToLocalRecord(pbRecord));
				}

				// Slam them straight into Dexie. No decryption needed!
				await localDB.putRecords(tableName, recordsToPut);
			}

			// Update last sync time
			localStorage.setItem(syncKey, syncStartTime.toString());

		} catch (err) {
			console.error(`Failed to pull records for ${tableName}`, err);
		}
	}

	/**
	 * Convert local JS Object with Unit8Arrays to PocketBase JSON Payload
	 * Arrays are Base64 encoded for transport.
	 */
	private static localToPbRecord(record: any): any {
		const payload = { ...record };
		
		// Convert Uint8Array to string (Base64) for JSON transport
		for (const key of Object.keys(payload)) {
			if (payload[key] instanceof Uint8Array) {
				payload[key] = toBase64(payload[key] as Uint8Array<ArrayBuffer>);
			}
		}
		
		return payload;
	}

	/**
	 * Convert PocketBase JSON payload back to local JS Object with Uint8Arrays
	 */
	private static pbToLocalRecord(pbRecord: any): any {
		const record = { ...pbRecord };
		
		// You normally need strict type mapping here, but a quick heuristic for 
		// our schema is identifying known Encrypted/IV fields.
		const byteFields = ['encryptedSummary', 'summaryIv', 'encryptedData', 'dataIv', 'masterKey'];
		
		for (const field of byteFields) {
			if (typeof record[field] === 'string') {
				record[field] = fromBase64(record[field]);
			}
		}

		return record;
	}
}
