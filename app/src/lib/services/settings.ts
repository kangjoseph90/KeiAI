import { encryptText, decryptText, getActiveSession } from '../session.js';
import { localDB, type SettingsRecord } from '../db/index.js';

export interface AppSettings {
	theme: 'light' | 'dark' | 'system';
	apiKeys: {
		openai?: string;
		anthropic?: string;
	};
	// other global configs...
}

const defaultSettings: AppSettings = {
	theme: 'system',
	apiKeys: {}
};

export class SettingsService {
	static async get(): Promise<AppSettings> {
		const { masterKey, userId } = getActiveSession();
		
		// In our schema, we index by userId, and there is usually only 1 record per user.
		const records = await localDB.getAll<SettingsRecord>('settings', userId);
		
		if (records.length === 0) {
			// First time, return defaults without saving to avoid empty overhead
			return { ...defaultSettings };
		}
		
		const record = records[0];
		
		const decText = await decryptText(masterKey, {
			ciphertext: record.encryptedData,
			iv: record.dataIv
		});
		
		return { ...defaultSettings, ...JSON.parse(decText) };
	}

	static async update(settings: AppSettings): Promise<void> {
		const { masterKey, userId } = getActiveSession();
		
		const sumEnc = await encryptText(masterKey, JSON.stringify(settings));
		
		// Get existing record if any to update same UUID, else make new
		const existingRecords = await localDB.getAll<SettingsRecord>('settings', userId);
		const id = existingRecords.length > 0 ? existingRecords[0].id : crypto.randomUUID();
		const createdAt = existingRecords.length > 0 ? existingRecords[0].createdAt : Date.now();

		const record: SettingsRecord = {
			id,
			userId,
			createdAt,
			updatedAt: Date.now(),
			isDeleted: false,
			encryptedData: sumEnc.ciphertext,
			dataIv: sumEnc.iv
		};

		await localDB.putRecord('settings', record);
	}
}
