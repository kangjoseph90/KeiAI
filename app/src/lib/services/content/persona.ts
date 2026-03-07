import { encrypt, decrypt } from '../../crypto/index.js';
import { getActiveSession } from '../session.js';
import { localDB, type PersonaRecord } from '../../adapters/db/index.js';
import { DataSyncService } from '../sync/index.js';
import { deepMerge } from '../../shared/defaults.js';
import { AppError } from '../../shared/errors.js';
import type { AssetRef } from '../../shared/types.js';
import { generateId } from '../../shared/id.js';

// ─── Domain Types ────────────────────────────────────────────────────

export interface PersonaContent {
	name: string;
	description: string;
}

export interface PersonaRefs {
	avatarAssetId?: string;
	assets?: AssetRef[];
}

export interface PersonaFields extends PersonaContent, PersonaRefs {}

export interface Persona extends PersonaFields {
	id: string;
}

// ─── Defaults ────────────────────────────────────────────────────────

const defaultPersonaFields: PersonaFields = {
	name: '',
	description: ''
};

// ─── Helpers ─────────────────────────────────────────────────────────

function decryptFields(masterKey: CryptoKey, record: PersonaRecord): Promise<PersonaFields> {
	return decrypt(masterKey, {
		ciphertext: record.encryptedData,
		iv: record.encryptedDataIV
	})
		.then((dec) => deepMerge(defaultPersonaFields, JSON.parse(dec)))
		.catch((error) => {
			throw new AppError('ENCRYPTION_FAILED', 'Failed to decrypt persona', error);
		});
}

// ─── Service ─────────────────────────────────────────────────────────

export class PersonaService {
	/** List all personas */
	static async list(): Promise<Persona[]> {
		const { masterKey, userId } = getActiveSession();
		const records = await localDB.getAll<PersonaRecord>('personas', userId);

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

	static async get(id: string): Promise<Persona | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<PersonaRecord>('personas', id);
		if (!record || record.isDeleted) return null;

		const fields = await decryptFields(masterKey, record);
		return {
			id: record.id,
			...fields
		};
	}

	/** Create a persona */
	static async create(fields: Partial<PersonaFields> = {}): Promise<Persona> {
		const resolved: PersonaFields = deepMerge(defaultPersonaFields, fields as Record<string, unknown>);

		const { masterKey, userId } = getActiveSession();
		const id = generateId();
		const now = Date.now();

		try {
			const enc = await encrypt(masterKey, JSON.stringify(resolved));
			const newRecord: PersonaRecord = {
				id, userId, createdAt: now, updatedAt: now, isDeleted: false,
				encryptedData: enc.ciphertext, encryptedDataIV: enc.iv
			};
			await localDB.putRecord<PersonaRecord>('personas', newRecord);
			void DataSyncService.pushRecord('personas', newRecord, true);
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to create persona', error);
		}

		return { id, ...resolved };
	}

	/** Update a persona */
	static async update(id: string, changes: Partial<PersonaContent>): Promise<Persona> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<PersonaRecord>('personas', id);
		if (!record || record.isDeleted) {
			throw new AppError('NOT_FOUND', `Persona not found: ${id}`);
		}

		try {
			const current = await decryptFields(masterKey, record);
			const updated: PersonaFields = deepMerge(current, changes as Record<string, unknown>);
			const enc = await encrypt(masterKey, JSON.stringify(updated));

			record.encryptedData = enc.ciphertext;
			record.encryptedDataIV = enc.iv;
			record.updatedAt = Date.now();
			await localDB.putRecord('personas', record);
			void DataSyncService.pushRecord('personas', record);

			return { id, ...updated };
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to update persona', error);
		}
	}

	/** Delete a persona */
	static async delete(id: string): Promise<void> {
		try {
			await localDB.softDeleteRecord('personas', id);
			void DataSyncService.pushById('personas', id);
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to delete persona', error);
		}
	}
}
