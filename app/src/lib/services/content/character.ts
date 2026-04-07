import { encrypt, decrypt } from '$lib/crypto';
import { getActiveSession } from '../session';
import { localDB, type CharacterSummaryRecord, type CharacterDataRecord } from '$lib/adapters/db';
import type { OrderedRef, FolderDef, AssetRef } from '$lib/types/refs';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { encryptedWriteQueue } from './write_queue';

// ─── Domain Types ────────────────────────────────────────────────────

export interface CharacterSummaryFields {
	name: string;
	shortDescription: string;
}

export interface CharacterDataRefs {
	lastActiveChatId?: string;
	avatarAssetId?: string;

	chatRefs?: OrderedRef[];
	moduleRefs?: OrderedRef[];
	lorebookRefs?: OrderedRef[];
	scriptRefs?: OrderedRef[];
	folders?: {
		chats?: FolderDef[];
		modules?: FolderDef[];
		lorebooks?: FolderDef[];
		scripts?: FolderDef[];
	};
	assets?: AssetRef[];
}

export interface CharacterDataContent {
	systemPrompt: string;
	greetingMessage?: string;
}

export interface CharacterDataFields extends CharacterDataContent, CharacterDataRefs {}

export interface Character extends CharacterSummaryFields {
	id: string;
}

export interface CharacterDetail extends Character {
	data: CharacterDataFields;
}

// ─── Defaults ─────────────────────────────────────────────────────────

const defaultSummaryFields: CharacterSummaryFields = {
	name: 'New Character',
	shortDescription: ''
};

const defaultDataFields: CharacterDataFields = {
	systemPrompt: ''
};

// ─── Helpers ─────────────────────────────────────────────────────────

function decryptSummaryFields(
	masterKey: CryptoKey,
	record: CharacterSummaryRecord
): Promise<CharacterSummaryFields> {
	return decrypt(masterKey, {
		ciphertext: record.encryptedData,
		iv: record.encryptedDataIV
	})
		.then((dec) => deepMerge(defaultSummaryFields, JSON.parse(dec)))
		.catch((error) => {
			throw new AppError('ENCRYPTION_FAILED', 'Failed to decrypt character summary', error);
		});
}

function decryptDataFields(
	masterKey: CryptoKey,
	record: CharacterDataRecord
): Promise<CharacterDataFields> {
	return decrypt(masterKey, {
		ciphertext: record.encryptedData,
		iv: record.encryptedDataIV
	})
		.then((dec) => deepMerge(defaultDataFields, JSON.parse(dec)))
		.catch((error) => {
			throw new AppError('ENCRYPTION_FAILED', 'Failed to decrypt character data', error);
		});
}

// ─── Service ─────────────────────────────────────────────────────────

export class CharacterService {
	/** List all character summaries */
	static async list(): Promise<Character[]> {
		await encryptedWriteQueue.flushTable('characterSummaries');
		const { masterKey, userId } = getActiveSession();
		const records = await localDB.getAll<CharacterSummaryRecord>('characterSummaries', userId);
		return Promise.all(
			records.map(async (record) => {
				const fields = await decryptSummaryFields(masterKey, record);
				return {
					id: record.id,
					...fields
				};
			})
		);
	}

	/** Get full character data */
	static async getDetail(id: string): Promise<CharacterDetail | null> {
		const { masterKey } = getActiveSession();
		const queuedSummary = encryptedWriteQueue.peek<CharacterSummaryFields>(
			'characterSummaries',
			id
		);
		const queuedData = encryptedWriteQueue.peek<CharacterDataFields>('characterData', id);

		const rec = await localDB.getRecord<CharacterSummaryRecord>('characterSummaries', id);
		if (!rec || rec.isDeleted) return null;

		const dataRec = await localDB.getRecord<CharacterDataRecord>('characterData', id);
		if (!dataRec || dataRec.isDeleted) return null;

		const fields = queuedSummary
			? deepMerge(defaultSummaryFields, queuedSummary as unknown as Record<string, unknown>)
			: await decryptSummaryFields(masterKey, rec);
		const data = queuedData
			? deepMerge(defaultDataFields, queuedData as unknown as Record<string, unknown>)
			: await decryptDataFields(masterKey, dataRec);

		return {
			id: rec.id,
			...fields,
			data
		};
	}

