import { getActiveSession, encryptText, decryptText } from '../../session.js';
import { localDB, type ScriptRecord } from '../../adapters/db/index.js';
import { deepMerge } from '../../shared/defaults.js';
import { assertOwnedResourceParentExists, assertScriptOwnedBy } from './guards.js';
import { AppError } from '../../shared/errors.js';

// ─── Domain Types ────────────────────────────────────────────────────

export interface ScriptFields {
	name: string;
	regex: string;
	replacement: string;
	placement: 'onInput' | 'onOutput' | 'onRequest' | 'onDisplay';
	enabled: boolean;
}

export interface Script extends ScriptFields {
	id: string;
	ownerId: string;
}

// ─── Defaults ────────────────────────────────────────────────────────

const defaultScriptFields: ScriptFields = {
	name: '',
	regex: '',
	replacement: '',
	placement: 'onInput',
	enabled: true
};

// ─── Helpers ─────────────────────────────────────────────────────────

function decryptFields(masterKey: CryptoKey, record: ScriptRecord): Promise<ScriptFields> {
	return decryptText(masterKey, {
		ciphertext: record.encryptedData,
		iv: record.encryptedDataIV
	})
		.then((dec) => deepMerge(defaultScriptFields, JSON.parse(dec)))
		.catch((error) => {
			throw new AppError('ENCRYPTION_FAILED', 'Failed to decrypt script', error);
		});
}

// ─── Service ─────────────────────────────────────────────────────────

export class ScriptService {
	/** List scripts owned by a specific parent (character, module) */
	static async listByOwner(ownerId: string): Promise<Script[]> {
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

		const resolved: ScriptFields = deepMerge(defaultScriptFields, fields as Record<string, unknown>);

		const { masterKey, userId } = getActiveSession();
		const id = crypto.randomUUID();
		const now = Date.now();

		try {
			const enc = await encryptText(masterKey, JSON.stringify(resolved));
			await localDB.putRecord<ScriptRecord>('scripts', {
				id, userId, ownerId, createdAt: now, updatedAt: now, isDeleted: false,
				encryptedData: enc.ciphertext, encryptedDataIV: enc.iv
			});
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
		const record = await localDB.getRecord<ScriptRecord>('scripts', id);
		if (!record || record.isDeleted) {
			throw new AppError('NOT_FOUND', `Script not found: ${id}`);
		}
		if (expectedOwnerId) {
			await assertScriptOwnedBy(expectedOwnerId, id);
		}

		try {
			const current = await decryptFields(masterKey, record);
			const updated: ScriptFields = deepMerge(current, changes as Record<string, unknown>);
			const enc = await encryptText(masterKey, JSON.stringify(updated));

			record.encryptedData = enc.ciphertext;
			record.encryptedDataIV = enc.iv;
			record.updatedAt = Date.now();
			await localDB.putRecord('scripts', record);

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
			await localDB.softDeleteRecord('scripts', id);
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to delete script', error);
		}
	}
}
