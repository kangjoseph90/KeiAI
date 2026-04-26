import { getActiveSession } from '../session';
import { localDB, type SettingsRecord } from '$lib/adapters/db';
import type { OrderedRef, FolderDef, ResourceRef } from '$lib/types/refs';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { writeQueue } from './write_queue';
import { clock } from '$lib/utils/clock';
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
    MiniLMProviderConfig,
    StabilityProviderConfig,
    GroqProviderConfig,
    CohereProviderConfig,
    JinaProviderConfig
} from '$lib/types/models/provider';
import type { EmbeddingProvider } from '$lib/types/models/embedding';
import type { TTSProvider } from '$lib/types/models/tts';
import type { ImageGenProvider } from '$lib/types/models/imagegen';
import type { STTProvider } from '$lib/types/models/stt';
import type { RerankerProvider } from '$lib/types/models/reranker';

// ─── Domain Types ──────────────────────────────────────────────────────

export interface AppSettingsContent {
    theme: 'light' | 'dark' | 'system';
    chat: {
        /**
         * When true, rerolling a message preserves all previous swipes.
         * When false, the previous content is discarded (destructive reroll).
         */
        saveMessagesOnSwipe: boolean;
    };
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
    stability: StabilityProviderConfig;
    groq: GroqProviderConfig;
    cohere: CohereProviderConfig;
    jina: JinaProviderConfig;
    custom: CustomProviderConfig;
    embeddingProvider: EmbeddingProvider;
    ttsProvider: TTSProvider;
    imagegenProvider: ImageGenProvider;
    sttProvider: STTProvider;
    rerankerProvider: RerankerProvider;
}

export interface AppSettingsRefs {
    personaId?: string;
    presetId?: string;
    // 1:N - workspace holds ordered refs for top-level entities
    characterRefs?: OrderedRef[];
    personaRefs?: OrderedRef[];
    presetRefs?: OrderedRef[];
    moduleRefs?: ResourceRef[];
    pluginRefs?: OrderedRef[];
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
    chat: {
        saveMessagesOnSwipe: true
    },
    openai: {
        tts: {
            modelId: 'tts-1',
            voiceId: 'alloy'
        },
        embedding: {
            modelId: 'text-embedding-3-small'
        },
        imagegen: {
            modelId: 'gpt-image-1'
        },
        stt: {
            modelId: 'whisper-1'
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
        },
        imagegen: {
            modelId: 'imagen-3.0-generate-002'
        },
        stt: {
            modelId: 'latest_long'
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
        },
        reranker: {
            modelId: 'rerank-2'
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
        },
        stt: {
            modelId: 'onnx-community/whisper-tiny'
        },
        reranker: {
            modelId: 'Xenova/bge-reranker-base'
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
    stability: {
        apiKey: '',
        imagegen: {
            modelId: 'stable-diffusion-3.5-large'
        }
    },
    groq: {
        apiKey: '',
        stt: {
            modelId: 'whisper-large-v3'
        }
    },
    cohere: {
        apiKey: '',
        reranker: {
            modelId: 'rerank-v3.5'
        }
    },
    jina: {
        apiKey: '',
        reranker: {
            modelId: 'jina-reranker-v2-base-multilingual'
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
    ttsProvider: 'openai',
    imagegenProvider: 'openai',
    sttProvider: 'openai',
    rerankerProvider: 'cohere'
};

// ─── Service ──────────────────────────────────────────────────────────

function parseFields(data: Record<string, unknown>): AppSettings {
    return deepMerge(defaultSettings as AppSettings, data as DeepPartial<AppSettings>);
}

export class SettingsService {
    static async get(): Promise<AppSettings> {
        const { userId } = getActiveSession();
        const queued = writeQueue.peek<AppSettings>('settings', userId);
        if (queued) {
            return deepMerge(defaultSettings as AppSettings, queued);
        }

        const record = await localDB.getRecord<SettingsRecord>('settings', userId);

        if (!record || record.isDeleted) {
            return { ...defaultSettings };
        }

        return parseFields(record.data);
    }

    static async set(settings: DeepPartial<AppSettings>): Promise<void> {
        const { userId } = getActiveSession();

        try {
            const existing = await localDB.getRecord<SettingsRecord>('settings', userId);
            writeQueue.upsert<AppSettings, SettingsRecord>({
                tableName: 'settings',
                id: userId,
                userId,
                createdAt: existing?.createdAt ?? clock.now(),
                nextFields: deepMerge(defaultSettings as AppSettings, settings),
                mergeFields: (_current, next) => next,
                toRecord: ({ id, userId: recordUserId, createdAt, updatedAt, data }) => ({
                    id,
                    userId: recordUserId,
                    createdAt,
                    updatedAt,
                    isDeleted: false,
                    data
                })
            });
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to save settings', error);
        }
    }

    /** Partial update – read-modify-write with merge */
    static async update(changes: DeepPartial<AppSettings>): Promise<AppSettings> {
        const { userId } = getActiveSession();

        try {
            const queued = writeQueue.peek<AppSettings>('settings', userId);
            const record = await localDB.getRecord<SettingsRecord>('settings', userId);

            const current: AppSettings = queued
                ? deepMerge(defaultSettings as AppSettings, queued)
                : !record || record.isDeleted
                  ? ({ ...defaultSettings } as AppSettings)
                  : parseFields(record.data);

            const updated: AppSettings = deepMerge(current, changes);

            writeQueue.upsert<AppSettings, SettingsRecord>({
                tableName: 'settings',
                id: userId,
                userId,
                createdAt: record?.createdAt ?? clock.now(),
                nextFields: updated,
                mergeFields: (queuedCurrent, next) => deepMerge(queuedCurrent, next),
                toRecord: ({ id, userId: recordUserId, createdAt, updatedAt, data }) => ({
                    id,
                    userId: recordUserId,
                    createdAt,
                    updatedAt,
                    isDeleted: false,
                    data
                })
            });

            return updated;
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to update settings', error);
        }
    }
}
