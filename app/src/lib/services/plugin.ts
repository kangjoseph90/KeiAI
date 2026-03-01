import { getActiveSession, encryptText, decryptText } from '../session.js';
import { localDB, type PluginRecord } from '../db/index.js';
import { deepMerge } from '../utils/defaults.js';

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

// ─── Defaults ────────────────────────────────────────────────────────

const defaultPluginFields: PluginFields = {
	name: '',
	description: '',
	version: '',
	code: '',
	config: {},
	hooks: []
};

// ─── Helpers ─────────────────────────────────────────────────────────

function decryptFields(masterKey: CryptoKey, record: PluginRecord): Promise<PluginFields> {
	return decryptText(masterKey, {
		ciphertext: record.encryptedData,
		iv: record.encryptedDataIV
	}).then((dec) => deepMerge(defaultPluginFields, JSON.parse(dec)));
}

// ─── Service ─────────────────────────────────────────────────────────

export class PluginService {
	static async list(): Promise<Plugin[]> {
		const { masterKey, userId } = getActiveSession();
		const records = await localDB.getAll<PluginRecord>('plugins', userId);

		return Promise.all(
			records.map(async (record) => {
				const fields = await decryptFields(masterKey, record);
				return {
					id: record.id,
					...fields,
					createdAt: record.createdAt,
					updatedAt: record.updatedAt
				};
			})
		);
	}

	static async get(id: string): Promise<Plugin | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<PluginRecord>('plugins', id);
		if (!record || record.isDeleted) return null;

		const fields = await decryptFields(masterKey, record);
		return {
			id: record.id,
			...fields,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt
		};
	}

	static async create(fields: PluginFields): Promise<Plugin> {
		const { masterKey, userId } = getActiveSession();
		const id = crypto.randomUUID();
		const now = Date.now();
		const enc = await encryptText(masterKey, JSON.stringify(fields));

		await localDB.putRecord<PluginRecord>('plugins', {
			id,
			userId,
			createdAt: now,
			updatedAt: now,
			isDeleted: false,
			encryptedData: enc.ciphertext,
			encryptedDataIV: enc.iv
		});

		return { id, ...fields, createdAt: now, updatedAt: now };
	}

	static async update(id: string, changes: Partial<PluginFields>): Promise<Plugin | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<PluginRecord>('plugins', id);
		if (!record || record.isDeleted) return null;

		const current = await decryptFields(masterKey, record);
		const updated: PluginFields = deepMerge(current, changes as Record<string, unknown>);
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
