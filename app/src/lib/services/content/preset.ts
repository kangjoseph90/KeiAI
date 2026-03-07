import { encrypt, decrypt } from '../../crypto/index.js';
import { getActiveSession } from '../session.js';
import {
	localDB,
	type PresetSummaryRecord,
	type PresetDataRecord
} from '../../adapters/db/index.js';
import { DataSyncService } from '../sync/index.js';
import { deepMerge } from '../../shared/defaults.js';
import { AppError } from '../../shared/errors.js';
import { generateId } from '../../shared/id.js';

// ─── Domain Types ──────────────────────────────────────────────────────

export interface PresetSummaryFields {
	name: string;
	description: string;
}

export interface PromptTemplateEntry {
	type:
		| 'system'
		| 'jailbreak'
		| 'description'
		| 'persona'
		| 'lorebook'
		| 'chat'
		| 'memory'
		| 'authornote'
		| 'postEverything'
		| 'plain';
	role: 'system' | 'user' | 'assistant';
	content?: string;
}

export interface PresetDataFields {
	model: string;
	templateOrder: PromptTemplateEntry[];
	authorsNote: string;
	authorsNoteDepth: number;
	jailbreakPrompt: string;
	jailbreakEnabled: boolean;
	temperature: number;
	topP: number;
	topK: number;
	frequencyPenalty: number;
	presencePenalty: number;
	maxTokens: number;
	maxContextTokens: number;
	memoryTokensRatio: number;
}

export interface Preset extends PresetSummaryFields {
	id: string;
}

export interface PresetDetail extends Preset {
	data: PresetDataFields;
}

// ─── Defaults ──────────────────────────────────────────────────────────

export const defaultPresetSummary: PresetSummaryFields = {
	name: '',
	description: ''
};

export const defaultPresetData: PresetDataFields = {
	model: '',
	templateOrder: [
		{ type: 'system', role: 'system' },
		{ type: 'description', role: 'system' },
		{ type: 'persona', role: 'system' },
		{ type: 'lorebook', role: 'system' },
		{ type: 'chat', role: 'user' },
		{ type: 'memory', role: 'system' },
		{ type: 'authornote', role: 'system' },
		{ type: 'jailbreak', role: 'system' },
		{ type: 'postEverything', role: 'system' }
	],
	authorsNote: '',
	authorsNoteDepth: 4,
	jailbreakPrompt: '',
	jailbreakEnabled: false,
	temperature: 0.9,
	topP: 1,
	topK: 0,
	frequencyPenalty: 0,
	presencePenalty: 0,
	maxTokens: 600,
	maxContextTokens: 4096,
	memoryTokensRatio: 0.2
};

// ─── Helpers ───────────────────────────────────────────────────────────

function decryptSummaryFields(
	masterKey: CryptoKey,
	record: PresetSummaryRecord
): Promise<PresetSummaryFields> {
	return decrypt(masterKey, {
		ciphertext: record.encryptedData,
		iv: record.encryptedDataIV
	})
		.then((dec) => deepMerge(defaultPresetSummary, JSON.parse(dec)))
		.catch((error) => {
			throw new AppError('ENCRYPTION_FAILED', 'Failed to decrypt preset summary', error);
		});
}

function decryptDataFields(
	masterKey: CryptoKey,
	record: PresetDataRecord
): Promise<PresetDataFields> {
	return decrypt(masterKey, {
		ciphertext: record.encryptedData,
		iv: record.encryptedDataIV
	})
		.then((dec) => deepMerge(defaultPresetData, JSON.parse(dec)))
		.catch((error) => {
			throw new AppError('ENCRYPTION_FAILED', 'Failed to decrypt preset data', error);
		});
}

// ─── Service ───────────────────────────────────────────────────────────

export class PresetService {
	/** List all presets (summary only) */
	static async list(): Promise<Preset[]> {
		const { masterKey, userId } = getActiveSession();
		const records = await localDB.getAll<PresetSummaryRecord>('presetSummaries', userId);

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

	/** Get full preset (summary + data) */
	static async getDetail(id: string): Promise<PresetDetail | null> {
		const { masterKey } = getActiveSession();

		const rec = await localDB.getRecord<PresetSummaryRecord>('presetSummaries', id);
		if (!rec || rec.isDeleted) return null;

		const dataRec = await localDB.getRecord<PresetDataRecord>('presetData', id);
		if (!dataRec || dataRec.isDeleted) return null;

		const fields = await decryptSummaryFields(masterKey, rec);
		const data = await decryptDataFields(masterKey, dataRec);

		return {
			id: rec.id,
			...fields,
			data
		};
	}

	/** Create a preset (writes to both tables) */
	static async create(
		summary: Partial<PresetSummaryFields> = {},
		data: Partial<PresetDataFields> = {}
	): Promise<PresetDetail> {
		const resolvedSummary: PresetSummaryFields = deepMerge(defaultPresetSummary, summary as Record<string, unknown>);
		const resolvedData: PresetDataFields = deepMerge(defaultPresetData, data as Record<string, unknown>);

		const { masterKey, userId } = getActiveSession();
		const id = generateId();
		const now = Date.now();

		try {
			const summaryEnc = await encrypt(masterKey, JSON.stringify(resolvedSummary));
			const dataEnc = await encrypt(masterKey, JSON.stringify(resolvedData));

			const summaryRecord: PresetSummaryRecord = {
				id, userId, createdAt: now, updatedAt: now, isDeleted: false,
				encryptedData: summaryEnc.ciphertext, encryptedDataIV: summaryEnc.iv
			};
			const dataRecord: PresetDataRecord = {
				id, userId, createdAt: now, updatedAt: now, isDeleted: false,
				encryptedData: dataEnc.ciphertext, encryptedDataIV: dataEnc.iv
			};

			await localDB.transaction(['presetSummaries', 'presetData'], 'rw', async () => {
				await localDB.putRecord<PresetSummaryRecord>('presetSummaries', summaryRecord);
				await localDB.putRecord<PresetDataRecord>('presetData', dataRecord);
			});
			void DataSyncService.pushRecord('presetSummaries', summaryRecord, true);
			void DataSyncService.pushRecord('presetData', dataRecord, true);
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to create preset', error);
		}

		return { id, ...resolvedSummary, data: resolvedData };
	}

	/** Update summary only */
	static async updateSummary(
		id: string,
		changes: Partial<PresetSummaryFields>
	): Promise<Preset> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<PresetSummaryRecord>('presetSummaries', id);
		if (!record || record.isDeleted) {
			throw new AppError('NOT_FOUND', `Preset not found: ${id}`);
		}

		try {
			const current = await decryptSummaryFields(masterKey, record);
			const updated: PresetSummaryFields = deepMerge(current, changes as Record<string, unknown>);
			const enc = await encrypt(masterKey, JSON.stringify(updated));

			record.encryptedData = enc.ciphertext;
			record.encryptedDataIV = enc.iv;
			record.updatedAt = Date.now();
			await localDB.putRecord('presetSummaries', record);
			void DataSyncService.pushRecord('presetSummaries', record);

			return { id, ...updated };
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to update preset summary', error);
		}
	}

