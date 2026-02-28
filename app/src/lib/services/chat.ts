/**
 * Chat Service
 *
 * No FK — parent character holds chatRefs[] in its encrypted blob.
 * Chats are fetched by ID from the character's ref list.
 */

import { getActiveSession, encryptText, decryptText } from '../session.js';
import {
	localDB,
	type ChatSummaryRecord,
	type ChatDataRecord,
	type FolderDef,
	type OrderedRef
} from '../db/index.js';

// ─── Domain Types ────────────────────────────────────────────────────

export interface ChatSummaryFields {
	title: string;
	lastMessagePreview: string;
}

export interface ChatDataRefs {
	lorebookRefs?: OrderedRef[];
	folders?: {
		lorebooks?: FolderDef[];
	};
}

export interface ChatDataContent {
	systemPromptOverride?: string;
	variables?: Record<string, unknown>;
}

export interface ChatDataFields extends ChatDataContent, ChatDataRefs {}

export interface Chat extends ChatSummaryFields {
	id: string;
	characterId: string;
	createdAt: number;
	updatedAt: number;
}

export interface ChatDetail extends Chat {
	data: ChatDataFields;
}

// ─── Service ─────────────────────────────────────────────────────────

export class ChatService {
	static async listByCharacter(characterId: string): Promise<Chat[]> {
		const { masterKey } = getActiveSession();
		const records = await localDB.getByIndex<ChatSummaryRecord>('chatSummaries', 'characterId', characterId, 10000);
		
		return Promise.all(records.map(async (record) => {
			const fields: ChatSummaryFields = JSON.parse(
				await decryptText(masterKey, {
					ciphertext: record.encryptedData,
					iv: record.encryptedDataIV
				})
			);
			return {
				id: record.id,
				characterId: record.characterId,
				...fields,
				createdAt: record.createdAt,
				updatedAt: record.updatedAt
			};
		}));
	}

	/** Get full chat data */
	static async getDetail(id: string): Promise<ChatDetail | null> {
		const { masterKey } = getActiveSession();

		const rec = await localDB.getRecord<ChatSummaryRecord>('chatSummaries', id);
		if (!rec || rec.isDeleted) return null;

		const dataRec = await localDB.getRecord<ChatDataRecord>('chatData', id);
		if (!dataRec || dataRec.isDeleted) return null;

		const fields: ChatSummaryFields = JSON.parse(
			await decryptText(masterKey, { ciphertext: rec.encryptedData, iv: rec.encryptedDataIV })
		);
		const data: ChatDataFields = JSON.parse(
			await decryptText(masterKey, {
				ciphertext: dataRec.encryptedData,
				iv: dataRec.encryptedDataIV
			})
		);

		return {
			id: rec.id,
			characterId: rec.characterId,
			...fields,
			data,
			createdAt: rec.createdAt,
			updatedAt: Math.max(rec.updatedAt, dataRec.updatedAt)
		};
	}

	/** Create a chat - caller must add to parent's chatRefs */
	static async create(
		characterId: string,
		summary: ChatSummaryFields,
		data: ChatDataFields = {}
	): Promise<ChatDetail> {
		const { masterKey, userId } = getActiveSession();
		const id = crypto.randomUUID();
		const now = Date.now();

		const summaryEnc = await encryptText(masterKey, JSON.stringify(summary));
		const dataEnc = await encryptText(masterKey, JSON.stringify(data));

		await localDB.transaction(['chatSummaries', 'chatData'], 'rw', async () => {
			await localDB.putRecord<ChatSummaryRecord>('chatSummaries', {
				id,
				userId,
				characterId,
				createdAt: now,
				updatedAt: now,
				isDeleted: false,
				encryptedData: summaryEnc.ciphertext,
				encryptedDataIV: summaryEnc.iv
			});
			await localDB.putRecord<ChatDataRecord>('chatData', {
				id,
				userId,
				characterId,
				createdAt: now,
				updatedAt: now,
				isDeleted: false,
				encryptedData: dataEnc.ciphertext,
				encryptedDataIV: dataEnc.iv
			});
		});

		return {
			id,
			characterId,
			...summary,
			data,
			createdAt: now,
			updatedAt: now
		};
	}

	/** Update summary only */
	static async updateSummary(
		id: string, 
		changes: Partial<ChatSummaryFields>
	): Promise<Chat | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<ChatSummaryRecord>('chatSummaries', id);
		if (!record || record.isDeleted) return null;

