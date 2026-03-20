import { encrypt, decrypt } from '$lib/crypto';
import { getActiveSession } from '../session';
import { localDB, type LorebookRecord } from '$lib/adapters/db';
import { deepMerge } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { encryptedWriteQueue } from './write_queue';

// ─── Domain Types ──────────────────────────────────────────────────────

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

// ─── Defaults ─────────────────────────────────────────────────────────

const defaultLorebookFields: LorebookFields = {
	name: 'New Lorebook',
	keys: [],
	content: '',
	insertionDepth: 0,
	enabled: true
};

// ─── Helpers ──────────────────────────────────────────────────────────

function decryptFields(masterKey: CryptoKey, record: LorebookRecord): Promise<LorebookFields> {
	return decrypt(masterKey, {
		ciphertext: record.encryptedData,
		iv: record.encryptedDataIV
	})
		.then((dec) => deepMerge(defaultLorebookFields, JSON.parse(dec)))
		.catch((error) => {
			throw new AppError('ENCRYPTION_FAILED', 'Failed to decrypt lorebook', error);
		});
}

// ─── Service ──────────────────────────────────────────────────────────

export class LorebookService {
	/** List lorebooks owned by a specific parent (character, chat, module) */
	static async listByOwner(ownerId: string): Promise<Lorebook[]> {
		await encryptedWriteQueue.flushTable('lorebooks');
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
		const queued = encryptedWriteQueue.peek<LorebookFields>('lorebooks', id);
		if (queued) {
			const record = await localDB.getRecord<LorebookRecord>('lorebooks', id);
			if (!record || record.isDeleted) return null;
			return {
				id,
				ownerId: record.ownerId,
				...deepMerge(defaultLorebookFields, queued as unknown as Record<string, unknown>)
			};
		}

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
		const resolved: LorebookFields = deepMerge(
			defaultLorebookFields,
			fields as Record<string, unknown>
		);

		const { masterKey, userId } = getActiveSession();
		const id = generateId();
		const now = Date.now();

		try {
			const enc = await encrypt(masterKey, JSON.stringify(resolved));
			const newRecord: LorebookRecord = {
				id,
				userId,
				ownerId,
				createdAt: now,
				updatedAt: now,
				isDeleted: false,
				encryptedData: enc.ciphertext,
				encryptedDataIV: enc.iv
			};
			await localDB.putRecord<LorebookRecord>('lorebooks', newRecord);
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to create lorebook', error);
		}

		return { id, ownerId, ...resolved };
	}

	static async update(id: string, changes: Partial<LorebookFields>): Promise<Lorebook> {
		const { masterKey } = getActiveSession();
		const queued = encryptedWriteQueue.peek<LorebookFields>('lorebooks', id);
		const record = await localDB.getRecord<LorebookRecord>('lorebooks', id);
		if (!record || record.isDeleted) {
			throw new AppError('NOT_FOUND', `Lorebook not found: ${id}`);
		}

		try {
			const current = queued
				? deepMerge(defaultLorebookFields, queued as unknown as Record<string, unknown>)
				: await decryptFields(masterKey, record);
			const updated: LorebookFields = deepMerge(current, changes as Record<string, unknown>);

			encryptedWriteQueue.upsert<LorebookFields, LorebookRecord>({
				tableName: 'lorebooks',
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
					ownerId: record.ownerId,
					createdAt,
					updatedAt,
					isDeleted: false,
					encryptedData,
					encryptedDataIV
				})
			});

			return { id, ownerId: record.ownerId, ...updated };
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to update lorebook', error);
		}
	}

	static async delete(id: string): Promise<void> {
		try {
			encryptedWriteQueue.drop('lorebooks', id);
			await localDB.softDeleteRecord('lorebooks', id);
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to delete lorebook', error);
		}
	}
}
