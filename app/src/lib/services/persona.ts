import { getActiveSession, encryptText, decryptText } from '../session.js';
import { localDB, type PersonaRecord, type AssetEntry } from '../db/index.js';
import { deepMerge } from '../utils/defaults.js';
import { AppError } from '../errors.js';

// ─── Domain Types ────────────────────────────────────────────────────

export interface PersonaFields {
	name: string;
	avatarAssetId?: string;
	description: string;
	assets?: AssetEntry[];
}

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
	return decryptText(masterKey, {
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
		const id = crypto.randomUUID();
		const now = Date.now();

		try {
			const enc = await encryptText(masterKey, JSON.stringify(resolved));
			await localDB.putRecord<PersonaRecord>('personas', {
				id, userId, createdAt: now, updatedAt: now, isDeleted: false,
				encryptedData: enc.ciphertext, encryptedDataIV: enc.iv
			});
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to create persona', error);
		}

		return { id, ...resolved };
	}

	/** Update a persona */
	static async update(id: string, changes: Partial<PersonaFields>): Promise<Persona> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<PersonaRecord>('personas', id);
		if (!record || record.isDeleted) {
			throw new AppError('NOT_FOUND', `Persona not found: ${id}`);
		}

		try {
			const current = await decryptFields(masterKey, record);
			const updated: PersonaFields = deepMerge(current, changes as Record<string, unknown>);
			const enc = await encryptText(masterKey, JSON.stringify(updated));

			record.encryptedData = enc.ciphertext;
			record.encryptedDataIV = enc.iv;
			record.updatedAt = Date.now();
			await localDB.putRecord('personas', record);

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
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to delete persona', error);
		}
	}
}
