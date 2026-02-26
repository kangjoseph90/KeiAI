import { getActiveSession, encryptText, decryptText } from '../session.js';
import {
	localDB,
	type CharacterSummaryRecord,
	type CharacterDataRecord
} from '../db/index.js';

// ─── Domain Types ────────────────────────────────────────────────────

export interface CharacterSummaryFields {
	name: string;
	shortDescription: string;
	avatarAssetId?: string;
}

export interface CharacterDataFields {
	systemPrompt: string;
	greetingMessage?: string;
}

export interface Character extends CharacterSummaryFields {
	id: string;
	createdAt: number;
	updatedAt: number;
}

export interface CharacterDetail extends Character {
	data: CharacterDataFields;
}

// ─── Service ─────────────────────────────────────────────────────────

export class CharacterService {
	/** List all characters (summary only — characterData table untouched) */
	static async list(): Promise<Character[]> {
		const { masterKey, userId } = getActiveSession();
		const records = await localDB.getAll<CharacterSummaryRecord>('characterSummaries', userId);

		const results: Character[] = [];
		for (const record of records) {
			const fields: CharacterSummaryFields = JSON.parse(
				await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.encryptedDataIV })
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

	/** Get full character (summary + data) */
	static async getDetail(id: string): Promise<CharacterDetail | null> {
		const { masterKey } = getActiveSession();

		const rec = await localDB.getRecord<CharacterSummaryRecord>('characterSummaries', id);
		if (!rec || rec.isDeleted) return null;

		const dataRec = await localDB.getRecord<CharacterDataRecord>('characterData', id);
		if (!dataRec || dataRec.isDeleted) return null;

		const fields: CharacterSummaryFields = JSON.parse(
			await decryptText(masterKey, { ciphertext: rec.encryptedData, iv: rec.encryptedDataIV })
		);
		const data: CharacterDataFields = JSON.parse(
			await decryptText(masterKey, { ciphertext: dataRec.encryptedData, iv: dataRec.encryptedDataIV })
		);

		return {
			id: rec.id,
			...fields,
			data,
			createdAt: rec.createdAt,
			updatedAt: Math.max(rec.updatedAt, dataRec.updatedAt)
		};
	}

	/** Create a character (writes to both tables) */
	static async create(
		fields: CharacterSummaryFields,
		data: CharacterDataFields
	): Promise<CharacterDetail> {
		const { masterKey, userId } = getActiveSession();
		const id = crypto.randomUUID();
		const now = Date.now();

		const fieldsEnc = await encryptText(masterKey, JSON.stringify(fields));
		const dataEnc = await encryptText(masterKey, JSON.stringify(data));

		await localDB.putRecord<CharacterSummaryRecord>('characterSummaries', {
			id, userId, createdAt: now, updatedAt: now, isDeleted: false,
			encryptedData: fieldsEnc.ciphertext, encryptedDataIV: fieldsEnc.iv
		});
		await localDB.putRecord<CharacterDataRecord>('characterData', {
			id, userId, createdAt: now, updatedAt: now, isDeleted: false,
			encryptedData: dataEnc.ciphertext, encryptedDataIV: dataEnc.iv
		});

		return { id, ...fields, data, createdAt: now, updatedAt: now };
	}

	/** Update summary only (e.g. rename) — does NOT touch characterData */
	static async updateSummary(
		id: string,
		changes: Partial<CharacterSummaryFields>
	): Promise<Character | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<CharacterSummaryRecord>('characterSummaries', id);
		if (!record || record.isDeleted) return null;

		const current: CharacterSummaryFields = JSON.parse(
			await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.encryptedDataIV })
		);
		const updated = { ...current, ...changes };
		const enc = await encryptText(masterKey, JSON.stringify(updated));

		record.encryptedData = enc.ciphertext;
		record.encryptedDataIV = enc.iv;
		record.updatedAt = Date.now();
		await localDB.putRecord('characterSummaries', record);

		return { id, ...updated, createdAt: record.createdAt, updatedAt: record.updatedAt };
	}

	/** Update data only (e.g. edit system prompt) — does NOT touch summary */
	static async updateData(id: string, changes: Partial<CharacterDataFields>): Promise<void> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<CharacterDataRecord>('characterData', id);
		if (!record || record.isDeleted) return;

		const current: CharacterDataFields = JSON.parse(
			await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.encryptedDataIV })
		);
		const updated = { ...current, ...changes };
		const enc = await encryptText(masterKey, JSON.stringify(updated));

		record.encryptedData = enc.ciphertext;
		record.encryptedDataIV = enc.iv;
		record.updatedAt = Date.now();
		await localDB.putRecord('characterData', record);
	}

	/** Soft-delete (both tables) */
	static async delete(id: string): Promise<void> {
		await localDB.softDeleteRecord('characterSummaries', id);
		await localDB.softDeleteRecord('characterData', id);
	}
}
