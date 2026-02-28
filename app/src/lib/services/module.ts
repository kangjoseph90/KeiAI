import { getActiveSession, encryptText, decryptText } from '../session.js';
import {
	localDB,
	type ModuleRecord,
	type ResourceRef,
	type FolderDef,
	type OrderedRef
} from '../db/index.js';

// ─── Domain Types ────────────────────────────────────────────────────

export interface ModuleRefs {
	lorebookRefs?: OrderedRef[];
	scriptRefs?: OrderedRef[];
	folders?: {
		lorebooks?: FolderDef[];
		scripts?: FolderDef[];
	};
}

export interface ModuleContent {
	name: string;
	description: string;
}

export interface ModuleFields extends ModuleContent, ModuleRefs {}

export interface Module extends ModuleFields {
	id: string;
	createdAt: number;
	updatedAt: number;
}

// ─── Service ─────────────────────────────────────────────────────────

export class ModuleService {
	static async list(): Promise<Module[]> {
		const { masterKey, userId } = getActiveSession();
		const records = await localDB.getAll<ModuleRecord>('modules', userId);

		return Promise.all(
			records.map(async (record) => {
				const fields: ModuleFields = JSON.parse(
					await decryptText(masterKey, {
						ciphertext: record.encryptedData,
						iv: record.encryptedDataIV
					})
				);
				return {
					id: record.id,
					...fields,
					createdAt: record.createdAt,
					updatedAt: record.updatedAt
				};
			})
		);
	}

	static async get(id: string): Promise<Module | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<ModuleRecord>('modules', id);
		if (!record || record.isDeleted) return null;

		const fields: ModuleFields = JSON.parse(
			await decryptText(masterKey, {
				ciphertext: record.encryptedData,
				iv: record.encryptedDataIV
			})
		);
		return {
			id: record.id,
			...fields,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt
		};
	}

	static async create(fields: ModuleFields): Promise<Module> {
		const { masterKey, userId } = getActiveSession();
		const id = crypto.randomUUID();
		const now = Date.now();
		const enc = await encryptText(masterKey, JSON.stringify(fields));

		await localDB.putRecord<ModuleRecord>('modules', {
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

	static async update(id: string, changes: Partial<ModuleFields>): Promise<Module | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<ModuleRecord>('modules', id);
		if (!record || record.isDeleted) return null;

		const current: ModuleFields = JSON.parse(
			await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.encryptedDataIV })
		);
		const updated = { ...current, ...changes };
		const enc = await encryptText(masterKey, JSON.stringify(updated));

		record.encryptedData = enc.ciphertext;
		record.encryptedDataIV = enc.iv;
		record.updatedAt = Date.now();
		await localDB.putRecord('modules', record);

		return { id, ...updated, createdAt: record.createdAt, updatedAt: record.updatedAt };
	}

	static async delete(id: string): Promise<void> {
		await localDB.transaction(['lorebooks', 'scripts', 'modules'], 'rw', async () => {
			await localDB.softDeleteByIndex('lorebooks', 'ownerId', id);
			await localDB.softDeleteByIndex('scripts', 'ownerId', id);
			await localDB.softDeleteRecord('modules', id);
		});
	}
}
