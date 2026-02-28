import { getActiveSession, encryptText, decryptText } from '../session.js';
import { localDB, type PersonaRecord, type AssetEntry } from '../db/index.js';

// ─── Domain Types ────────────────────────────────────────────────────

export interface PersonaFields {
	name: string;
	avatarAssetId?: string;
	description: string;
	assets?: AssetEntry[];
}

export interface Persona extends PersonaFields {
	id: string;
	createdAt: number;
	updatedAt: number;
}

// ─── Service ─────────────────────────────────────────────────────────

export class PersonaService {
	/** List all personas */
	static async list(): Promise<Persona[]> {
		const { masterKey, userId } = getActiveSession();
		const records = await localDB.getAll<PersonaRecord>('personas', userId);

		return Promise.all(
			records.map(async (record) => {
				const fields: PersonaFields = JSON.parse(
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

	static async get(id: string): Promise<Persona | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<PersonaRecord>('personas', id);
		if (!record || record.isDeleted) return null;

		const fields: PersonaFields = JSON.parse(
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

	/** Create a persona */
	static async create(fields: PersonaFields): Promise<Persona> {
		const { masterKey, userId } = getActiveSession();
		const id = crypto.randomUUID();
		const now = Date.now();
		const enc = await encryptText(masterKey, JSON.stringify(fields));

		await localDB.putRecord<PersonaRecord>('personas', {
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

	/** Update a persona */
	static async update(id: string, changes: Partial<PersonaFields>): Promise<Persona | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<PersonaRecord>('personas', id);
		if (!record || record.isDeleted) return null;

		const current: PersonaFields = JSON.parse(
			await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.encryptedDataIV })
		);
		const updated = { ...current, ...changes };
		const enc = await encryptText(masterKey, JSON.stringify(updated));

		record.encryptedData = enc.ciphertext;
		record.encryptedDataIV = enc.iv;
		record.updatedAt = Date.now();
		await localDB.putRecord('personas', record);

		return { id, ...updated, createdAt: record.createdAt, updatedAt: record.updatedAt };
	}

	/** Delete a persona */
	static async delete(id: string): Promise<void> {
		await localDB.softDeleteRecord('personas', id);
	}
}
