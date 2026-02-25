import { getActiveSession, encryptText, decryptText } from '../session.js';
import { localDB, type CharacterRecord } from '../db/index.js';

export interface CharacterSummary {
	name: string;
	shortDescription: string;
	avatarAssetId?: string;
}

export interface CharacterData {
	systemPrompt: string;
	greetingMessage?: string;
}

export interface Character {
	id: string;
	summary: CharacterSummary;
	data?: CharacterData;
	createdAt: number;
	updatedAt: number;
}

export class CharacterService {
	static async create(summary: CharacterSummary, data: CharacterData): Promise<Character> {
		const { masterKey, userId } = getActiveSession();
		const id = crypto.randomUUID();
		const now = Date.now();

		const sumEnc = await encryptText(masterKey, JSON.stringify(summary));
		const dataEnc = await encryptText(masterKey, JSON.stringify(data));

		const record: CharacterRecord = {
			id,
			userId,
			createdAt: now,
			updatedAt: now,
			isDeleted: false,
			encryptedSummary: sumEnc.ciphertext,
			summaryIv: sumEnc.iv,
			encryptedData: dataEnc.ciphertext,
			dataIv: dataEnc.iv
		};

		await localDB.putRecord('characters', record);

		return { id, summary, data, createdAt: now, updatedAt: now };
	}

	static async getAll(): Promise<Character[]> {
		const { masterKey, userId } = getActiveSession();
		const records = await localDB.getAll<CharacterRecord>('characters', userId);
		
		const results: Character[] = [];
		for (const record of records) {
			const sumDec = await decryptText(masterKey, {
				ciphertext: record.encryptedSummary,
				iv: record.summaryIv
			});
			results.push({
				id: record.id,
				summary: JSON.parse(sumDec),
				createdAt: record.createdAt,
				updatedAt: record.updatedAt
			});
		}
		return results;
	}

	static async getById(id: string): Promise<Character | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<CharacterRecord>('characters', id);
		if (!record || record.isDeleted) return null;

		const sumDec = await decryptText(masterKey, {
			ciphertext: record.encryptedSummary,
			iv: record.summaryIv
		});
		const dataDec = await decryptText(masterKey, {
			ciphertext: record.encryptedData,
			iv: record.dataIv
		});

		return {
			id: record.id,
			summary: JSON.parse(sumDec),
			data: JSON.parse(dataDec),
			createdAt: record.createdAt,
			updatedAt: record.updatedAt
		};
	}

	static async update(id: string, summary: Partial<CharacterSummary>, data?: Partial<CharacterData>): Promise<Character | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<CharacterRecord>('characters', id);
		if (!record || record.isDeleted) return null;

		const sumDec = await decryptText(masterKey, { ciphertext: record.encryptedSummary, iv: record.summaryIv });
		const currentSummary: CharacterSummary = JSON.parse(sumDec);
		const newSummary = { ...currentSummary, ...summary };
		
		const sumEnc = await encryptText(masterKey, JSON.stringify(newSummary));
		record.encryptedSummary = sumEnc.ciphertext;
		record.summaryIv = sumEnc.iv;

		let newData: CharacterData | undefined;
		if (data) {
			const dataDec = await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.dataIv });
			const currentData: CharacterData = JSON.parse(dataDec);
			newData = { ...currentData, ...data };
			
			const dataEnc = await encryptText(masterKey, JSON.stringify(newData));
			record.encryptedData = dataEnc.ciphertext;
			record.dataIv = dataEnc.iv;
		} else {
			const dataDec = await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.dataIv });
			newData = JSON.parse(dataDec);
		}

		record.updatedAt = Date.now();
		await localDB.putRecord('characters', record);

		return {
			id: record.id,
			summary: newSummary,
			data: newData,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt
		};
	}

	static async delete(id: string): Promise<void> {
		await localDB.softDeleteRecord('characters', id);
	}
}
