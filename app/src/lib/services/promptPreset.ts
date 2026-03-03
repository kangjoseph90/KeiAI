import { getActiveSession, encryptText, decryptText } from '../session.js';
import {
	localDB,
	type PromptPresetSummaryRecord,
	type PromptPresetDataRecord
} from '../db/index.js';
import { deepMerge } from '../utils/defaults.js';

// ─── Domain Types ────────────────────────────────────────────────────

export interface PromptPresetSummaryFields {
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

export interface PromptPresetDataFields {
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

export interface PromptPreset extends PromptPresetSummaryFields {
	id: string;
	createdAt: number;
	updatedAt: number;
}

export interface PromptPresetDetail extends PromptPreset {
	data: PromptPresetDataFields;
}

// ─── Defaults ────────────────────────────────────────────────────────

export const defaultPresetSummary: PromptPresetSummaryFields = {
	name: '',
	description: ''
};

export const defaultPresetData: PromptPresetDataFields = {
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

// ─── Helpers ─────────────────────────────────────────────────────────

function decryptSummaryFields(
	masterKey: CryptoKey,
	record: PromptPresetSummaryRecord
): Promise<PromptPresetSummaryFields> {
	return decryptText(masterKey, {
		ciphertext: record.encryptedData,
		iv: record.encryptedDataIV
	}).then((dec) => deepMerge(defaultPresetSummary, JSON.parse(dec)));
}

function decryptDataFields(
	masterKey: CryptoKey,
	record: PromptPresetDataRecord
): Promise<PromptPresetDataFields> {
	return decryptText(masterKey, {
		ciphertext: record.encryptedData,
		iv: record.encryptedDataIV
	}).then((dec) => deepMerge(defaultPresetData, JSON.parse(dec)));
}

// ─── Service ─────────────────────────────────────────────────────────

export class PromptPresetService {
	/** List all presets (summary only) */
	static async list(): Promise<PromptPreset[]> {
		const { masterKey, userId } = getActiveSession();
		const records = await localDB.getAll<PromptPresetSummaryRecord>(
			'promptPresetSummaries',
			userId
		);

		return Promise.all(
			records.map(async (record) => {
				const fields = await decryptSummaryFields(masterKey, record);
				return {
					id: record.id,
					...fields,
					createdAt: record.createdAt,
					updatedAt: record.updatedAt
				};
			})
		);
	}

	/** Get full preset (summary + data) */
	static async getDetail(id: string): Promise<PromptPresetDetail | null> {
		const { masterKey } = getActiveSession();

		const rec = await localDB.getRecord<PromptPresetSummaryRecord>('promptPresetSummaries', id);
		if (!rec || rec.isDeleted) return null;

		const dataRec = await localDB.getRecord<PromptPresetDataRecord>('promptPresetData', id);
		if (!dataRec || dataRec.isDeleted) return null;

		const fields = await decryptSummaryFields(masterKey, rec);
		const data = await decryptDataFields(masterKey, dataRec);

		return {
			id: rec.id,
			...fields,
			data,
			createdAt: rec.createdAt,
			updatedAt: Math.max(rec.updatedAt, dataRec.updatedAt)
		};
	}

	/** Create a preset (writes to both tables) */
	static async create(
		summary: PromptPresetSummaryFields,
		data: PromptPresetDataFields = defaultPresetData
	): Promise<PromptPresetDetail> {
		const { masterKey, userId } = getActiveSession();
		const id = crypto.randomUUID();
		const now = Date.now();

		const summaryEnc = await encryptText(masterKey, JSON.stringify(summary));
		const dataEnc = await encryptText(masterKey, JSON.stringify(data));

		await localDB.transaction(['promptPresetSummaries', 'promptPresetData'], 'rw', async () => {
			await localDB.putRecord<PromptPresetSummaryRecord>('promptPresetSummaries', {
				id,
				userId,
				createdAt: now,
				updatedAt: now,
				isDeleted: false,
				encryptedData: summaryEnc.ciphertext,
				encryptedDataIV: summaryEnc.iv
			});
			await localDB.putRecord<PromptPresetDataRecord>('promptPresetData', {
				id,
				userId,
				createdAt: now,
				updatedAt: now,
				isDeleted: false,
				encryptedData: dataEnc.ciphertext,
				encryptedDataIV: dataEnc.iv
			});
		});

		return { id, ...summary, data, createdAt: now, updatedAt: now };
	}

	/** Update summary only */
	static async updateSummary(
		id: string,
		changes: Partial<PromptPresetSummaryFields>
	): Promise<PromptPreset | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<PromptPresetSummaryRecord>('promptPresetSummaries', id);
		if (!record || record.isDeleted) return null;

		const current = await decryptSummaryFields(masterKey, record);
		const updated: PromptPresetSummaryFields = deepMerge(current, changes as Record<string, unknown>);
		const enc = await encryptText(masterKey, JSON.stringify(updated));

		record.encryptedData = enc.ciphertext;
		record.encryptedDataIV = enc.iv;
		record.updatedAt = Date.now();
		await localDB.putRecord('promptPresetSummaries', record);

		return { id, ...updated, createdAt: record.createdAt, updatedAt: record.updatedAt };
	}

	/** Update data only */
	static async updateData(
		id: string,
		changes: Partial<PromptPresetDataFields>
	): Promise<{ data: PromptPresetDataFields; updatedAt: number } | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<PromptPresetDataRecord>('promptPresetData', id);
		if (!record || record.isDeleted) return null;

		const current = await decryptDataFields(masterKey, record);
		const updated: PromptPresetDataFields = deepMerge(current, changes as Record<string, unknown>);
		const enc = await encryptText(masterKey, JSON.stringify(updated));

		record.encryptedData = enc.ciphertext;
		record.encryptedDataIV = enc.iv;
		record.updatedAt = Date.now();
		await localDB.putRecord('promptPresetData', record);

		return { data: updated, updatedAt: record.updatedAt };
	}

