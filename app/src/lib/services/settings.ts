import { encryptText, decryptText, getActiveSession } from '../session.js';
import {
	localDB,
	type SettingsRecord,
	type OrderedRef,
	type FolderDef,
	type ResourceRef
} from '../db/index.js';

// ─── Domain Types ────────────────────────────────────────────────────

export interface AppSettings {
	theme: 'light' | 'dark' | 'system';
	apiKeys: {
		openai?: string;
		anthropic?: string;
	};
	// 1:N — workspace holds ordered refs for top-level entities
	characterRefs?: OrderedRef[];
	personaRefs?: OrderedRef[];
	presetRefs?: OrderedRef[];
	moduleRefs?: ResourceRef[];
	pluginRefs?: ResourceRef[];
	// Folder definitions for each top-level list
	folders?: {
		characters?: FolderDef[];
		personas?: FolderDef[];
		presets?: FolderDef[];
		modules?: FolderDef[];
		plugins?: FolderDef[];
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
		const record = await localDB.getRecord<SettingsRecord>('settings', userId);

		if (!record || record.isDeleted) {
			return { ...defaultSettings };
		}

		const dec = await decryptText(masterKey, {
			ciphertext: record.encryptedData,
			iv: record.encryptedDataIV
		});
		return { ...defaultSettings, ...JSON.parse(dec) };
	}

	static async update(settings: AppSettings): Promise<void> {
		const { masterKey, userId } = getActiveSession();
		const enc = await encryptText(masterKey, JSON.stringify(settings));

		const existing = await localDB.getRecord<SettingsRecord>('settings', userId);

		await localDB.putRecord<SettingsRecord>('settings', {
			id: userId,
			userId,
			createdAt: existing?.createdAt ?? Date.now(),
			updatedAt: Date.now(),
			isDeleted: false,
			encryptedData: enc.ciphertext,
			encryptedDataIV: enc.iv
		});
	}
}
