import { getActiveSession, encryptText, decryptText } from '../session.js';
import {
	localDB,
	type CharacterSummaryRecord,
	type CharacterDataRecord,
	type OrderedRef,
	type FolderDef,
	type AssetEntry
} from '../db/index.js';

// ─── Domain Types ────────────────────────────────────────────────────

export interface CharacterSummaryFields {
	name: string;
	shortDescription: string;
	avatarAssetId?: string;
}

export interface CharacterDataRefs {
	lastActiveChatId?: string;
	chatRefs?: OrderedRef[];
	moduleRefs?: OrderedRef[];
	lorebookRefs?: OrderedRef[];
	scriptRefs?: OrderedRef[];
	personaId?: string;
	folders?: {
		chats?: FolderDef[];
		modules?: FolderDef[];
		lorebooks?: FolderDef[];
		scripts?: FolderDef[];
	};
	assets?: AssetEntry[];
}

export interface CharacterDataContent {
	systemPrompt: string;
	greetingMessage?: string;
}

export interface CharacterDataFields extends CharacterDataContent, CharacterDataRefs {}

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
	/** List all character summaries */
	static async list(): Promise<Character[]> {
		const { masterKey, userId } = getActiveSession();
		const records = await localDB.getAll<CharacterSummaryRecord>('characterSummaries', userId);
		return Promise.all(
			records.map(async (record) => {
				const fields: CharacterSummaryFields = JSON.parse(
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

	/** Get full character data */
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

	/** Create a character - caller must add to parent's characterRefs */
	static async create(
		summary: CharacterSummaryFields,
		data: CharacterDataFields
	): Promise<CharacterDetail> {
		const { masterKey, userId } = getActiveSession();
		const id = crypto.randomUUID();
		const now = Date.now();

		const summaryEnc = await encryptText(masterKey, JSON.stringify(summary));
		const dataEnc = await encryptText(masterKey, JSON.stringify(data));

		await localDB.transaction(['characterSummaries', 'characterData'], 'rw', async () => {
			await localDB.putRecord<CharacterSummaryRecord>('characterSummaries', {
				id,
				userId,
				createdAt: now,
				updatedAt: now,
				isDeleted: false,
				encryptedData: summaryEnc.ciphertext,
				encryptedDataIV: summaryEnc.iv
			});
			await localDB.putRecord<CharacterDataRecord>('characterData', {
				id,
				userId,
				createdAt: now,
				updatedAt: now,
				isDeleted: false,
				encryptedData: dataEnc.ciphertext,
				encryptedDataIV: dataEnc.iv
			});
		});

		return { id, ...summary, data, createdAt: now, updatedAt: now };
	}

	/** Update summary only */
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

	/** Update data only */
	static async updateData(
		id: string,
		changes: Partial<CharacterDataFields>
	): Promise<{ updatedAt: number } | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<CharacterDataRecord>('characterData', id);
		if (!record || record.isDeleted) return null;

		const current: CharacterDataFields = JSON.parse(
			await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.encryptedDataIV })
		);
		const updated = { ...current, ...changes };
		const enc = await encryptText(masterKey, JSON.stringify(updated));

		record.encryptedData = enc.ciphertext;
		record.encryptedDataIV = enc.iv;
		record.updatedAt = Date.now();
		await localDB.putRecord('characterData', record);

		return { updatedAt: record.updatedAt };
	}

	/** Update summary and/or data transactionally */
	static async update(
		id: string,
		summaryChanges?: Partial<CharacterSummaryFields>,
		dataChanges?: Partial<CharacterDataFields>
	): Promise<{
		summary?: CharacterSummaryFields;
		data?: CharacterDataFields;
		updatedAt: number;
	} | null> {
		const { masterKey } = getActiveSession();
		let updatedSummary: CharacterSummaryFields | undefined;
		let updatedData: CharacterDataFields | undefined;
		let finalUpdatedAt = Date.now();

		await localDB.transaction(['characterSummaries', 'characterData'], 'rw', async () => {
			if (summaryChanges) {
				const summaryRecord = await localDB.getRecord<CharacterSummaryRecord>(
					'characterSummaries',
					id
				);
				if (!summaryRecord || summaryRecord.isDeleted) return;

				const currentSummary: CharacterSummaryFields = JSON.parse(
					await decryptText(masterKey, {
						ciphertext: summaryRecord.encryptedData,
						iv: summaryRecord.encryptedDataIV
					})
				);
				updatedSummary = { ...currentSummary, ...summaryChanges };
				const enc = await encryptText(masterKey, JSON.stringify(updatedSummary));
				summaryRecord.encryptedData = enc.ciphertext;
				summaryRecord.encryptedDataIV = enc.iv;
				summaryRecord.updatedAt = finalUpdatedAt;
				await localDB.putRecord('characterSummaries', summaryRecord);
			}

			if (dataChanges) {
				const dataRecord = await localDB.getRecord<CharacterDataRecord>('characterData', id);
				if (!dataRecord || dataRecord.isDeleted) return;

				const currentData: CharacterDataFields = JSON.parse(
					await decryptText(masterKey, {
						ciphertext: dataRecord.encryptedData,
						iv: dataRecord.encryptedDataIV
					})
				);
				updatedData = { ...currentData, ...dataChanges };
				const enc = await encryptText(masterKey, JSON.stringify(updatedData));
				dataRecord.encryptedData = enc.ciphertext;
				dataRecord.encryptedDataIV = enc.iv;
				dataRecord.updatedAt = finalUpdatedAt;
				await localDB.putRecord('characterData', dataRecord);
			}
		});

		if (!updatedSummary && !updatedData) return null;
		// If only one was requested and the record was deleted, we still return what we have (or null).

		return {
			summary: updatedSummary,
			data: updatedData,
			updatedAt: finalUpdatedAt
		};
	}

	static async delete(id: string): Promise<void> {
		await localDB.transaction(
			[
				'chatSummaries',
				'chatData',
				'lorebooks',
				'scripts',
				'messages',
				'characterSummaries',
				'characterData'
			],
			'rw',
			async () => {
				const chatIds = (await localDB.getByIndex('chatSummaries', 'characterId', id)).map(
					(c) => c.id
				);
				for (const chatId of chatIds) {
					await localDB.softDeleteByIndex('messages', 'chatId', chatId);
					await localDB.softDeleteByIndex('lorebooks', 'ownerId', chatId);
					await localDB.softDeleteByIndex('scripts', 'ownerId', chatId);
				}
				await localDB.softDeleteByIndex('chatSummaries', 'characterId', id);
				await localDB.softDeleteByIndex('chatData', 'characterId', id);
				await localDB.softDeleteByIndex('lorebooks', 'ownerId', id);
				await localDB.softDeleteByIndex('scripts', 'ownerId', id);
				await localDB.softDeleteRecord('characterSummaries', id);
				await localDB.softDeleteRecord('characterData', id);
			}
		);
	}
}
