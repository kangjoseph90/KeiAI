import { encryptText, decryptText, getActiveSession } from '../session.js';
import { localDB, type SettingsRecord } from '../db/index.js';

// ─── Domain Types ────────────────────────────────────────────────────

export interface AppSettings {
	theme: 'light' | 'dark' | 'system';
	apiKeys: {
		openai?: string;
		anthropic?: string;
	};
}

const defaultSettings: AppSettings = {
	theme: 'system',
	apiKeys: {}
};

// ─── Service ─────────────────────────────────────────────────────────

export class SettingsService {
	static async get(): Promise<AppSettings> {
		const { masterKey, userId } = getActiveSession();
		const records = await localDB.getAll<SettingsRecord>('settings', userId);

		if (records.length === 0) {
			return { ...defaultSettings };
		}

		const dec = await decryptText(masterKey, {
			ciphertext: records[0].encryptedData,
			iv: records[0].encryptedDataIV
		});
		return { ...defaultSettings, ...JSON.parse(dec) };
	}

	static async update(settings: AppSettings): Promise<void> {
		const { masterKey, userId } = getActiveSession();
		const enc = await encryptText(masterKey, JSON.stringify(settings));

		const existing = await localDB.getAll<SettingsRecord>('settings', userId);
		const id = existing.length > 0 ? existing[0].id : crypto.randomUUID();
		const createdAt = existing.length > 0 ? existing[0].createdAt : Date.now();

		await localDB.putRecord<SettingsRecord>('settings', {
			id, userId, createdAt, updatedAt: Date.now(), isDeleted: false,
			encryptedData: enc.ciphertext, encryptedDataIV: enc.iv
		});
	}
}
