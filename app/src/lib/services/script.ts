import { getActiveSession, encryptText, decryptText } from '../session.js';
import { localDB, type ScriptRecord } from '../db/index.js';
import { applyDefaults } from '../utils/defaults.js';
import { assertOwnedResourceParentExists, assertScriptOwnedBy } from './guards.js';

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
	createdAt: number;
	updatedAt: number;
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
	}).then((dec) => applyDefaults(defaultScriptFields, JSON.parse(dec)));
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
					...fields,
					createdAt: record.createdAt,
					updatedAt: record.updatedAt
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
			...fields,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt
		};
	}

	static async create(ownerId: string, fields: ScriptFields): Promise<Script> {
		await assertOwnedResourceParentExists(ownerId);

		const { masterKey, userId } = getActiveSession();
		const id = crypto.randomUUID();
		const now = Date.now();
		const enc = await encryptText(masterKey, JSON.stringify(fields));

		await localDB.putRecord<ScriptRecord>('scripts', {
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
		changes: Partial<ScriptFields>,
		expectedOwnerId?: string
	): Promise<Script | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<ScriptRecord>('scripts', id);
		if (!record || record.isDeleted) return null;
		if (expectedOwnerId) {
			await assertScriptOwnedBy(expectedOwnerId, id);
		}

		const current = await decryptFields(masterKey, record);
		const updated: ScriptFields = { ...current, ...changes };
		const enc = await encryptText(masterKey, JSON.stringify(updated));

		record.encryptedData = enc.ciphertext;
		record.encryptedDataIV = enc.iv;
		record.updatedAt = Date.now();
		await localDB.putRecord('scripts', record);

		return {
			id,
			ownerId: record.ownerId,
			...updated,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt
		};
	}

	static async delete(id: string, expectedOwnerId?: string): Promise<void> {
		if (expectedOwnerId) {
			await assertScriptOwnedBy(expectedOwnerId, id);
		}
		await localDB.softDeleteRecord('scripts', id);
	}
}
