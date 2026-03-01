import { encryptText, decryptText, getActiveSession } from '../session.js';
import {
	localDB,
	type SettingsRecord,
	type OrderedRef,
	type FolderDef,
	type ResourceRef
} from '../db/index.js';
import { deepMerge } from '../utils/defaults.js';

// ─── Domain Types ────────────────────────────────────────────────────

export interface AppSettingsContent {
	theme: 'light' | 'dark' | 'system';
	apiKeys: {
		openai?: string;
		anthropic?: string;
	};
}

export interface AppSettingsRefs {
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

export interface AppSettings extends AppSettingsContent, AppSettingsRefs {}

const defaultSettings: AppSettingsContent = {
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
		return deepMerge(defaultSettings as AppSettings, JSON.parse(dec));
	}

	static async set(settings: AppSettings): Promise<void> {
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

	/** Partial update — read-modify-write with merge */
	static async update(changes: Partial<AppSettings>): Promise<AppSettings | null> {
		const { masterKey, userId } = getActiveSession();
		const record = await localDB.getRecord<SettingsRecord>('settings', userId);

		let current: AppSettings;
		if (!record || record.isDeleted) {
			current = { ...defaultSettings } as AppSettings;
		} else {
			current = deepMerge(
				defaultSettings as AppSettings,
				JSON.parse(
					await decryptText(masterKey, {
						ciphertext: record.encryptedData,
						iv: record.encryptedDataIV
					})
				)
			);
		}

		const updated: AppSettings = deepMerge(current, changes as Record<string, unknown>);
		const enc = await encryptText(masterKey, JSON.stringify(updated));

		await localDB.putRecord<SettingsRecord>('settings', {
			id: userId,
			userId,
			createdAt: record?.createdAt ?? Date.now(),
			updatedAt: Date.now(),
			isDeleted: false,
			encryptedData: enc.ciphertext,
			encryptedDataIV: enc.iv
		});

		return updated;
	}
}
