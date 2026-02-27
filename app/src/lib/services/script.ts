import { getActiveSession, encryptText, decryptText } from '../session.js';
import { localDB, type ScriptRecord } from '../db/index.js';

// ─── Domain Types ────────────────────────────────────────────────────

export interface ScriptRule {
	id: string;
	regex: string;
	replacement: string;
	placement: 'user_input' | 'ai_output' | 'system_prompt' | 'display';
	enabled: boolean;
}

export interface ScriptFields {
	name: string;
	description: string;
	rules: ScriptRule[];
}

export interface Script extends ScriptFields {
	id: string;
	createdAt: number;
	updatedAt: number;
}

// ─── Service ─────────────────────────────────────────────────────────

export class ScriptService {
	static async list(): Promise<Script[]> {
		const { masterKey, userId } = getActiveSession();
		const records = await localDB.getAll<ScriptRecord>('scripts', userId);

		const results: Script[] = [];
		for (const record of records) {
			const fields: ScriptFields = JSON.parse(
				await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.encryptedDataIV })
			);
			results.push({
				id: record.id, ...fields,
				createdAt: record.createdAt, updatedAt: record.updatedAt
			});
		}
		return results;
	}

	static async get(id: string): Promise<Script | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<ScriptRecord>('scripts', id);
		if (!record || record.isDeleted) return null;

		const fields: ScriptFields = JSON.parse(
			await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.encryptedDataIV })
		);
		return { id: record.id, ...fields, createdAt: record.createdAt, updatedAt: record.updatedAt };
	}

	static async getMany(ids: string[]): Promise<Script[]> {
		const results: Script[] = [];
		for (const id of ids) {
			const s = await this.get(id);
			if (s) results.push(s);
		}
		return results;
	}

	static async create(
		ownerId: string,
		fields: ScriptFields
	): Promise<Script> {
		const { masterKey, userId } = getActiveSession();
		const id = crypto.randomUUID();
		const now = Date.now();
		const enc = await encryptText(masterKey, JSON.stringify(fields));

		await localDB.putRecord<ScriptRecord>('scripts', {
			id, userId, ownerId, createdAt: now, updatedAt: now, isDeleted: false,
			encryptedData: enc.ciphertext, encryptedDataIV: enc.iv
		});

		return { id, ...fields, createdAt: now, updatedAt: now };
	}

	static async update(
		id: string,
		changes: Partial<ScriptFields>
	): Promise<Script | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<ScriptRecord>('scripts', id);
		if (!record || record.isDeleted) return null;

		const current: ScriptFields = JSON.parse(
			await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.encryptedDataIV })
		);
		const updated = { ...current, ...changes };
		const enc = await encryptText(masterKey, JSON.stringify(updated));

		record.encryptedData = enc.ciphertext;
		record.encryptedDataIV = enc.iv;
		record.updatedAt = Date.now();
		await localDB.putRecord('scripts', record);

		return { id, ...updated, createdAt: record.createdAt, updatedAt: record.updatedAt };
	}

	static async delete(id: string): Promise<void> {
		await localDB.softDeleteRecord('scripts', id);
	}
}
