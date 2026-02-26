/**
 * Chat Service
 *
 * Tables:
 *   chatSummaries — { id, characterId, userId, …, data, iv }  (list previews)
 *   chatData      — { id, userId, …, data, iv }               (heavy, lazy-loaded)
 */

import { getActiveSession, encryptText, decryptText } from '../session.js';
import {
	localDB,
	type ChatSummaryRecord,
	type ChatDataRecord
} from '../db/index.js';

// ─── Domain Types ────────────────────────────────────────────────────

export interface ChatSummaryFields {
	title: string;
	lastMessagePreview: string;
}

export interface ChatDataFields {
	systemPromptOverride?: string;
}

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
	/** List all chats for a character (summary only, newest first) */
	static async listByCharacter(characterId: string): Promise<Chat[]> {
		const { masterKey } = getActiveSession();
		const records = await localDB.getByIndex<ChatSummaryRecord>(
			'chatSummaries', 'characterId', characterId, 100, 0
		);

		const results: Chat[] = [];
		for (const record of records) {
			const fields: ChatSummaryFields = JSON.parse(
				await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.encryptedDataIV })
			);
			results.push({
				id: record.id,
				characterId: record.characterId,
				...fields,
				createdAt: record.createdAt,
				updatedAt: record.updatedAt
			});
		}

		results.sort((a, b) => b.updatedAt - a.updatedAt);
		return results;
	}

	/** Get full chat (summary + data) */
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
			await decryptText(masterKey, { ciphertext: dataRec.encryptedData, iv: dataRec.encryptedDataIV })
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

	/** Create a chat (writes to both tables) */
	static async create(
		characterId: string,
		title: string,
		data: ChatDataFields = {}
	): Promise<ChatDetail> {
		const { masterKey, userId } = getActiveSession();
		const id = crypto.randomUUID();
		const now = Date.now();

		const fields: ChatSummaryFields = { title, lastMessagePreview: '' };
		const summaryEnc = await encryptText(masterKey, JSON.stringify(fields));
		const dataEnc = await encryptText(masterKey, JSON.stringify(data));

		await localDB.putRecord<ChatSummaryRecord>('chatSummaries', {
			id, userId, characterId, createdAt: now, updatedAt: now, isDeleted: false,
			encryptedData: summaryEnc.ciphertext, encryptedDataIV: summaryEnc.iv
		});
		await localDB.putRecord<ChatDataRecord>('chatData', {
			id, userId, createdAt: now, updatedAt: now, isDeleted: false,
			encryptedData: dataEnc.ciphertext, encryptedDataIV: dataEnc.iv
		});

		return { id, characterId, ...fields, data, createdAt: now, updatedAt: now };
	}

	/** Update summary only (e.g. rename, update preview) */
	static async updateSummary(id: string, changes: Partial<ChatSummaryFields>): Promise<void> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<ChatSummaryRecord>('chatSummaries', id);
		if (!record || record.isDeleted) return;

		const current: ChatSummaryFields = JSON.parse(
			await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.encryptedDataIV })
		);
		const updated = { ...current, ...changes };
		const enc = await encryptText(masterKey, JSON.stringify(updated));

		record.encryptedData = enc.ciphertext;
		record.encryptedDataIV = enc.iv;
		record.updatedAt = Date.now();
		await localDB.putRecord('chatSummaries', record);
	}

	/** Update data only (e.g. chat-specific prompt override) */
	static async updateData(id: string, changes: Partial<ChatDataFields>): Promise<void> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<ChatDataRecord>('chatData', id);
		if (!record || record.isDeleted) return;

		const current: ChatDataFields = JSON.parse(
			await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.encryptedDataIV })
		);
		const updated = { ...current, ...changes };
		const enc = await encryptText(masterKey, JSON.stringify(updated));

		record.encryptedData = enc.ciphertext;
		record.encryptedDataIV = enc.iv;
		record.updatedAt = Date.now();
		await localDB.putRecord('chatData', record);
	}

	/** Soft-delete (both tables) */
	static async delete(id: string): Promise<void> {
		await localDB.softDeleteRecord('chatSummaries', id);
		await localDB.softDeleteRecord('chatData', id);
	}
}
