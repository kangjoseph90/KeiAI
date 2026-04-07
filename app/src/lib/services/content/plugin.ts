import { encrypt, decrypt } from '$lib/crypto';
import { getActiveSession } from '../session';
import { localDB, type PluginRecord } from '$lib/adapters/db';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { encryptedWriteQueue } from './write_queue';

// ─── Domain Types ────────────────────────────────────────────────────

export interface PluginFields {
	name: string;
	description: string;
	version: string;
	code: string; // Sandboxed JS source
	config: Record<string, unknown>;
	hooks: PluginHook[];
}

export interface PluginHook {
	event: 'beforePrompt' | 'afterPrompt' | 'beforeSend' | 'afterReceive' | 'onRender';
	handler: string; // Function name in plugin code
}

export interface Plugin extends PluginFields {
	id: string;
}

// ─── Defaults ─────────────────────────────────────────────────────────

const defaultPluginFields: PluginFields = {
	name: 'New Plugin',
	description: '',
	version: '',
	code: '',
	config: {},
	hooks: []
};

// ─── Helpers ──────────────────────────────────────────────────────────

function decryptFields(masterKey: CryptoKey, record: PluginRecord): Promise<PluginFields> {
	return decrypt(masterKey, {
		ciphertext: record.encryptedData,
		iv: record.encryptedDataIV
	})
		.then((dec) => deepMerge(defaultPluginFields, JSON.parse(dec)))
		.catch((error) => {
			throw new AppError('ENCRYPTION_FAILED', 'Failed to decrypt plugin', error);
		});
}

// ─── Service ──────────────────────────────────────────────────────────

export class PluginService {
	static async list(): Promise<Plugin[]> {
		await encryptedWriteQueue.flushTable('plugins');
		const { masterKey, userId } = getActiveSession();
		const records = await localDB.getAll<PluginRecord>('plugins', userId);

		return Promise.all(
			records.map(async (record) => {
				const fields = await decryptFields(masterKey, record);
				return {
					id: record.id,
					...fields
				};
			})
		);
	}

	static async get(id: string): Promise<Plugin | null> {
		const { masterKey } = getActiveSession();
		const queued = encryptedWriteQueue.peek<PluginFields>('plugins', id);
		if (queued) {
			return {
				id,
				...deepMerge(defaultPluginFields, queued as unknown as Record<string, unknown>)
			};
		}

		const record = await localDB.getRecord<PluginRecord>('plugins', id);
		if (!record || record.isDeleted) return null;

		const fields = await decryptFields(masterKey, record);
		return {
			id: record.id,
			...fields
		};
	}

	static async create(fields: DeepPartial<PluginFields> = {}): Promise<Plugin> {
		const resolved: PluginFields = deepMerge(
			defaultPluginFields,
			fields as Record<string, unknown>
		);

		const { masterKey, userId } = getActiveSession();
		const id = generateId();
		const now = Date.now();

		try {
			const enc = await encrypt(masterKey, JSON.stringify(resolved));
			const newRecord: PluginRecord = {
				id,
				userId,
				createdAt: now,
				updatedAt: now,
				isDeleted: false,
				encryptedData: enc.ciphertext,
				encryptedDataIV: enc.iv
			};
			await localDB.putRecord<PluginRecord>('plugins', newRecord);
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to create plugin', error);
		}

		return { id, ...resolved };
	}

	static async update(id: string, changes: DeepPartial<PluginFields>): Promise<Plugin> {
		const { masterKey } = getActiveSession();
		const queued = encryptedWriteQueue.peek<PluginFields>('plugins', id);
		const record = await localDB.getRecord<PluginRecord>('plugins', id);
		if (!record || record.isDeleted) {
			throw new AppError('NOT_FOUND', `Plugin not found: ${id}`);
		}

		try {
			const current = queued
				? deepMerge(defaultPluginFields, queued as unknown as Record<string, unknown>)
				: await decryptFields(masterKey, record);
			const updated: PluginFields = deepMerge(current, changes as Record<string, unknown>);

			encryptedWriteQueue.upsert<PluginFields, PluginRecord>({
				tableName: 'plugins',
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
			throw new AppError('DB_WRITE_FAILED', 'Failed to update plugin', error);
		}
	}

	static async delete(id: string): Promise<void> {
		try {
			encryptedWriteQueue.drop('plugins', id);
			await localDB.softDeleteRecord('plugins', id);
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to delete plugin', error);
		}
	}
}