	/** Update summary and/or data transactionally */
	static async update(
		id: string,
		summaryChanges?: Partial<PromptPresetSummaryFields>,
		dataChanges?: Partial<PromptPresetDataFields>
	): Promise<PromptPresetDetail | null> {
		const { masterKey } = getActiveSession();
		let updatedSummary: PromptPresetSummaryFields | undefined;
		let updatedData: PromptPresetDataFields | undefined;
		let createdAt: number | undefined;
		const finalUpdatedAt = Date.now();

		await localDB.transaction(['promptPresetSummaries', 'promptPresetData'], 'rw', async () => {
			// Read both records upfront — ensures no partial writes if one is missing
			const summaryRecord = await localDB.getRecord<PromptPresetSummaryRecord>(
				'promptPresetSummaries',
				id
			);
			const dataRecord = await localDB.getRecord<PromptPresetDataRecord>('promptPresetData', id);
			if (
				!summaryRecord ||
				summaryRecord.isDeleted ||
				!dataRecord ||
				dataRecord.isDeleted
			) {
				return;
			}

			createdAt = summaryRecord.createdAt;

			if (summaryChanges) {
				const currentSummary = await decryptSummaryFields(masterKey, summaryRecord);
				updatedSummary = deepMerge(currentSummary, summaryChanges as Record<string, unknown>);
				const summaryEnc = await encryptText(masterKey, JSON.stringify(updatedSummary));
				summaryRecord.encryptedData = summaryEnc.ciphertext;
				summaryRecord.encryptedDataIV = summaryEnc.iv;
				summaryRecord.updatedAt = finalUpdatedAt;
				await localDB.putRecord('promptPresetSummaries', summaryRecord);
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
				await localDB.putRecord('promptPresetData', dataRecord);
			} else {
				updatedData = await decryptDataFields(masterKey, dataRecord);
			}
		});

		if (!updatedSummary || !updatedData || createdAt === undefined) return null;

		return {
			id,
			...updatedSummary,
			data: updatedData,
			createdAt,
			updatedAt: finalUpdatedAt
		};
	}

	static async delete(id: string): Promise<void> {
		await localDB.transaction(['promptPresetSummaries', 'promptPresetData'], 'rw', async () => {
			await localDB.softDeleteRecord('promptPresetSummaries', id);
			await localDB.softDeleteRecord('promptPresetData', id);
		});
	}
}
