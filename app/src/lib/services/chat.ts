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
import { deepMerge } from '../utils/defaults.js';
import { assertCharacterExists, assertChatOwnedByCharacter } from './guards.js';

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

// ─── Defaults ────────────────────────────────────────────────────────

const defaultSummaryFields: ChatSummaryFields = {
	title: '',
	lastMessagePreview: ''
};

const defaultDataFields: ChatDataFields = {};

// ─── Helpers ─────────────────────────────────────────────────────────

function decryptSummaryFields(
	masterKey: CryptoKey,
	record: ChatSummaryRecord
): Promise<ChatSummaryFields> {
	return decryptText(masterKey, {
		ciphertext: record.encryptedData,
		iv: record.encryptedDataIV
	}).then((dec) => deepMerge(defaultSummaryFields, JSON.parse(dec)));
}

function decryptDataFields(masterKey: CryptoKey, record: ChatDataRecord): Promise<ChatDataFields> {
	return decryptText(masterKey, {
		ciphertext: record.encryptedData,
		iv: record.encryptedDataIV
	}).then((dec) => deepMerge(defaultDataFields, JSON.parse(dec)));
}

// ─── Service ─────────────────────────────────────────────────────────

export class ChatService {
	static async listByCharacter(characterId: string): Promise<Chat[]> {
		const { masterKey } = getActiveSession();
		const records = await localDB.getByIndex<ChatSummaryRecord>(
			'chatSummaries',
			'characterId',
			characterId,
			Number.MAX_SAFE_INTEGER
		);

		return Promise.all(
			records.map(async (record) => {
				const fields = await decryptSummaryFields(masterKey, record);
				return {
					id: record.id,
					characterId: record.characterId,
					...fields,
					createdAt: record.createdAt,
					updatedAt: record.updatedAt
				};
			})
		);
	}

	/** Get full chat data */
	static async getDetail(id: string): Promise<ChatDetail | null> {
		const { masterKey } = getActiveSession();

		const rec = await localDB.getRecord<ChatSummaryRecord>('chatSummaries', id);
		if (!rec || rec.isDeleted) return null;

		const dataRec = await localDB.getRecord<ChatDataRecord>('chatData', id);
		if (!dataRec || dataRec.isDeleted) return null;

		const fields = await decryptSummaryFields(masterKey, rec);
		const data = await decryptDataFields(masterKey, dataRec);

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
		await assertCharacterExists(characterId);

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

		const current = await decryptSummaryFields(masterKey, record);
		const updated: ChatSummaryFields = deepMerge(current, changes as Record<string, unknown>);
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
	): Promise<{ data: ChatDataFields; updatedAt: number } | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<ChatDataRecord>('chatData', id);
		if (!record || record.isDeleted) return null;

		const current = await decryptDataFields(masterKey, record);
		const updated = deepMerge(current, changes as Record<string, unknown>);
		const enc = await encryptText(masterKey, JSON.stringify(updated));

		record.encryptedData = enc.ciphertext;
		record.encryptedDataIV = enc.iv;
		record.updatedAt = Date.now();
		await localDB.putRecord('chatData', record);

		return { data: updated, updatedAt: record.updatedAt };
	}

	/** Update summary and/or data transactionally */
	static async update(
		id: string,
		summaryChanges?: Partial<ChatSummaryFields>,
		dataChanges?: Partial<ChatDataFields>
	): Promise<ChatDetail | null> {
		const { masterKey } = getActiveSession();
		let updatedSummary: ChatSummaryFields | undefined;
		let updatedData: ChatDataFields | undefined;
		let characterId: string | undefined;
		let createdAt: number | undefined;
		const finalUpdatedAt = Date.now();

		await localDB.transaction(['chatSummaries', 'chatData'], 'rw', async () => {
			// Read both records upfront — ensures no partial writes if one is missing
			const summaryRecord = await localDB.getRecord<ChatSummaryRecord>('chatSummaries', id);
			const dataRecord = await localDB.getRecord<ChatDataRecord>('chatData', id);
			if (
				!summaryRecord ||
				summaryRecord.isDeleted ||
				!dataRecord ||
				dataRecord.isDeleted
			) {
				return;
			}

			characterId = summaryRecord.characterId;
			createdAt = summaryRecord.createdAt;

			if (summaryChanges) {
				const currentSummary = await decryptSummaryFields(masterKey, summaryRecord);
				updatedSummary = deepMerge(currentSummary, summaryChanges as Record<string, unknown>);
				const summaryEnc = await encryptText(masterKey, JSON.stringify(updatedSummary));
				summaryRecord.encryptedData = summaryEnc.ciphertext;
				summaryRecord.encryptedDataIV = summaryEnc.iv;
				summaryRecord.updatedAt = finalUpdatedAt;
				await localDB.putRecord('chatSummaries', summaryRecord);
			} else {
				updatedSummary = await decryptSummaryFields(masterKey, summaryRecord);
			}

			if (dataChanges) {
				const currentData = await decryptDataFields(masterKey, dataRecord);
				updatedData = deepMerge(currentData, dataChanges as Record<string, unknown>);
				const dataEnc = await encryptText(masterKey, JSON.stringify(updatedData));
				dataRecord.encryptedData = dataEnc.ciphertext;
				dataRecord.encryptedDataIV = dataEnc.iv;
				dataRecord.updatedAt = finalUpdatedAt;
				await localDB.putRecord('chatData', dataRecord);
			} else {
				updatedData = await decryptDataFields(masterKey, dataRecord);
			}
		});

		if (!updatedSummary || !updatedData || !characterId || createdAt === undefined) return null;

		return {
			id,
			characterId,
			...updatedSummary,
			data: updatedData,
			createdAt,
			updatedAt: finalUpdatedAt
		};
	}

	/** Cascade soft-delete: owned lorebooks, scripts, messages, then chat itself */
	static async delete(id: string, expectedCharacterId?: string): Promise<void> {
		if (expectedCharacterId) {
			await assertChatOwnedByCharacter(id, expectedCharacterId);
		}

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
