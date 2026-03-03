import { getActiveSession, encryptText, decryptText } from '../session.js';
import { localDB, type LorebookRecord } from '../db/index.js';
import { deepMerge } from '../utils/defaults.js';
import { assertLorebookOwnedBy, assertOwnedResourceParentExists } from './guards.js';
import { AppError } from '../errors.js';

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
}

// ─── Defaults ────────────────────────────────────────────────────────

const defaultLorebookFields: LorebookFields = {
	name: '',
	keys: [],
	content: '',
	insertionDepth: 0,
	enabled: true
};

// ─── Helpers ─────────────────────────────────────────────────────────

function decryptFields(masterKey: CryptoKey, record: LorebookRecord): Promise<LorebookFields> {
	return decryptText(masterKey, {
		ciphertext: record.encryptedData,
		iv: record.encryptedDataIV
	})
		.then((dec) => deepMerge(defaultLorebookFields, JSON.parse(dec)))
		.catch((error) => {
			throw new AppError('ENCRYPTION_FAILED', 'Failed to decrypt lorebook', error);
		});
}

// ─── Service ─────────────────────────────────────────────────────────

export class LorebookService {
	/** List lorebooks owned by a specific parent (character, chat, module) */
	static async listByOwner(ownerId: string): Promise<Lorebook[]> {
		const { masterKey } = getActiveSession();
		const records = await localDB.getByIndex<LorebookRecord>(
			'lorebooks',
			'ownerId',
			ownerId,
			Number.MAX_SAFE_INTEGER
		);
		return Promise.all(
			records.map(async (record) => {
				const fields = await decryptFields(masterKey, record);
				return {
					id: record.id,
					ownerId: record.ownerId,
					...fields
				};
			})
		);
	}

	static async get(id: string): Promise<Lorebook | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<LorebookRecord>('lorebooks', id);
		if (!record || record.isDeleted) return null;

		const fields = await decryptFields(masterKey, record);
		return {
			id: record.id,
			ownerId: record.ownerId,
			...fields
		};
	}

	static async create(ownerId: string, fields: Partial<LorebookFields> = {}): Promise<Lorebook> {
		await assertOwnedResourceParentExists(ownerId);

		const resolved: LorebookFields = deepMerge(defaultLorebookFields, fields as Record<string, unknown>);

		const { masterKey, userId } = getActiveSession();
		const id = crypto.randomUUID();
		const now = Date.now();

		try {
			const enc = await encryptText(masterKey, JSON.stringify(resolved));
			await localDB.putRecord<LorebookRecord>('lorebooks', {
				id, userId, ownerId, createdAt: now, updatedAt: now, isDeleted: false,
				encryptedData: enc.ciphertext, encryptedDataIV: enc.iv
			});
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to create lorebook', error);
		}

		return { id, ownerId, ...resolved };
	}

	static async update(
		id: string,
		changes: Partial<LorebookFields>,
		expectedOwnerId?: string
	): Promise<Lorebook> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<LorebookRecord>('lorebooks', id);
		if (!record || record.isDeleted) {
			throw new AppError('NOT_FOUND', `Lorebook not found: ${id}`);
		}
		if (expectedOwnerId) {
			await assertLorebookOwnedBy(expectedOwnerId, id);
		}

		try {
			const current = await decryptFields(masterKey, record);
			const updated: LorebookFields = deepMerge(current, changes as Record<string, unknown>);
			const enc = await encryptText(masterKey, JSON.stringify(updated));

			record.encryptedData = enc.ciphertext;
			record.encryptedDataIV = enc.iv;
			record.updatedAt = Date.now();
			await localDB.putRecord('lorebooks', record);

			return { id, ownerId: record.ownerId, ...updated };
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to update lorebook', error);
		}
	}

	static async delete(id: string, expectedOwnerId?: string): Promise<void> {
		if (expectedOwnerId) {
			await assertLorebookOwnedBy(expectedOwnerId, id);
		}
		try {
			await localDB.softDeleteRecord('lorebooks', id);
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to delete lorebook', error);
		}
	}
}