	/** Update data only */
	static async updateData(
		id: string,
		changes: Partial<PresetDataFields>
	): Promise<PresetDataFields> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<PresetDataRecord>('presetData', id);
		if (!record || record.isDeleted) {
			throw new AppError('NOT_FOUND', `Preset not found: ${id}`);
		}

		try {
			const current = await decryptDataFields(masterKey, record);
			const updated: PresetDataFields = deepMerge(current, changes as Record<string, unknown>);
			const enc = await encrypt(masterKey, JSON.stringify(updated));

			record.encryptedData = enc.ciphertext;
			record.encryptedDataIV = enc.iv;
			record.updatedAt = Date.now();
			await localDB.putRecord('presetData', record);
			void DataSyncService.pushRecord('presetData', record);

			return updated;
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to update preset data', error);
		}
	}

	/** Update summary and/or data transactionally */
	static async update(
		id: string,
		summaryChanges?: Partial<PresetSummaryFields>,
		dataChanges?: Partial<PresetDataFields>
	): Promise<PresetDetail> {
		const { masterKey } = getActiveSession();
		let updatedSummary: PresetSummaryFields | undefined;
		let updatedData: PresetDataFields | undefined;
		const finalUpdatedAt = Date.now();
		let summaryRecordToSync: PresetSummaryRecord | undefined;
		let dataRecordToSync: PresetDataRecord | undefined;

		try {
			await localDB.transaction(['presetSummaries', 'presetData'], 'rw', async () => {
				// Read both records upfront ??ensures no partial writes if one is missing
				const summaryRecord = await localDB.getRecord<PresetSummaryRecord>(
					'presetSummaries',
					id
				);
				const dataRecord = await localDB.getRecord<PresetDataRecord>('presetData', id);
				if (
					!summaryRecord ||
					summaryRecord.isDeleted ||
					!dataRecord ||
					dataRecord.isDeleted
				) {
					throw new AppError('NOT_FOUND', `Preset not found: ${id}`);
				}

				if (summaryChanges) {
					const currentSummary = await decryptSummaryFields(masterKey, summaryRecord);
					updatedSummary = deepMerge(currentSummary, summaryChanges as Record<string, unknown>);
					const summaryEnc = await encrypt(masterKey, JSON.stringify(updatedSummary));
					summaryRecord.encryptedData = summaryEnc.ciphertext;
					summaryRecord.encryptedDataIV = summaryEnc.iv;
					summaryRecord.updatedAt = finalUpdatedAt;
					await localDB.putRecord('presetSummaries', summaryRecord);
					summaryRecordToSync = summaryRecord;
				} else {
					updatedSummary = await decryptSummaryFields(masterKey, summaryRecord);
				}

				if (dataChanges) {
					const currentData = await decryptDataFields(masterKey, dataRecord);
					updatedData = deepMerge(currentData, dataChanges as Record<string, unknown>);
					const dataEnc = await encrypt(masterKey, JSON.stringify(updatedData));
					dataRecord.encryptedData = dataEnc.ciphertext;
					dataRecord.encryptedDataIV = dataEnc.iv;
					dataRecord.updatedAt = finalUpdatedAt;
					await localDB.putRecord('presetData', dataRecord);
					dataRecordToSync = dataRecord;
				} else {
					updatedData = await decryptDataFields(masterKey, dataRecord);
				}
			});
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to update preset', error);
		}

		if (!updatedSummary || !updatedData) {
			throw new AppError('NOT_FOUND', `Preset not found: ${id}`);
		}

		if (summaryRecordToSync) void DataSyncService.pushRecord('presetSummaries', summaryRecordToSync);
		if (dataRecordToSync) void DataSyncService.pushRecord('presetData', dataRecordToSync);

		return {
			id,
			...updatedSummary,
			data: updatedData
		};
	}

	static async delete(id: string): Promise<void> {
		try {
			await localDB.transaction(['presetSummaries', 'presetData'], 'rw', async () => {
				await localDB.softDeleteRecord('presetSummaries', id);
				await localDB.softDeleteRecord('presetData', id);
			});
			void DataSyncService.pushById('presetSummaries', id);
			void DataSyncService.pushById('presetData', id);
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to delete preset', error);
		}
	}
}
