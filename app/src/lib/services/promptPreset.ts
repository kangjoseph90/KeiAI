import { getActiveSession, encryptText, decryptText } from '../session.js';
import {
	localDB,
	type PromptPresetSummaryRecord,
	type PromptPresetDataRecord
} from '../db/index.js';

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

// ─── Service ─────────────────────────────────────────────────────────

export class PromptPresetService {
	/** List all presets (summary only) */
	static async list(): Promise<PromptPreset[]> {
		const { masterKey, userId } = getActiveSession();
		const records = await localDB.getAll<PromptPresetSummaryRecord>(
			'promptPresetSummaries',
			userId
		);

		return Promise.all(records.map(async (record) => {
			const fields: PromptPresetSummaryFields = JSON.parse(
				await decryptText(masterKey, {
					ciphertext: record.encryptedData,
					iv: record.encryptedDataIV
				})
			);
			return {
				id: record.id,
				...fields,
				createdAt: record.createdAt,
				updatedAt: record.updatedAt
			};
		}));
	}

	/** Get full preset (summary + data) */
	static async getDetail(id: string): Promise<PromptPresetDetail | null> {
		const { masterKey } = getActiveSession();

		const rec = await localDB.getRecord<PromptPresetSummaryRecord>('promptPresetSummaries', id);
		if (!rec || rec.isDeleted) return null;

		const dataRec = await localDB.getRecord<PromptPresetDataRecord>('promptPresetData', id);
		if (!dataRec || dataRec.isDeleted) return null;

		const fields: PromptPresetSummaryFields = JSON.parse(
			await decryptText(masterKey, { ciphertext: rec.encryptedData, iv: rec.encryptedDataIV })
		);
		const data: PromptPresetDataFields = JSON.parse(
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

		const current: PromptPresetSummaryFields = JSON.parse(
			await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.encryptedDataIV })
		);
		const updated = { ...current, ...changes };
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
	): Promise<{ updatedAt: number } | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<PromptPresetDataRecord>('promptPresetData', id);
		if (!record || record.isDeleted) return null;

		const current: PromptPresetDataFields = JSON.parse(
			await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.encryptedDataIV })
		);
		const updated = { ...current, ...changes };
		const enc = await encryptText(masterKey, JSON.stringify(updated));

		record.encryptedData = enc.ciphertext;
		record.encryptedDataIV = enc.iv;
		record.updatedAt = Date.now();
		await localDB.putRecord('promptPresetData', record);

		return { updatedAt: record.updatedAt };
	}

	/** Update summary and/or data transactionally */
	static async update(
		id: string,
		summaryChanges?: Partial<PromptPresetSummaryFields>,
		dataChanges?: Partial<PromptPresetDataFields>
	): Promise<{ summary?: PromptPresetSummaryFields; data?: PromptPresetDataFields; updatedAt: number } | null> {
		const { masterKey } = getActiveSession();
		let updatedSummary: PromptPresetSummaryFields | undefined;
		let updatedData: PromptPresetDataFields | undefined;
		let finalUpdatedAt = Date.now();

		await localDB.transaction(['promptPresetSummaries', 'promptPresetData'], 'rw', async () => {
			if (summaryChanges) {
				const summaryRecord = await localDB.getRecord<PromptPresetSummaryRecord>('promptPresetSummaries', id);
				if (!summaryRecord || summaryRecord.isDeleted) return;
				
				const currentSummary: PromptPresetSummaryFields = JSON.parse(
					await decryptText(masterKey, { ciphertext: summaryRecord.encryptedData, iv: summaryRecord.encryptedDataIV })
				);
				const mergedSummary = { ...currentSummary, ...summaryChanges };
				const enc = await encryptText(masterKey, JSON.stringify(mergedSummary));
				summaryRecord.encryptedData = enc.ciphertext;
				summaryRecord.encryptedDataIV = enc.iv;
				summaryRecord.updatedAt = finalUpdatedAt;
				await localDB.putRecord('promptPresetSummaries', summaryRecord);
				updatedSummary = mergedSummary;
			}

			if (dataChanges) {
				const dataRecord = await localDB.getRecord<PromptPresetDataRecord>('promptPresetData', id);
				if (!dataRecord || dataRecord.isDeleted) return;
				
				const currentData: PromptPresetDataFields = JSON.parse(
					await decryptText(masterKey, { ciphertext: dataRecord.encryptedData, iv: dataRecord.encryptedDataIV })
				);
				const mergedData = { ...currentData, ...dataChanges };
				const enc = await encryptText(masterKey, JSON.stringify(mergedData));
				
				dataRecord.encryptedData = enc.ciphertext;
				dataRecord.encryptedDataIV = enc.iv;
				dataRecord.updatedAt = finalUpdatedAt;
				await localDB.putRecord('promptPresetData', dataRecord);
				updatedData = mergedData;
			}
		});

		if (!updatedSummary && !updatedData) return null;

		return {
			summary: updatedSummary,
			data: updatedData,
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
