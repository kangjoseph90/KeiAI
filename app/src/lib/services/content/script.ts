import { encrypt, decrypt } from '$lib/crypto';
import { getActiveSession } from '../session';
import { localDB, type ScriptRecord } from '$lib/adapters/db';
import { deepMerge } from '$lib/shared/defaults';
import { assertOwnedResourceParentExists, assertScriptOwnedBy } from './guards';
import { AppError } from '$lib/shared/errors';
import { generateId } from '$lib/shared/id';
import { encryptedWriteQueue } from './write_queue';

// ─── Domain Types ──────────────────────────────────────────────────────

export interface ScriptFields {
	name: string;
	regex: string;
	replacement: string;
	placement: 'input' | 'request' | 'output' | 'display';
	enabled: boolean;
}

export interface Script extends ScriptFields {
	id: string;
	ownerId: string;
}

// ─── Defaults ─────────────────────────────────────────────────────────

const defaultScriptFields: ScriptFields = {
	name: '',
	regex: '',
	replacement: '',
	placement: 'display',
	enabled: true
};

// ─── Helpers ──────────────────────────────────────────────────────────

function decryptFields(masterKey: CryptoKey, record: ScriptRecord): Promise<ScriptFields> {
	return decrypt(masterKey, {
		ciphertext: record.encryptedData,
		iv: record.encryptedDataIV
	})
		.then((dec) => deepMerge(defaultScriptFields, JSON.parse(dec)))
		.catch((error) => {
			throw new AppError('ENCRYPTION_FAILED', 'Failed to decrypt script', error);
		});
}

// ─── Service ──────────────────────────────────────────────────────────

export class ScriptService {
	/** List scripts owned by a specific parent (character, module) */
	static async listByOwner(ownerId: string): Promise<Script[]> {
		await encryptedWriteQueue.flushTable('scripts');
		const { masterKey } = getActiveSession();
		const records = await localDB.getByIndex<ScriptRecord>(
			'scripts',
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

	static async get(id: string): Promise<Script | null> {
		const { masterKey } = getActiveSession();
		const queued = encryptedWriteQueue.peek<ScriptFields>('scripts', id);
		if (queued) {
			const record = await localDB.getRecord<ScriptRecord>('scripts', id);
			if (!record || record.isDeleted) return null;
			return {
				id,
				ownerId: record.ownerId,
				...deepMerge(defaultScriptFields, queued as unknown as Record<string, unknown>)
			};
		}

		const record = await localDB.getRecord<ScriptRecord>('scripts', id);
		if (!record || record.isDeleted) return null;

		const fields = await decryptFields(masterKey, record);
		return {
			id: record.id,
			ownerId: record.ownerId,
			...fields
		};
	}

	static async create(ownerId: string, fields: Partial<ScriptFields> = {}): Promise<Script> {
		await assertOwnedResourceParentExists(ownerId);

		const resolved: ScriptFields = deepMerge(
			defaultScriptFields,
			fields as Record<string, unknown>
		);

		const { masterKey, userId } = getActiveSession();
		const id = generateId();
		const now = Date.now();

		try {
			const enc = await encrypt(masterKey, JSON.stringify(resolved));
			const newRecord: ScriptRecord = {
				id,
				userId,
				ownerId,
				createdAt: now,
				updatedAt: now,
				isDeleted: false,
				encryptedData: enc.ciphertext,
				encryptedDataIV: enc.iv
			};
			await localDB.putRecord<ScriptRecord>('scripts', newRecord);
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to create script', error);
		}

		return { id, ownerId, ...resolved };
	}

	static async update(
		id: string,
		changes: Partial<ScriptFields>,
		expectedOwnerId?: string
	): Promise<Script> {
		const { masterKey } = getActiveSession();
		const queued = encryptedWriteQueue.peek<ScriptFields>('scripts', id);
		const record = await localDB.getRecord<ScriptRecord>('scripts', id);
		if (!record || record.isDeleted) {
			throw new AppError('NOT_FOUND', `Script not found: ${id}`);
		}
		if (expectedOwnerId) {
			await assertScriptOwnedBy(expectedOwnerId, id);
		}

		try {
			const current = queued
				? deepMerge(defaultScriptFields, queued as unknown as Record<string, unknown>)
				: await decryptFields(masterKey, record);
			const updated: ScriptFields = deepMerge(current, changes as Record<string, unknown>);

			encryptedWriteQueue.upsert<ScriptFields, ScriptRecord>({
				tableName: 'scripts',
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
			throw new AppError('DB_WRITE_FAILED', 'Failed to update script', error);
		}
	}

	static async delete(id: string, expectedOwnerId?: string): Promise<void> {
		if (expectedOwnerId) {
			await assertScriptOwnedBy(expectedOwnerId, id);
		}
		try {
			encryptedWriteQueue.drop('scripts', id);
			await localDB.softDeleteRecord('scripts', id);
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to delete script', error);
		}
	}
}
