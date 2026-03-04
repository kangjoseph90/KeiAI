import { getActiveSession, encryptText, decryptText } from '../session.js';
import { localDB, type ModuleRecord } from '../adapters/db/index.js';
import type { AssetRef, FolderDef, OrderedRef } from '../shared/types.js';
import { deepMerge } from '../shared/defaults.js';
import { AppError } from '../shared/errors.js';

// ─── Domain Types ────────────────────────────────────────────────────

export interface ModuleRefs {
	lorebookRefs?: OrderedRef[];
	scriptRefs?: OrderedRef[];
	folders?: {
		lorebooks?: FolderDef[];
		scripts?: FolderDef[];
	};
	assets?: AssetRef[];
}

export interface ModuleContent {
	name: string;
	description: string;
}

export interface ModuleFields extends ModuleContent, ModuleRefs {}

export interface Module extends ModuleFields {
	id: string;
}

// ─── Defaults ────────────────────────────────────────────────────────

const defaultModuleFields: ModuleFields = {
	name: '',
	description: ''
};

// ─── Helpers ─────────────────────────────────────────────────────────

function decryptFields(masterKey: CryptoKey, record: ModuleRecord): Promise<ModuleFields> {
	return decryptText(masterKey, {
		ciphertext: record.encryptedData,
		iv: record.encryptedDataIV
	})
		.then((dec) => deepMerge(defaultModuleFields, JSON.parse(dec)))
		.catch((error) => {
			throw new AppError('ENCRYPTION_FAILED', 'Failed to decrypt module', error);
		});
}

// ─── Service ─────────────────────────────────────────────────────────

export class ModuleService {
	static async list(): Promise<Module[]> {
		const { masterKey, userId } = getActiveSession();
		const records = await localDB.getAll<ModuleRecord>('modules', userId);

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

	static async get(id: string): Promise<Module | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<ModuleRecord>('modules', id);
		if (!record || record.isDeleted) return null;

		const fields = await decryptFields(masterKey, record);
		return {
			id: record.id,
			...fields
		};
	}

	static async create(fields: Partial<ModuleFields> = {}): Promise<Module> {
		const resolved: ModuleFields = deepMerge(defaultModuleFields, fields as Record<string, unknown>);

		const { masterKey, userId } = getActiveSession();
		const id = crypto.randomUUID();
		const now = Date.now();

		try {
			const enc = await encryptText(masterKey, JSON.stringify(resolved));
			await localDB.putRecord<ModuleRecord>('modules', {
				id, userId, createdAt: now, updatedAt: now, isDeleted: false,
				encryptedData: enc.ciphertext, encryptedDataIV: enc.iv
			});
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to create module', error);
		}

		return { id, ...resolved };
	}

	static async update(id: string, changes: Partial<ModuleFields>): Promise<Module> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<ModuleRecord>('modules', id);
		if (!record || record.isDeleted) {
			throw new AppError('NOT_FOUND', `Module not found: ${id}`);
		}

		try {
			const current = await decryptFields(masterKey, record);
			const updated: ModuleFields = deepMerge(current, changes as Record<string, unknown>);
			const enc = await encryptText(masterKey, JSON.stringify(updated));

			record.encryptedData = enc.ciphertext;
			record.encryptedDataIV = enc.iv;
			record.updatedAt = Date.now();
			await localDB.putRecord('modules', record);

			return { id, ...updated };
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to update module', error);
		}
	}

	/** Update content fields only — safe entry point for store layer */
	static async updateContent(
		id: string,
		changes: Partial<ModuleContent>
	): Promise<Module> {
		return this.update(id, changes);
	}

	static async delete(id: string): Promise<void> {
		try {
			await localDB.transaction(['lorebooks', 'scripts', 'modules'], 'rw', async () => {
				await localDB.softDeleteByIndex('lorebooks', 'ownerId', id);
				await localDB.softDeleteByIndex('scripts', 'ownerId', id);
				await localDB.softDeleteRecord('modules', id);
			});
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to delete module', error);
		}
	}
}