	/** Create a character - caller must add to parent's characterRefs */
	static async create(
		summary: DeepPartial<CharacterSummaryFields> = {},
		data: DeepPartial<CharacterDataFields> = {}
	): Promise<CharacterDetail> {
		const resolvedSummary: CharacterSummaryFields = deepMerge(
			defaultSummaryFields,
			summary as Record<string, unknown>
		);
		const resolvedData: CharacterDataFields = deepMerge(
			defaultDataFields,
			data as Record<string, unknown>
		);

		const { masterKey, userId } = getActiveSession();
		const id = generateId();
		const now = Date.now();

		try {
			const summaryEnc = await encrypt(masterKey, JSON.stringify(resolvedSummary));
			const dataEnc = await encrypt(masterKey, JSON.stringify(resolvedData));

			const summaryRecord: CharacterSummaryRecord = {
				id,
				userId,
				createdAt: now,
				updatedAt: now,
				isDeleted: false,
				encryptedData: summaryEnc.ciphertext,
				encryptedDataIV: summaryEnc.iv
			};
			const dataRecord: CharacterDataRecord = {
				id,
				userId,
				createdAt: now,
				updatedAt: now,
				isDeleted: false,
				encryptedData: dataEnc.ciphertext,
				encryptedDataIV: dataEnc.iv
			};

			await localDB.transaction(['characterSummaries', 'characterData'], 'rw', async () => {
				await localDB.putRecord<CharacterSummaryRecord>('characterSummaries', summaryRecord);
				await localDB.putRecord<CharacterDataRecord>('characterData', dataRecord);
			});
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to create character', error);
		}

		return { id, ...resolvedSummary, data: resolvedData };
	}

	/** Update summary only */
	static async updateSummary(
		id: string,
		changes: DeepPartial<CharacterSummaryFields>
	): Promise<Character> {
		const { masterKey } = getActiveSession();
		const queued = encryptedWriteQueue.peek<CharacterSummaryFields>('characterSummaries', id);
		const record = await localDB.getRecord<CharacterSummaryRecord>('characterSummaries', id);
		if (!record || record.isDeleted) {
			throw new AppError('NOT_FOUND', 'Character not found');
		}

		try {
			const current = queued
				? deepMerge(defaultSummaryFields, queued as unknown as Record<string, unknown>)
				: await decryptSummaryFields(masterKey, record);
			const updated: CharacterSummaryFields = deepMerge(
				current,
				changes as Record<string, unknown>
			);

			encryptedWriteQueue.upsert<CharacterSummaryFields, CharacterSummaryRecord>({
				tableName: 'characterSummaries',
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
					createdAt,
					updatedAt,
					isDeleted: false,
					encryptedData,
					encryptedDataIV
				})
			});

			return { id, ...updated };
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to update character summary', error);
		}
	}

	/** Update data only */
	static async updateData(
		id: string,
		changes: DeepPartial<CharacterDataFields>
	): Promise<CharacterDataFields> {
		const { masterKey } = getActiveSession();
		const queued = encryptedWriteQueue.peek<CharacterDataFields>('characterData', id);
		const record = await localDB.getRecord<CharacterDataRecord>('characterData', id);
		if (!record || record.isDeleted) {
			throw new AppError('NOT_FOUND', 'Character not found');
		}

		try {
			const current = queued
				? deepMerge(defaultDataFields, queued as unknown as Record<string, unknown>)
				: await decryptDataFields(masterKey, record);
			const updated: CharacterDataFields = deepMerge(current, changes as Record<string, unknown>);

			encryptedWriteQueue.upsert<CharacterDataFields, CharacterDataRecord>({
				tableName: 'characterData',
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
			throw new AppError('DB_WRITE_FAILED', 'Failed to update character data', error);
		}
	}

	/** Update summary and/or data transactionally */
	static async update(
		id: string,
		summaryChanges?: DeepPartial<CharacterSummaryFields>,
		dataChanges?: DeepPartial<CharacterDataFields>
	): Promise<CharacterDetail> {
		const detail = await this.getDetail(id);
		if (!detail) {
			throw new AppError('NOT_FOUND', 'Character not found');
		}

		const updatedSummary = summaryChanges
			? await this.updateSummary(id, summaryChanges)
			: { id, name: detail.name, shortDescription: detail.shortDescription };
		const updatedData = dataChanges ? await this.updateData(id, dataChanges) : detail.data;

		return { ...updatedSummary, data: updatedData };
	}

	static async delete(id: string): Promise<void> {
		try {
			await Promise.all([
				encryptedWriteQueue.flushTable('characterSummaries'),
				encryptedWriteQueue.flushTable('characterData'),
				encryptedWriteQueue.flushTable('chatSummaries'),
				encryptedWriteQueue.flushTable('chatData'),
				encryptedWriteQueue.flushTable('messages'),
				encryptedWriteQueue.flushTable('toolCalls'),
				encryptedWriteQueue.flushTable('lorebooks'),
				encryptedWriteQueue.flushTable('scripts')
			]);

			encryptedWriteQueue.drop('characterSummaries', id);
			encryptedWriteQueue.drop('characterData', id);
			await localDB.transaction(
				[
					'chatSummaries',
					'chatData',
					'lorebooks',
					'scripts',
					'messages',
					'toolCalls',
					'characterSummaries',
					'characterData'
				],
				'rw',
				async () => {
					const chatIds = (
						await localDB.getByIndex('chatSummaries', 'characterId', id, Number.MAX_SAFE_INTEGER)
					).map((c) => c.id);
					for (const chatId of chatIds) {
						await localDB.softDeleteByIndex('messages', 'chatId', chatId);
						await localDB.softDeleteByIndex('toolCalls', 'chatId', chatId);
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
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to delete character', error);
		}
	}
}
