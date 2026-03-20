import { encrypt, decrypt } from '$lib/crypto';
import { getActiveSession } from '../session';
import { localDB, type PresetSummaryRecord, type PresetDataRecord } from '$lib/adapters/db';
import { deepMerge } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { encryptedWriteQueue } from './write_queue';
import type { ModelConfig } from '$lib/types/models';

// ─── Domain Types ──────────────────────────────────────────────────────

export interface PresetSummaryFields {
	name: string;
	description: string;
}

export type PromptTemplateEntry =
	| { name: string; type: 'instruction'; role: 'system' | 'user' | 'assistant'; content: string }
	| { name: string; type: 'description' }
	| { name: string; type: 'persona' }
	| { name: string; type: 'lorebook' }
	| { name: string; type: 'history'; start: number; end?: number };

export interface PresetDataFields {
	chatModel: ModelConfig;
	auxModel: ModelConfig;
	templateOrder: PromptTemplateEntry[];
	maxResponse: number;
	maxContext: number;
}

export interface Preset extends PresetSummaryFields {
	id: string;
}

export interface PresetDetail extends Preset {
	data: PresetDataFields;
}

// ─── Defaults ──────────────────────────────────────────────────────────

export const defaultPresetSummary: PresetSummaryFields = {
	name: 'New Preset',
	description: ''
};

export const defaultPresetData: PresetDataFields = {
	chatModel: { id: 'openai::gpt-5.4', provider: 'openai', parameters: {} },
	auxModel: { id: 'openai::gpt-5.4', provider: 'openai', parameters: {} },
	templateOrder: [
		{ name: 'System instruction', type: 'instruction', role: 'system', content: '' },
		{ name: 'Character description', type: 'description' },
		{ name: 'User persona', type: 'persona' },
		{ name: 'Lorebook', type: 'lorebook' },
		{ name: 'Early history', type: 'history', start: -10 },
		{ name: 'Additional instruction', type: 'instruction', role: 'system', content: '' }
	],
	maxResponse: 600,
	maxContext: 4096
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
		await encryptedWriteQueue.flushTable('presetSummaries');
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
		const queuedSummary = encryptedWriteQueue.peek<PresetSummaryFields>('presetSummaries', id);
		const queuedData = encryptedWriteQueue.peek<PresetDataFields>('presetData', id);

		const rec = await localDB.getRecord<PresetSummaryRecord>('presetSummaries', id);
		if (!rec || rec.isDeleted) return null;

		const dataRec = await localDB.getRecord<PresetDataRecord>('presetData', id);
		if (!dataRec || dataRec.isDeleted) return null;

		const fields = queuedSummary
			? deepMerge(defaultPresetSummary, queuedSummary as unknown as Record<string, unknown>)
			: await decryptSummaryFields(masterKey, rec);
		const data = queuedData
			? deepMerge(defaultPresetData, queuedData as unknown as Record<string, unknown>)
			: await decryptDataFields(masterKey, dataRec);

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
		const resolvedSummary: PresetSummaryFields = deepMerge(
			defaultPresetSummary,
			summary as Record<string, unknown>
		);
		const resolvedData: PresetDataFields = deepMerge(
			defaultPresetData,
			data as Record<string, unknown>
		);

		const { masterKey, userId } = getActiveSession();
		const id = generateId();
		const now = Date.now();

		try {
			const summaryEnc = await encrypt(masterKey, JSON.stringify(resolvedSummary));
			const dataEnc = await encrypt(masterKey, JSON.stringify(resolvedData));

			const summaryRecord: PresetSummaryRecord = {
				id,
				userId,
				createdAt: now,
				updatedAt: now,
				isDeleted: false,
				encryptedData: summaryEnc.ciphertext,
				encryptedDataIV: summaryEnc.iv
			};
			const dataRecord: PresetDataRecord = {
				id,
				userId,
				createdAt: now,
				updatedAt: now,
				isDeleted: false,
				encryptedData: dataEnc.ciphertext,
				encryptedDataIV: dataEnc.iv
			};

			await localDB.transaction(['presetSummaries', 'presetData'], 'rw', async () => {
				await localDB.putRecord<PresetSummaryRecord>('presetSummaries', summaryRecord);
				await localDB.putRecord<PresetDataRecord>('presetData', dataRecord);
			});
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to create preset', error);
		}

		return { id, ...resolvedSummary, data: resolvedData };
	}

	/** Update summary only */
	static async updateSummary(id: string, changes: Partial<PresetSummaryFields>): Promise<Preset> {
		const { masterKey } = getActiveSession();
		const queued = encryptedWriteQueue.peek<PresetSummaryFields>('presetSummaries', id);
		const record = await localDB.getRecord<PresetSummaryRecord>('presetSummaries', id);
		if (!record || record.isDeleted) {
			throw new AppError('NOT_FOUND', `Preset not found: ${id}`);
		}

		try {
			const current = queued
				? deepMerge(defaultPresetSummary, queued as unknown as Record<string, unknown>)
				: await decryptSummaryFields(masterKey, record);
			const updated: PresetSummaryFields = deepMerge(current, changes as Record<string, unknown>);

			encryptedWriteQueue.upsert<PresetSummaryFields, PresetSummaryRecord>({
				tableName: 'presetSummaries',
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
			throw new AppError('DB_WRITE_FAILED', 'Failed to update preset summary', error);
		}
	}

	/** Update data only */
	static async updateData(
		id: string,
		changes: Partial<PresetDataFields>
	): Promise<PresetDataFields> {
		const { masterKey } = getActiveSession();
		const queued = encryptedWriteQueue.peek<PresetDataFields>('presetData', id);
		const record = await localDB.getRecord<PresetDataRecord>('presetData', id);
		if (!record || record.isDeleted) {
			throw new AppError('NOT_FOUND', `Preset not found: ${id}`);
		}

		try {
			const current = queued
				? deepMerge(defaultPresetData, queued as unknown as Record<string, unknown>)
				: await decryptDataFields(masterKey, record);
			const updated: PresetDataFields = deepMerge(current, changes as Record<string, unknown>);

			encryptedWriteQueue.upsert<PresetDataFields, PresetDataRecord>({
				tableName: 'presetData',
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
			throw new AppError('DB_WRITE_FAILED', 'Failed to update preset data', error);
		}
	}

	/** Update summary and/or data transactionally */
	static async update(
		id: string,
		summaryChanges?: Partial<PresetSummaryFields>,
		dataChanges?: Partial<PresetDataFields>
	): Promise<PresetDetail> {
		const detail = await this.getDetail(id);
		if (!detail) {
			throw new AppError('NOT_FOUND', `Preset not found: ${id}`);
		}

		const updatedSummary = summaryChanges
			? await this.updateSummary(id, summaryChanges)
			: { id, name: detail.name, description: detail.description };
		const updatedData = dataChanges ? await this.updateData(id, dataChanges) : detail.data;

		return {
			...updatedSummary,
			data: updatedData
		};
	}

	static async delete(id: string): Promise<void> {
		try {
			encryptedWriteQueue.drop('presetSummaries', id);
			encryptedWriteQueue.drop('presetData', id);
			await localDB.transaction(['presetSummaries', 'presetData'], 'rw', async () => {
				await localDB.softDeleteRecord('presetSummaries', id);
				await localDB.softDeleteRecord('presetData', id);
			});
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to delete preset', error);
		}
	}
}
