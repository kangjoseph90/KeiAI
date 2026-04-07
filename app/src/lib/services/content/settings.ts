import { decrypt } from '$lib/crypto';
import { getActiveSession } from '../session';
import { localDB, type SettingsRecord } from '$lib/adapters/db';
import type { OrderedRef, FolderDef, ResourceRef } from '$lib/types/refs';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { encryptedWriteQueue } from './write_queue';
import type { CustomLLMModel } from '$lib/types/models/llm';
import type {
	AnthropicProviderConfig,
	CustomProviderConfig,
	DeepSeekProviderConfig,
	GoogleProviderConfig,
	MistralProviderConfig,
	NovelAIProviderConfig,
	OpenAIProviderConfig,
	OpenRouterProviderConfig,
	TransformersProviderConfig,
	VoyageAIProviderConfig,
	ElevenLabsProviderConfig,
	KokoroProviderConfig,
	MiniLMProviderConfig
} from '$lib/types/models/provider';
import type { EmbeddingProvider } from '$lib/types/models/embedding';
import type { TTSProvider } from '$lib/types/models/tts';

// ─── Domain Types ──────────────────────────────────────────────────────

export interface AppSettingsContent {
	theme: 'light' | 'dark' | 'system';
	openai: OpenAIProviderConfig;
	anthropic: AnthropicProviderConfig;
	google: GoogleProviderConfig;
	mistral: MistralProviderConfig;
	deepseek: DeepSeekProviderConfig;
	novelai: NovelAIProviderConfig;
	voyageai: VoyageAIProviderConfig;
	openrouter: OpenRouterProviderConfig;
	transformers: TransformersProviderConfig;
	elevenlabs: ElevenLabsProviderConfig;
	kokoro: KokoroProviderConfig;
	minilm: MiniLMProviderConfig;
	custom: CustomProviderConfig;
	embeddingProvider: EmbeddingProvider;
	ttsProvider: TTSProvider;
}

export interface AppSettingsRefs {
	personaId?: string;
	presetId?: string;
	// 1:N - workspace holds ordered refs for top-level entities
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

export const defaultSettings: AppSettingsContent = {
	theme: 'system',
	openai: {
		tts: {
			modelId: 'tts-1',
			voiceId: 'alloy'
		},
		embedding: {
			modelId: 'text-embedding-3-small'
		}
	},
	anthropic: {},
	google: {
		apiKey: '',
		tts: {
			modelId: 'gemini-2.5-flash-preview-tts',
			voiceId: 'zephyr'
		},
		embedding: {
			modelId: 'gemini-embedding-2-preview'
		}
	},
	mistral: {
		apiKey: ''
	},
	deepseek: {
		apiKey: ''
	},
	novelai: {
		apiKey: '',
		tts: {
			voiceId: 'aini',
			version: 'v2'
		}
	},
	voyageai: {
		embedding: {
			modelId: 'voyage-4-large'
		}
	},
	openrouter: {
		embedding: {
			modelId: 'openai/text-embedding-3-small'
		}
	},
	transformers: {
		embedding: {
			modelId: 'onnx-community/Qwen3-Embedding-0.6B-ONNX'
		},
		tts: {
			modelId: 'onnx-community/Kokoro-82M-v1.0-ONNX',
			voiceId: 'af_heart'
		}
	},
	elevenlabs: {
		apiKey: '',
		tts: {
			voiceId: ''
		}
	},
	kokoro: {
		tts: {
			voiceId: 'af_heart'
		}
	},
	minilm: {
		embedding: {
			modelId: 'onnx-community/all-MiniLM-L6-v2-ONNX'
		}
	},
	custom: {
		llm: {
			models: []
		},
		embedding: {
			modelId: '',
			baseUrl: '',
			apiKey: ''
		}
	},
	embeddingProvider: 'openai',
	ttsProvider: 'openai'
};

// ─── Service ──────────────────────────────────────────────────────────

export class SettingsService {
	static async get(): Promise<AppSettings> {
		const { masterKey, userId } = getActiveSession();
		const queued = encryptedWriteQueue.peek<AppSettings>('settings', userId);
		if (queued) {
			return deepMerge(
				defaultSettings as AppSettings,
				queued as unknown as Record<string, unknown>
			);
		}

		const record = await localDB.getRecord<SettingsRecord>('settings', userId);

		if (!record || record.isDeleted) {
			return { ...defaultSettings };
		}

		try {
			const dec = await decrypt(masterKey, {
				ciphertext: record.encryptedData,
				iv: record.encryptedDataIV
			});
			return deepMerge(defaultSettings as AppSettings, JSON.parse(dec));
		} catch (error) {
			throw new AppError('ENCRYPTION_FAILED', 'Failed to decrypt settings', error);
		}
	}

	static async set(settings: DeepPartial<AppSettings>): Promise<void> {
		const { userId } = getActiveSession();

		try {
			const existing = await localDB.getRecord<SettingsRecord>('settings', userId);
			encryptedWriteQueue.upsert<AppSettings, SettingsRecord>({
				tableName: 'settings',
				id: userId,
				userId,
				createdAt: existing?.createdAt ?? Date.now(),
				nextFields: deepMerge(
					defaultSettings as AppSettings,
					settings as unknown as Record<string, unknown>
				),
				mergeFields: (_current, next) => next,
				toRecord: ({
					id,
					userId: recordUserId,
					createdAt,
					updatedAt,
					encryptedData,
					encryptedDataIV
				}) => ({
					id,
					userId: recordUserId,
					createdAt,
					updatedAt,
					isDeleted: false,
					encryptedData,
					encryptedDataIV
				})
			});
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to save settings', error);
		}
	}

	/** Partial update ??read-modify-write with merge */
	static async update(changes: DeepPartial<AppSettings>): Promise<AppSettings> {
		const { masterKey, userId } = getActiveSession();

		try {
			const queued = encryptedWriteQueue.peek<AppSettings>('settings', userId);
			const record = queued ? null : await localDB.getRecord<SettingsRecord>('settings', userId);

			const current: AppSettings = queued
				? deepMerge(defaultSettings as AppSettings, queued as unknown as Record<string, unknown>)
				: !record || record.isDeleted
					? ({ ...defaultSettings } as AppSettings)
					: deepMerge(
							defaultSettings as AppSettings,
							JSON.parse(
								await decrypt(masterKey, {
									ciphertext: record.encryptedData,
									iv: record.encryptedDataIV
								})
							)
						);

			const updated: AppSettings = deepMerge(current, changes as Record<string, unknown>);

			encryptedWriteQueue.upsert<AppSettings, SettingsRecord>({
				tableName: 'settings',
				id: userId,
				userId,
				createdAt: record?.createdAt ?? Date.now(),
				nextFields: updated,
				mergeFields: (queuedCurrent, next) =>
					deepMerge(queuedCurrent, next as unknown as Record<string, unknown>),
				toRecord: ({
					id,
					userId: recordUserId,
					createdAt,
					updatedAt,
					encryptedData,
					encryptedDataIV
				}) => ({
					id,
					userId: recordUserId,
					createdAt,
					updatedAt,
					isDeleted: false,
					encryptedData,
					encryptedDataIV
				})
			});

			return updated;
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to update settings', error);
		}
	}
}
