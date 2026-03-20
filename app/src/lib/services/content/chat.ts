/**
 * Chat Service
 *
 * No FK ??parent character holds chatRefs[] in its encrypted blob.
 * Chats are fetched by ID from the character's ref list.
 */

import { encrypt, decrypt } from '$lib/crypto';
import { getActiveSession } from '../session';
import { localDB, type ChatSummaryRecord, type ChatDataRecord } from '$lib/adapters/db';
import type { FolderDef, OrderedRef } from '$lib/types/refs';
import { deepMerge } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { encryptedWriteQueue } from './write_queue';

// ─── Domain Types ──────────────────────────────────────────────────────

export interface ChatSummaryFields {
	title: string;
	lastMessagePreview: string;
	messageCount: number;
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

// ─── Defaults ─────────────────────────────────────────────────────────

const defaultSummaryFields: ChatSummaryFields = {
	title: '',
	lastMessagePreview: '',
	messageCount: 0
};

const defaultDataFields: ChatDataFields = {};

// ─── Helpers ──────────────────────────────────────────────────────────

function decryptSummaryFields(
	masterKey: CryptoKey,
	record: ChatSummaryRecord
): Promise<ChatSummaryFields> {
	return decrypt(masterKey, {
		ciphertext: record.encryptedData,
		iv: record.encryptedDataIV
	})
		.then((dec) => deepMerge(defaultSummaryFields, JSON.parse(dec)))
		.catch((error) => {
			throw new AppError('ENCRYPTION_FAILED', 'Failed to decrypt chat summary', error);
		});
}

function decryptDataFields(masterKey: CryptoKey, record: ChatDataRecord): Promise<ChatDataFields> {
	return decrypt(masterKey, {
		ciphertext: record.encryptedData,
		iv: record.encryptedDataIV
	})
		.then((dec) => deepMerge(defaultDataFields, JSON.parse(dec)))
		.catch((error) => {
			throw new AppError('ENCRYPTION_FAILED', 'Failed to decrypt chat data', error);
		});
}

// ─── Service ──────────────────────────────────────────────────────────

export class ChatService {
	static async listByCharacter(characterId: string): Promise<Chat[]> {
		await encryptedWriteQueue.flushTable('chatSummaries');
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
		const queuedSummary = encryptedWriteQueue.peek<ChatSummaryFields>('chatSummaries', id);
		const queuedData = encryptedWriteQueue.peek<ChatDataFields>('chatData', id);

		const rec = await localDB.getRecord<ChatSummaryRecord>('chatSummaries', id);
		if (!rec || rec.isDeleted) return null;

		const dataRec = await localDB.getRecord<ChatDataRecord>('chatData', id);
		if (!dataRec || dataRec.isDeleted) return null;

		const fields = queuedSummary
			? deepMerge(defaultSummaryFields, queuedSummary as unknown as Record<string, unknown>)
			: await decryptSummaryFields(masterKey, rec);
		const data = queuedData
			? deepMerge(defaultDataFields, queuedData as unknown as Record<string, unknown>)
			: await decryptDataFields(masterKey, dataRec);

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
		const resolvedSummary: ChatSummaryFields = deepMerge(
			defaultSummaryFields,
			summary as Record<string, unknown>
		);
		const resolvedData: ChatDataFields = deepMerge(
			defaultDataFields,
			data as Record<string, unknown>
		);

		const { masterKey, userId } = getActiveSession();
		const id = generateId();
		const now = Date.now();

		try {
			const summaryEnc = await encrypt(masterKey, JSON.stringify(resolvedSummary));
			const dataEnc = await encrypt(masterKey, JSON.stringify(resolvedData));

			const summaryRecord: ChatSummaryRecord = {
				id,
				userId,
				characterId,
				createdAt: now,
				updatedAt: now,
				isDeleted: false,
				encryptedData: summaryEnc.ciphertext,
				encryptedDataIV: summaryEnc.iv
			};
			const dataRecord: ChatDataRecord = {
				id,
				userId,
				characterId,
				createdAt: now,
				updatedAt: now,
				isDeleted: false,
				encryptedData: dataEnc.ciphertext,
				encryptedDataIV: dataEnc.iv
			};

			await localDB.transaction(['chatSummaries', 'chatData'], 'rw', async () => {
				await localDB.putRecord<ChatSummaryRecord>('chatSummaries', summaryRecord);
				await localDB.putRecord<ChatDataRecord>('chatData', dataRecord);
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
		const queued = encryptedWriteQueue.peek<ChatSummaryFields>('chatSummaries', id);
		const record = await localDB.getRecord<ChatSummaryRecord>('chatSummaries', id);
		if (!record || record.isDeleted) {
			throw new AppError('NOT_FOUND', 'Chat not found');
		}

		try {
			const current = queued
				? deepMerge(defaultSummaryFields, queued as unknown as Record<string, unknown>)
				: await decryptSummaryFields(masterKey, record);
			const updated: ChatSummaryFields = deepMerge(current, changes as Record<string, unknown>);

			encryptedWriteQueue.upsert<ChatSummaryFields, ChatSummaryRecord>({
				tableName: 'chatSummaries',
				id,
				userId: record.userId,
				createdAt: record.createdAt,
				nextFields: updated,
				mergeFields: (queuedCurrent, next) =>
					deepMerge(queuedCurrent, next as unknown as Record<string, unknown>),
				toRecord: ({
					id: recordId,
					userId: recordUserId,
					createdAt,
					updatedAt,
					encryptedData,
					encryptedDataIV
				}) => ({
					id: recordId,
					userId: recordUserId,
					characterId: record.characterId,
					createdAt,
					updatedAt,
					isDeleted: false,
					encryptedData,
					encryptedDataIV
				})
			});

			return { id, characterId: record.characterId, ...updated };
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to update chat summary', error);
		}
	}

	/** Update data only */
	static async updateData(id: string, changes: Partial<ChatDataFields>): Promise<ChatDataFields> {
		const { masterKey } = getActiveSession();
		const queued = encryptedWriteQueue.peek<ChatDataFields>('chatData', id);
		const record = await localDB.getRecord<ChatDataRecord>('chatData', id);
		if (!record || record.isDeleted) {
			throw new AppError('NOT_FOUND', 'Chat not found');
		}

		try {
			const current = queued
				? deepMerge(defaultDataFields, queued as unknown as Record<string, unknown>)
				: await decryptDataFields(masterKey, record);
			const updated = deepMerge(current, changes as Record<string, unknown>);

			encryptedWriteQueue.upsert<ChatDataFields, ChatDataRecord>({
				tableName: 'chatData',
				id,
				userId: record.userId,
				createdAt: record.createdAt,
				nextFields: updated,
				mergeFields: (queuedCurrent, next) =>
					deepMerge(queuedCurrent, next as unknown as Record<string, unknown>),
				toRecord: ({
					id: recordId,
					userId: recordUserId,
					createdAt,
					updatedAt,
					encryptedData,
					encryptedDataIV
				}) => ({
					id: recordId,
					userId: recordUserId,
					characterId: record.characterId,
					createdAt,
					updatedAt,
					isDeleted: false,
					encryptedData,
					encryptedDataIV
				})
			});

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
		const detail = await this.getDetail(id);
		if (!detail) {
			throw new AppError('NOT_FOUND', 'Chat not found');
		}

		const updatedSummary = summaryChanges
			? await this.updateSummary(id, summaryChanges)
			: {
					id,
					characterId: detail.characterId,
					title: detail.title,
					lastMessagePreview: detail.lastMessagePreview,
					messageCount: detail.messageCount
				};
		const updatedData = dataChanges ? await this.updateData(id, dataChanges) : detail.data;

		return { ...updatedSummary, data: updatedData };
	}

	/** Cascade soft-delete: owned lorebooks, scripts, messages, then chat itself */
	static async delete(id: string): Promise<void> {
		try {
			await Promise.all([
				encryptedWriteQueue.flushTable('chatSummaries'),
				encryptedWriteQueue.flushTable('chatData'),
				encryptedWriteQueue.flushTable('messages'),
				encryptedWriteQueue.flushTable('toolCalls'),
				encryptedWriteQueue.flushTable('lorebooks'),
				encryptedWriteQueue.flushTable('scripts')
			]);

			encryptedWriteQueue.drop('chatSummaries', id);
			encryptedWriteQueue.drop('chatData', id);
			await localDB.transaction(
				['lorebooks', 'scripts', 'messages', 'chatSummaries', 'chatData', 'toolCalls'],
				'rw',
				async () => {
					await localDB.softDeleteByIndex('lorebooks', 'ownerId', id);
					await localDB.softDeleteByIndex('scripts', 'ownerId', id);
					await localDB.softDeleteByIndex('messages', 'chatId', id);
					await localDB.softDeleteByIndex('toolCalls', 'chatId', id);
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
