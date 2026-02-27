/**
 * Blind Synchronization Engine
 *
 * Pushes/pulls encrypted byte arrays between local Dexie and PocketBase.
 * The server never decrypts or inspects any data.
 */

import { pb } from './pb.js';
import { getActiveSession } from '../session.js';
import { toBase64, fromBase64 } from '../crypto/index.js';
import { localDB, type TableName, type BaseRecord } from '../db/index.js';

export class SyncService {
	private static TABLES: TableName[] = [
		'characterSummaries',
		'characterData',
		'chatSummaries',
		'chatData',
		'messages',
		'settings'
	];

	static async syncAll(): Promise<void> {
		if (!pb.authStore.isValid) return;
		const { userId, isGuest } = getActiveSession();
		if (isGuest) return;

		console.log('Starting E2EE Blind Sync...');
		for (const table of this.TABLES) {
			await this.syncTable(table, userId);
		}
		console.log('Sync Complete.');
	}

	private static async syncTable(tableName: TableName, userId: string): Promise<void> {
		const syncKey = `lastSync_${tableName}_${userId}`;
		const lastSyncTime = parseInt(localStorage.getItem(syncKey) || '0', 10);
		const syncStartTime = Date.now();

		// --- PUSH ---
		const unsyncedLocal = await localDB.getUnsyncedChanges(tableName, userId, lastSyncTime);
		if (unsyncedLocal.length > 0) {
			console.log(`Pushing ${unsyncedLocal.length} records for ${tableName}...`);
			for (const record of unsyncedLocal) {
				const payload = this.localToPbRecord(record);
				try {
					try {
						await pb.collection(tableName).create(payload);
					} catch (e) {
						const err = e as { status?: number };
						if (err && err.status === 400) {
							await pb.collection(tableName).update(record.id, payload);
						} else {
							throw e;
						}
					}
				} catch (err) {
					console.error(`Failed to push ${record.id} in ${tableName}`, err);
				}
			}
		}

		// --- PULL ---
		try {
			const sinceISO = new Date(lastSyncTime).toISOString().replace('T', ' ');
			const serverChanges = await pb.collection(tableName).getFullList({
				filter: `updatedAt > '${sinceISO}'`,
				sort: 'updatedAt'
			});

			if (serverChanges.length > 0) {
				console.log(`Pulling ${serverChanges.length} records for ${tableName}...`);
				const records: BaseRecord[] = serverChanges.map((r) => this.pbToLocalRecord(r));
				await localDB.putRecords(tableName, records);
			}

			localStorage.setItem(syncKey, syncStartTime.toString());
		} catch (err) {
			console.error(`Failed to pull for ${tableName}`, err);
		}
	}

	/** Uint8Array → Base64 for JSON transport */
	private static localToPbRecord(record: BaseRecord): Record<string, unknown> {
		const payload = { ...record } as Record<string, unknown>;
		for (const key of Object.keys(payload)) {
			if (payload[key] instanceof Uint8Array) {
				payload[key] = toBase64(payload[key] as Uint8Array<ArrayBuffer>);
			}
		}
		return payload;
	}

	/** Base64 → Uint8Array for local storage */
	private static pbToLocalRecord(pbRecord: Record<string, unknown>): BaseRecord {
		const record = { ...pbRecord };
		// Symmetric with localToPbRecord: detect all base64-encoded byte fields
		for (const key of Object.keys(record)) {
			const val = record[key];
			if (typeof val === 'string' && this.isBase64ByteField(key)) {
				record[key] = fromBase64(val);
			}
		}

		if (typeof record.createdAt === 'string') {
			record.createdAt = new Date(record.createdAt).getTime();
		} else if (typeof record.created === 'string' && !record.createdAt) {
			record.createdAt = new Date(record.created).getTime();
		}

		if (typeof record.updatedAt === 'string') {
			record.updatedAt = new Date(record.updatedAt).getTime();
		} else if (typeof record.updated === 'string' && !record.updatedAt) {
			record.updatedAt = new Date(record.updated).getTime();
		}

		return record as unknown as BaseRecord;
	}

	/** Fields that are byte arrays when stored locally */
	private static readonly BYTE_FIELD_NAMES = new Set([
		'encryptedData', 'encryptedDataIV', 'masterKey'
	]);

	private static isBase64ByteField(fieldName: string): boolean {
		return this.BYTE_FIELD_NAMES.has(fieldName);
	}
}
