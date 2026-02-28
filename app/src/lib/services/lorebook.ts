import { getActiveSession, encryptText, decryptText } from '../session.js';
import { localDB, type LorebookRecord } from '../db/index.js';

// ─── Domain Types ────────────────────────────────────────────────────

export interface LorebookFields {
	name: string;
	keys: string[];
	content: string;
	insertionDepth: number;
	enabled: boolean;
	regex?: string;
	probability?: number;
}

export interface Lorebook extends LorebookFields {
	id: string;
	ownerId: string;
	createdAt: number;
	updatedAt: number;
}

// ─── Service ─────────────────────────────────────────────────────────

export class LorebookService {
	/** List lorebooks owned by a specific parent (character, chat, module) */
	static async listByOwner(ownerId: string): Promise<Lorebook[]> {
		const { masterKey } = getActiveSession();
		const records = await localDB.getByIndex<LorebookRecord>('lorebooks', 'ownerId', ownerId);
		return Promise.all(records.map(async (record) => {
			const fields: LorebookFields = JSON.parse(
				await decryptText(masterKey, {
					ciphertext: record.encryptedData,
					iv: record.encryptedDataIV
				})
			);
			return {
				id: record.id,
				ownerId: record.ownerId,
				...fields,
				createdAt: record.createdAt,
				updatedAt: record.updatedAt
			};
		}));
	}

	static async get(id: string): Promise<Lorebook | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<LorebookRecord>('lorebooks', id);
		if (!record || record.isDeleted) return null;

		const fields: LorebookFields = JSON.parse(
			await decryptText(masterKey, {
				ciphertext: record.encryptedData,
				iv: record.encryptedDataIV
			})
		);
		return {
			id: record.id,
			ownerId: record.ownerId,
			...fields,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt
		};
	}

	static async create(
		ownerId: string, 
		fields: LorebookFields
	): Promise<Lorebook> {
		const { masterKey, userId } = getActiveSession();
		const id = crypto.randomUUID();
		const now = Date.now();
		const enc = await encryptText(masterKey, JSON.stringify(fields));

		await localDB.putRecord<LorebookRecord>('lorebooks', {
			id,
			userId,
			ownerId,
			createdAt: now,
			updatedAt: now,
			isDeleted: false,
			encryptedData: enc.ciphertext,
			encryptedDataIV: enc.iv
		});

		return {
			id,
			ownerId,
			...fields,
			createdAt: now,
			updatedAt: now
		};
	}

	static async update(
		id: string, 
		changes: Partial<LorebookFields>
	): Promise<Lorebook | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<LorebookRecord>('lorebooks', id);
		if (!record || record.isDeleted) return null;

		const current: LorebookFields = JSON.parse(
			await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.encryptedDataIV })
		);
		const updated = { ...current, ...changes };
		const enc = await encryptText(masterKey, JSON.stringify(updated));

		record.encryptedData = enc.ciphertext;
		record.encryptedDataIV = enc.iv;
		record.updatedAt = Date.now();
		await localDB.putRecord('lorebooks', record);

		return {
			id,
			ownerId: record.ownerId,
			...updated,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt
		};
	}

	static async delete(id: string): Promise<void> {
		await localDB.softDeleteRecord('lorebooks', id);
	}
}
