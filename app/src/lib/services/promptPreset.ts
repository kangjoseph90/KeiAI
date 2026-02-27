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

		const results: PromptPreset[] = [];
		for (const record of records) {
			const fields: PromptPresetSummaryFields = JSON.parse(
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
		fields: PromptPresetSummaryFields,
		data: PromptPresetDataFields = defaultPresetData
	): Promise<PromptPresetDetail> {
		const { masterKey, userId } = getActiveSession();
		const id = crypto.randomUUID();
		const now = Date.now();

		const fieldsEnc = await encryptText(masterKey, JSON.stringify(fields));
		const dataEnc = await encryptText(masterKey, JSON.stringify(data));

		await localDB.transaction(['promptPresetSummaries', 'promptPresetData'], 'rw', async () => {
			await localDB.putRecord<PromptPresetSummaryRecord>('promptPresetSummaries', {
				id,
				userId,
				createdAt: now,
				updatedAt: now,
				isDeleted: false,
				encryptedData: fieldsEnc.ciphertext,
				encryptedDataIV: fieldsEnc.iv
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

		return { id, ...fields, data, createdAt: now, updatedAt: now };
	}

	/** Update summary only */
	static async updateSummary(
		id: string,
		changes: Partial<PromptPresetSummaryFields>
	): Promise<void> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<PromptPresetSummaryRecord>('promptPresetSummaries', id);
		if (!record || record.isDeleted) return;

		const current: PromptPresetSummaryFields = JSON.parse(
			await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.encryptedDataIV })
		);
		const updated = { ...current, ...changes };
		const enc = await encryptText(masterKey, JSON.stringify(updated));

		record.encryptedData = enc.ciphertext;
		record.encryptedDataIV = enc.iv;
		record.updatedAt = Date.now();
		await localDB.putRecord('promptPresetSummaries', record);
	}

	/** Update data only */
	static async updateData(id: string, changes: Partial<PromptPresetDataFields>): Promise<void> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<PromptPresetDataRecord>('promptPresetData', id);
		if (!record || record.isDeleted) return;

		const current: PromptPresetDataFields = JSON.parse(
			await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.encryptedDataIV })
		);
		const updated = { ...current, ...changes };
		const enc = await encryptText(masterKey, JSON.stringify(updated));

		record.encryptedData = enc.ciphertext;
		record.encryptedDataIV = enc.iv;
		record.updatedAt = Date.now();
		await localDB.putRecord('promptPresetData', record);
	}

	static async delete(id: string): Promise<void> {
		await localDB.transaction(['promptPresetSummaries', 'promptPresetData'], 'rw', async () => {
			await localDB.softDeleteRecord('promptPresetSummaries', id);
			await localDB.softDeleteRecord('promptPresetData', id);
		});
	}
}
