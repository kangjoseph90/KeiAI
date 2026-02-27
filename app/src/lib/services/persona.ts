import { getActiveSession, encryptText, decryptText } from '../session.js';
import {
	localDB,
	type PersonaSummaryRecord,
	type PersonaDataRecord,
	type ResourceRef,
	type FolderDef,
	type AssetEntry
} from '../db/index.js';

// ─── Domain Types ────────────────────────────────────────────────────

export interface PersonaSummaryFields {
	name: string;
	avatarAssetId?: string;
}

export interface PersonaDataFields {
	description: string;
	moduleRefs?: ResourceRef[];
	lorebookRefs?: ResourceRef[];
	scriptRefs?: ResourceRef[];
	refFolders?: {
		modules?: FolderDef[];
		lorebooks?: FolderDef[];
		scripts?: FolderDef[];
	};
	assets?: AssetEntry[];
}

export interface Persona extends PersonaSummaryFields {
	id: string;
	createdAt: number;
	updatedAt: number;
}

export interface PersonaDetail extends Persona {
	data: PersonaDataFields;
}

// ─── Service ─────────────────────────────────────────────────────────

export class PersonaService {
	/** List all persona summaries */
	static async list(): Promise<Persona[]> {
		const { masterKey, userId } = getActiveSession();
		const records = await localDB.getAll<PersonaSummaryRecord>('personaSummaries', userId);

		const results: Persona[] = [];
		for (const record of records) {
			const fields: PersonaSummaryFields = JSON.parse(
				await decryptText(masterKey, {
					ciphertext: record.encryptedData,
					iv: record.encryptedDataIV
				})
			);
			results.push({
				id: record.id,
				...fields,
				createdAt: record.createdAt,
				updatedAt: record.updatedAt
			});
		}
		return results;
	}

	/** Get full persona data */
	static async getDetail(id: string): Promise<PersonaDetail | null> {
		const { masterKey } = getActiveSession();

		const rec = await localDB.getRecord<PersonaSummaryRecord>('personaSummaries', id);
		if (!rec || rec.isDeleted) return null;

		const dataRec = await localDB.getRecord<PersonaDataRecord>('personaData', id);
		if (!dataRec || dataRec.isDeleted) return null;

		const fields: PersonaSummaryFields = JSON.parse(
			await decryptText(masterKey, { ciphertext: rec.encryptedData, iv: rec.encryptedDataIV })
		);
		const data: PersonaDataFields = JSON.parse(
			await decryptText(masterKey, {
				ciphertext: dataRec.encryptedData,
				iv: dataRec.encryptedDataIV
			})
		);

		return {
			id: rec.id,
			...fields,
			data,
			createdAt: rec.createdAt,
			updatedAt: Math.max(rec.updatedAt, dataRec.updatedAt)
		};
	}

	/** Create a persona - caller must add to parent's personaRefs */
	static async create(
		fields: PersonaSummaryFields,
		data: PersonaDataFields
	): Promise<PersonaDetail> {
		const { masterKey, userId } = getActiveSession();
		const id = crypto.randomUUID();
		const now = Date.now();

		const fieldsEnc = await encryptText(masterKey, JSON.stringify(fields));
		const dataEnc = await encryptText(masterKey, JSON.stringify(data));

		await localDB.transaction(['personaSummaries', 'personaData'], 'rw', async () => {
			await localDB.putRecord<PersonaSummaryRecord>('personaSummaries', {
				id,
				userId,
				createdAt: now,
				updatedAt: now,
				isDeleted: false,
				encryptedData: fieldsEnc.ciphertext,
				encryptedDataIV: fieldsEnc.iv
			});
			await localDB.putRecord<PersonaDataRecord>('personaData', {
				id,
				userId,
				createdAt: now,
				updatedAt: now,
				isDeleted: false,
				encryptedData: dataEnc.ciphertext,
				encryptedDataIV: dataEnc.iv
			});
		});

		return { id, ...fields, data, createdAt: now, updatedAt: now };
	}

	/** Update summary only */
	static async updateSummary(id: string, changes: Partial<PersonaSummaryFields>): Promise<void> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<PersonaSummaryRecord>('personaSummaries', id);
		if (!record || record.isDeleted) return;

		const current: PersonaSummaryFields = JSON.parse(
			await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.encryptedDataIV })
		);
		const updated = { ...current, ...changes };
		const enc = await encryptText(masterKey, JSON.stringify(updated));

		record.encryptedData = enc.ciphertext;
		record.encryptedDataIV = enc.iv;
		record.updatedAt = Date.now();
		await localDB.putRecord('personaSummaries', record);
	}

	/** Update data only */
	static async updateData(id: string, changes: Partial<PersonaDataFields>): Promise<void> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<PersonaDataRecord>('personaData', id);
		if (!record || record.isDeleted) return;

		const current: PersonaDataFields = JSON.parse(
			await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.encryptedDataIV })
		);
		const updated = { ...current, ...changes };
		const enc = await encryptText(masterKey, JSON.stringify(updated));

		record.encryptedData = enc.ciphertext;
		record.encryptedDataIV = enc.iv;
		record.updatedAt = Date.now();
		await localDB.putRecord('personaData', record);
	}

	/** Cascade delete: owned modules, lorebooks, scripts, then persona */
	static async delete(id: string): Promise<void> {
		await localDB.transaction(
			['lorebooks', 'scripts', 'personaSummaries', 'personaData'],
			'rw',
			async () => {
				await localDB.softDeleteByIndex('lorebooks', 'ownerId', id);
				await localDB.softDeleteByIndex('scripts', 'ownerId', id);
				await localDB.softDeleteRecord('personaSummaries', id);
				await localDB.softDeleteRecord('personaData', id);
			}
		);
	}
}
