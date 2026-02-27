import { getActiveSession, encryptText, decryptText } from '../session.js';
import { localDB, type PluginRecord } from '../db/index.js';

// ─── Domain Types ────────────────────────────────────────────────────

export interface PluginFields {
	name: string;
	description: string;
	version: string;
	code: string; // Sandboxed JS source
	config: Record<string, unknown>;
	hooks: PluginHook[];
}

export interface PluginHook {
	event: 'beforePrompt' | 'afterPrompt' | 'beforeSend' | 'afterReceive' | 'onRender';
	handler: string; // Function name in plugin code
}

export interface Plugin extends PluginFields {
	id: string;
	createdAt: number;
	updatedAt: number;
}

// ─── Service ─────────────────────────────────────────────────────────

export class PluginService {
	static async list(): Promise<Plugin[]> {
		const { masterKey, userId } = getActiveSession();
		const records = await localDB.getAll<PluginRecord>('plugins', userId);

		const results: Plugin[] = [];
		for (const record of records) {
			const fields: PluginFields = JSON.parse(
				await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.encryptedDataIV })
			);
			results.push({
				id: record.id, ...fields,
				createdAt: record.createdAt, updatedAt: record.updatedAt
			});
		}
		return results;
	}

	static async get(id: string): Promise<Plugin | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<PluginRecord>('plugins', id);
		if (!record || record.isDeleted) return null;

		const fields: PluginFields = JSON.parse(
			await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.encryptedDataIV })
		);
		return { id: record.id, ...fields, createdAt: record.createdAt, updatedAt: record.updatedAt };
	}

	static async getMany(ids: string[]): Promise<Plugin[]> {
		const results: Plugin[] = [];
		for (const id of ids) {
			const p = await this.get(id);
			if (p) results.push(p);
		}
		return results;
	}

	static async create(fields: PluginFields): Promise<Plugin> {
		const { masterKey, userId } = getActiveSession();
		const id = crypto.randomUUID();
		const now = Date.now();
		const enc = await encryptText(masterKey, JSON.stringify(fields));

		await localDB.putRecord<PluginRecord>('plugins', {
			id, userId, createdAt: now, updatedAt: now, isDeleted: false,
			encryptedData: enc.ciphertext, encryptedDataIV: enc.iv
		});

		return { id, ...fields, createdAt: now, updatedAt: now };
	}

	static async update(id: string, changes: Partial<PluginFields>): Promise<Plugin | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<PluginRecord>('plugins', id);
		if (!record || record.isDeleted) return null;

		const current: PluginFields = JSON.parse(
			await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.encryptedDataIV })
		);
		const updated = { ...current, ...changes };
		const enc = await encryptText(masterKey, JSON.stringify(updated));

		record.encryptedData = enc.ciphertext;
		record.encryptedDataIV = enc.iv;
		record.updatedAt = Date.now();
		await localDB.putRecord('plugins', record);

		return { id, ...updated, createdAt: record.createdAt, updatedAt: record.updatedAt };
	}

	static async delete(id: string): Promise<void> {
		await localDB.softDeleteRecord('plugins', id);
	}
}