		const current: ChatSummaryFields = JSON.parse(
			await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.encryptedDataIV })
		);
		const updated = { ...current, ...changes };
		const enc = await encryptText(masterKey, JSON.stringify(updated));

		record.encryptedData = enc.ciphertext;
		record.encryptedDataIV = enc.iv;
		record.updatedAt = Date.now();
		await localDB.putRecord('chatSummaries', record);

		return {
			id,
			characterId: record.characterId,
			...updated,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt
		};
	}

	/** Update data only */
	static async updateData(
		id: string, 
		changes: Partial<ChatDataFields>
	): Promise<{ updatedAt: number } | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<ChatDataRecord>('chatData', id);
		if (!record || record.isDeleted) return null;

		const current: ChatDataFields = JSON.parse(
			await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.encryptedDataIV })
		);
		const updated = { ...current, ...changes };
		const enc = await encryptText(masterKey, JSON.stringify(updated));

		record.encryptedData = enc.ciphertext;
		record.encryptedDataIV = enc.iv;
		record.updatedAt = Date.now();
		await localDB.putRecord('chatData', record);

		return { updatedAt: record.updatedAt };
	}

	/** Update summary and/or data transactionally */
	static async update(
		id: string,
		summaryChanges?: Partial<ChatSummaryFields>,
		dataChanges?: Partial<ChatDataFields>
	): Promise<{ summary?: ChatSummaryFields & { characterId: string }; data?: ChatDataFields; updatedAt: number } | null> {
		const { masterKey } = getActiveSession();
		let updatedSummary: (ChatSummaryFields & { characterId: string }) | undefined;
		let updatedData: ChatDataFields | undefined;
		let finalUpdatedAt = Date.now();

		await localDB.transaction(['chatSummaries', 'chatData'], 'rw', async () => {
			if (summaryChanges) {
				const summaryRecord = await localDB.getRecord<ChatSummaryRecord>('chatSummaries', id);
				if (!summaryRecord || summaryRecord.isDeleted) return;
				
				const currentSummary: ChatSummaryFields = JSON.parse(
					await decryptText(masterKey, { ciphertext: summaryRecord.encryptedData, iv: summaryRecord.encryptedDataIV })
				);
				const mergedSummary = { ...currentSummary, ...summaryChanges };
				const enc = await encryptText(masterKey, JSON.stringify(mergedSummary));
				summaryRecord.encryptedData = enc.ciphertext;
				summaryRecord.encryptedDataIV = enc.iv;
				summaryRecord.updatedAt = finalUpdatedAt;
				await localDB.putRecord('chatSummaries', summaryRecord);
				updatedSummary = { ...mergedSummary, characterId: summaryRecord.characterId };
			}

			if (dataChanges) {
				const dataRecord = await localDB.getRecord<ChatDataRecord>('chatData', id);
				if (!dataRecord || dataRecord.isDeleted) return;
				
				const currentData: ChatDataFields = JSON.parse(
					await decryptText(masterKey, { ciphertext: dataRecord.encryptedData, iv: dataRecord.encryptedDataIV })
				);
				updatedData = { ...currentData, ...dataChanges };
				const enc = await encryptText(masterKey, JSON.stringify(updatedData));
				dataRecord.encryptedData = enc.ciphertext;
				dataRecord.encryptedDataIV = enc.iv;
				dataRecord.updatedAt = finalUpdatedAt;
				await localDB.putRecord('chatData', dataRecord);
			}
		});

		if (!updatedSummary && !updatedData) return null;

		return {
			summary: updatedSummary,
			data: updatedData,
			updatedAt: finalUpdatedAt
		};
	}

	/** Cascade soft-delete: owned lorebooks, scripts, messages, then chat itself */
	static async delete(id: string): Promise<void> {
		await localDB.transaction(
			['lorebooks', 'scripts', 'messages', 'chatSummaries', 'chatData'],
			'rw',
			async () => {
				await localDB.softDeleteByIndex('lorebooks', 'ownerId', id);
				await localDB.softDeleteByIndex('scripts', 'ownerId', id);
				await localDB.softDeleteByIndex('messages', 'chatId', id);
				await localDB.softDeleteRecord('chatSummaries', id);
				await localDB.softDeleteRecord('chatData', id);
			}
		);
	}
}
