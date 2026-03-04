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
import { AppError } from '../errors.js';

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
	})
		.then((dec) => deepMerge(defaultSummaryFields, JSON.parse(dec)))
		.catch((error) => {
			throw new AppError('ENCRYPTION_FAILED', 'Failed to decrypt chat summary', error);
		});
}

function decryptDataFields(masterKey: CryptoKey, record: ChatDataRecord): Promise<ChatDataFields> {
	return decryptText(masterKey, {
		ciphertext: record.encryptedData,
		iv: record.encryptedDataIV
	})
		.then((dec) => deepMerge(defaultDataFields, JSON.parse(dec)))
		.catch((error) => {
			throw new AppError('ENCRYPTION_FAILED', 'Failed to decrypt chat data', error);
		});
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
					...fields
				};
			})
		);
	}

	/** Get full chat data */
	static async getDetail(id: string): Promise<ChatDetail | null> {
		const { masterKey } = getActiveSession();

		// ⚡ Bolt: Parallelize database reads for summary and data records
		const [rec, dataRec] = await Promise.all([
			localDB.getRecord<ChatSummaryRecord>('chatSummaries', id),
			localDB.getRecord<ChatDataRecord>('chatData', id)
		]);

		if (!rec || rec.isDeleted || !dataRec || dataRec.isDeleted) return null;

		// ⚡ Bolt: Parallelize crypto decryption operations
		const [fields, data] = await Promise.all([
			decryptSummaryFields(masterKey, rec),
			decryptDataFields(masterKey, dataRec)
		]);

		return {
			id: rec.id,
			characterId: rec.characterId,
			...fields,
			data
		};
	}

	/** Create a chat - caller must add to parent's chatRefs */
	static async create(
		characterId: string,
		summary: Partial<ChatSummaryFields> = {},
		data: Partial<ChatDataFields> = {}
	): Promise<ChatDetail> {
		await assertCharacterExists(characterId);

		const resolvedSummary: ChatSummaryFields = deepMerge(
			defaultSummaryFields,
			summary as Record<string, unknown>
		);
		const resolvedData: ChatDataFields = deepMerge(
			defaultDataFields,
			data as Record<string, unknown>
		);

		const { masterKey, userId } = getActiveSession();
		const id = crypto.randomUUID();
		const now = Date.now();

		try {
			const summaryEnc = await encryptText(masterKey, JSON.stringify(resolvedSummary));
			const dataEnc = await encryptText(masterKey, JSON.stringify(resolvedData));

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
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to create chat', error);
		}

		return { id, characterId, ...resolvedSummary, data: resolvedData };
	}

	/** Update summary only */
	static async updateSummary(id: string, changes: Partial<ChatSummaryFields>): Promise<Chat> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<ChatSummaryRecord>('chatSummaries', id);
		if (!record || record.isDeleted) {
			throw new AppError('NOT_FOUND', 'Chat not found');
		}

		try {
			const current = await decryptSummaryFields(masterKey, record);
			const updated: ChatSummaryFields = deepMerge(current, changes as Record<string, unknown>);
			const enc = await encryptText(masterKey, JSON.stringify(updated));

			record.encryptedData = enc.ciphertext;
			record.encryptedDataIV = enc.iv;
			record.updatedAt = Date.now();
			await localDB.putRecord('chatSummaries', record);

			return { id, characterId: record.characterId, ...updated };
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to update chat summary', error);
		}
	}

	/** Update data only */
	static async updateData(id: string, changes: Partial<ChatDataFields>): Promise<ChatDataFields> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<ChatDataRecord>('chatData', id);
		if (!record || record.isDeleted) {
			throw new AppError('NOT_FOUND', 'Chat not found');
		}

		try {
			const current = await decryptDataFields(masterKey, record);
			const updated = deepMerge(current, changes as Record<string, unknown>);
			const enc = await encryptText(masterKey, JSON.stringify(updated));

			record.encryptedData = enc.ciphertext;
			record.encryptedDataIV = enc.iv;
			record.updatedAt = Date.now();
			await localDB.putRecord('chatData', record);

			return updated;
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to update chat data', error);
		}
	}

	/** Update summary and/or data transactionally */
	static async update(
		id: string,
		summaryChanges?: Partial<ChatSummaryFields>,
		dataChanges?: Partial<ChatDataFields>
	): Promise<ChatDetail> {
		const { masterKey } = getActiveSession();
		let updatedSummary: ChatSummaryFields | undefined;
		let updatedData: ChatDataFields | undefined;
		let characterId: string | undefined;
		const finalUpdatedAt = Date.now();

		try {
			await localDB.transaction(['chatSummaries', 'chatData'], 'rw', async () => {
				const summaryRecord = await localDB.getRecord<ChatSummaryRecord>('chatSummaries', id);
				const dataRecord = await localDB.getRecord<ChatDataRecord>('chatData', id);
				if (!summaryRecord || summaryRecord.isDeleted || !dataRecord || dataRecord.isDeleted) {
					throw new AppError('NOT_FOUND', 'Chat not found');
				}

				characterId = summaryRecord.characterId;

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
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to update chat', error);
		}

		if (!updatedSummary || !updatedData || !characterId) {
			throw new AppError('NOT_FOUND', 'Chat not found');
		}

		return { id, characterId, ...updatedSummary, data: updatedData };
	}

	/** Cascade soft-delete: owned lorebooks, scripts, messages, then chat itself */
	static async delete(id: string, expectedCharacterId?: string): Promise<void> {
		if (expectedCharacterId) {
			await assertChatOwnedByCharacter(id, expectedCharacterId);
		}

		try {
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
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to delete chat', error);
		}
	}
}
