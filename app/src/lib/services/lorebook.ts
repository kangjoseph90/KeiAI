import { getActiveSession, encryptText, decryptText } from '../session.js';
import { localDB, type LorebookRecord } from '../db/index.js';

// ─── Domain Types ────────────────────────────────────────────────────

export interface LorebookEntry {
	id: string;
	keys: string[];
	content: string;
	insertionDepth: number;
	enabled: boolean;
	regex?: string;
	probability?: number;
}

export interface LorebookFields {
	name: string;
	description: string;
	entries: LorebookEntry[];
}

export interface Lorebook extends LorebookFields {
	id: string;
	createdAt: number;
	updatedAt: number;
}

// ─── Service ─────────────────────────────────────────────────────────

export class LorebookService {
	static async list(): Promise<Lorebook[]> {
		const { masterKey, userId } = getActiveSession();
		const records = await localDB.getAll<LorebookRecord>('lorebooks', userId);

		const results: Lorebook[] = [];
		for (const record of records) {
			const fields: LorebookFields = JSON.parse(
				await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.encryptedDataIV })
			);
			results.push({
				id: record.id, ...fields,
				createdAt: record.createdAt, updatedAt: record.updatedAt
			});
		}
		return results;
	}

	static async get(id: string): Promise<Lorebook | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<LorebookRecord>('lorebooks', id);
		if (!record || record.isDeleted) return null;

		const fields: LorebookFields = JSON.parse(
			await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.encryptedDataIV })
		);
		return { id: record.id, ...fields, createdAt: record.createdAt, updatedAt: record.updatedAt };
	}

	/** Batch fetch by IDs — used by chat controller to load all connected lorebooks */
	static async getMany(ids: string[]): Promise<Lorebook[]> {
		const results: Lorebook[] = [];
		for (const id of ids) {
			const lb = await this.get(id);
			if (lb) results.push(lb);
		}
		return results;
	}

	static async create(
		ownerId: string,
		fields: LorebookFields
	): Promise<Lorebook> {
		const { masterKey, userId } = getActiveSession();
		const id = crypto.randomUUID();
		const now = Date.now();
		const enc = await encryptText(masterKey, JSON.stringify(fields));

		await localDB.putRecord<LorebookRecord>('lorebooks', {
			id, userId, ownerId, createdAt: now, updatedAt: now, isDeleted: false,
			encryptedData: enc.ciphertext, encryptedDataIV: enc.iv
		});

		return { id, ...fields, createdAt: now, updatedAt: now };
	}

	static async update(
		id: string,
		changes: Partial<LorebookFields>
	): Promise<Lorebook | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<LorebookRecord>('lorebooks', id);
		if (!record || record.isDeleted) return null;

		const current: LorebookFields = JSON.parse(
			await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.encryptedDataIV })
		);
		const updated = { ...current, ...changes };
		const enc = await encryptText(masterKey, JSON.stringify(updated));

		record.encryptedData = enc.ciphertext;
		record.encryptedDataIV = enc.iv;
		record.updatedAt = Date.now();
		await localDB.putRecord('lorebooks', record);

		return { id, ...updated, createdAt: record.createdAt, updatedAt: record.updatedAt };
	}

	static async delete(id: string): Promise<void> {
		await localDB.softDeleteRecord('lorebooks', id);
	}
}
