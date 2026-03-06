import { getActiveSession, encryptText, decryptText } from '../session.js';
import { localDB, type PluginRecord } from '../adapters/db/index.js';
import { deepMerge } from '../shared/defaults.js';
import { AppError } from '../shared/errors.js';
import { generateId } from '../shared/id.js';

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
	})
		.then((dec) => deepMerge(defaultPluginFields, JSON.parse(dec)))
		.catch((error) => {
			throw new AppError('ENCRYPTION_FAILED', 'Failed to decrypt plugin', error);
		});
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
					...fields
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
			...fields
		};
	}

	static async create(fields: Partial<PluginFields> = {}): Promise<Plugin> {
		const resolved: PluginFields = deepMerge(defaultPluginFields, fields as Record<string, unknown>);

		const { masterKey, userId } = getActiveSession();
		const id = generateId();
		const now = Date.now();

		try {
			const enc = await encryptText(masterKey, JSON.stringify(resolved));
			await localDB.putRecord<PluginRecord>('plugins', {
				id, userId, createdAt: now, updatedAt: now, isDeleted: false,
				encryptedData: enc.ciphertext, encryptedDataIV: enc.iv
			});
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to create plugin', error);
		}

		return { id, ...resolved };
	}

	static async update(id: string, changes: Partial<PluginFields>): Promise<Plugin> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<PluginRecord>('plugins', id);
		if (!record || record.isDeleted) {
			throw new AppError('NOT_FOUND', `Plugin not found: ${id}`);
		}

		try {
			const current = await decryptFields(masterKey, record);
			const updated: PluginFields = deepMerge(current, changes as Record<string, unknown>);
			const enc = await encryptText(masterKey, JSON.stringify(updated));

			record.encryptedData = enc.ciphertext;
			record.encryptedDataIV = enc.iv;
			record.updatedAt = Date.now();
			await localDB.putRecord('plugins', record);

			return { id, ...updated };
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to update plugin', error);
		}
	}

	static async delete(id: string): Promise<void> {
		try {
			await localDB.softDeleteRecord('plugins', id);
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to delete plugin', error);
		}
	}
}
