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
	type ResourceRef,
	type FolderDef
} from '../db/index.js';

// ─── Domain Types ────────────────────────────────────────────────────

export interface ChatSummaryFields {
	title: string;
	lastMessagePreview: string;
}

export interface ChatDataFields {
	systemPromptOverride?: string;
	// N:M refs with per-context state
	moduleRefs?: ResourceRef[];
	lorebookRefs?: ResourceRef[];
	scriptRefs?: ResourceRef[];
	promptPresetId?: string;
	personaId?: string;
	// Folder definitions
	refFolders?: {
		modules?: FolderDef[];
		lorebooks?: FolderDef[];
		scripts?: FolderDef[];
	};
	// Chat variables (set by scripts)
	variables?: Record<string, unknown>;
}

export interface Chat extends ChatSummaryFields {
	id: string;
	createdAt: number;
	updatedAt: number;
}

export interface ChatDetail extends Chat {
	data: ChatDataFields;
}

// ─── Service ─────────────────────────────────────────────────────────

export class ChatService {
	/** Batch fetch chats summaries by IDs */
	static async getMany(ids: string[]): Promise<Chat[]> {
		const { masterKey } = getActiveSession();
		const results: Chat[] = [];

		for (const id of ids) {
			const record = await localDB.getRecord<ChatSummaryRecord>('chatSummaries', id);
			if (!record || record.isDeleted) continue;

			const fields: ChatSummaryFields = JSON.parse(
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
			...fields,
			data,
			createdAt: rec.createdAt,
			updatedAt: Math.max(rec.updatedAt, dataRec.updatedAt)
		};
	}

	/** Create a chat - caller must add to parent's chatRefs */
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

		return { id, ...fields, data, createdAt: now, updatedAt: now };
	}

	/** Update summary only */
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

	/** Update data only */
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
