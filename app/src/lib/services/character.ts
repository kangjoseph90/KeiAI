import { getActiveSession, encryptText, decryptText } from '../session.js';
import {
	localDB,
	type CharacterSummaryRecord,
	type CharacterDataRecord,
	type OrderedRef,
	type FolderDef,
	type AssetEntry
} from '../db/index.js';
import { deepMerge } from '../utils/defaults.js';
import { AppError } from '../errors.js';

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
}

export interface CharacterDetail extends Character {
	data: CharacterDataFields;
}

// ─── Defaults ────────────────────────────────────────────────────────

const defaultSummaryFields: CharacterSummaryFields = {
	name: '',
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
	return decryptText(masterKey, {
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
	return decryptText(masterKey, {
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

		// ⚡ Bolt: Parallelize database reads for summary and data records
		const [rec, dataRec] = await Promise.all([
			localDB.getRecord<CharacterSummaryRecord>('characterSummaries', id),
			localDB.getRecord<CharacterDataRecord>('characterData', id)
		]);

		if (!rec || rec.isDeleted || !dataRec || dataRec.isDeleted) return null;

		// ⚡ Bolt: Parallelize crypto decryption operations
		const [fields, data] = await Promise.all([
			decryptSummaryFields(masterKey, rec),
			decryptDataFields(masterKey, dataRec)
		]);

		return {
			id: rec.id,
			...fields,
			data
		};
	}

	/** Create a character - caller must add to parent's characterRefs */
	static async create(
		summary: Partial<CharacterSummaryFields> = {},
		data: Partial<CharacterDataFields> = {}
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
		const id = crypto.randomUUID();
		const now = Date.now();

		try {
			const summaryEnc = await encryptText(masterKey, JSON.stringify(resolvedSummary));
			const dataEnc = await encryptText(masterKey, JSON.stringify(resolvedData));

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
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to create character', error);
		}

		return { id, ...resolvedSummary, data: resolvedData };
	}

	/** Update summary only */
	static async updateSummary(
		id: string,
		changes: Partial<CharacterSummaryFields>
	): Promise<Character> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<CharacterSummaryRecord>('characterSummaries', id);
		if (!record || record.isDeleted) {
			throw new AppError('NOT_FOUND', 'Character not found');
		}

		try {
			const current = await decryptSummaryFields(masterKey, record);
			const updated: CharacterSummaryFields = deepMerge(
				current,
				changes as Record<string, unknown>
			);
			const enc = await encryptText(masterKey, JSON.stringify(updated));

			record.encryptedData = enc.ciphertext;
			record.encryptedDataIV = enc.iv;
			record.updatedAt = Date.now();
			await localDB.putRecord('characterSummaries', record);

			return { id, ...updated };
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to update character summary', error);
		}
	}

	/** Update data only */
	static async updateData(
		id: string,
		changes: Partial<CharacterDataFields>
	): Promise<CharacterDataFields> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<CharacterDataRecord>('characterData', id);
		if (!record || record.isDeleted) {
			throw new AppError('NOT_FOUND', 'Character not found');
		}

		try {
			const current = await decryptDataFields(masterKey, record);
			const updated: CharacterDataFields = deepMerge(current, changes as Record<string, unknown>);
			const enc = await encryptText(masterKey, JSON.stringify(updated));

			record.encryptedData = enc.ciphertext;
			record.encryptedDataIV = enc.iv;
			record.updatedAt = Date.now();
			await localDB.putRecord('characterData', record);

			return updated;
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to update character data', error);
		}
	}

	/** Update summary and/or data transactionally */
	static async update(
		id: string,
		summaryChanges?: Partial<CharacterSummaryFields>,
		dataChanges?: Partial<CharacterDataFields>
	): Promise<CharacterDetail> {
		const { masterKey } = getActiveSession();
		let updatedSummary: CharacterSummaryFields | undefined;
		let updatedData: CharacterDataFields | undefined;
		const finalUpdatedAt = Date.now();

		try {
			await localDB.transaction(['characterSummaries', 'characterData'], 'rw', async () => {
				// Read both records upfront — ensures no partial writes if one is missing
				const summaryRecord = await localDB.getRecord<CharacterSummaryRecord>(
					'characterSummaries',
					id
				);
				const dataRecord = await localDB.getRecord<CharacterDataRecord>('characterData', id);
				if (!summaryRecord || summaryRecord.isDeleted || !dataRecord || dataRecord.isDeleted) {
					throw new AppError('NOT_FOUND', 'Character not found');
				}

				if (summaryChanges) {
					const currentSummary = await decryptSummaryFields(masterKey, summaryRecord);
					updatedSummary = deepMerge(currentSummary, summaryChanges as Record<string, unknown>);
					const summaryEnc = await encryptText(masterKey, JSON.stringify(updatedSummary));
					summaryRecord.encryptedData = summaryEnc.ciphertext;
					summaryRecord.encryptedDataIV = summaryEnc.iv;
					summaryRecord.updatedAt = finalUpdatedAt;
					await localDB.putRecord('characterSummaries', summaryRecord);
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
					await localDB.putRecord('characterData', dataRecord);
				} else {
					updatedData = await decryptDataFields(masterKey, dataRecord);
				}
			});
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to update character', error);
		}

		if (!updatedSummary || !updatedData) {
			throw new AppError('NOT_FOUND', 'Character not found');
		}

		return {
			id,
			...updatedSummary,
			data: updatedData
		};
	}

	static async delete(id: string): Promise<void> {
		try {
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
					const chatIds = (
						await localDB.getByIndex('chatSummaries', 'characterId', id, Number.MAX_SAFE_INTEGER)
					).map((c) => c.id);
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
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to delete character', error);
		}
	}
}
