import { getActiveSession, getSessionScope } from '../session';
import type { SettingsRecord } from '$lib/adapters/db';
import type { ResourceRef, EntityListConfig } from '$lib/types/refs';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { buffer } from './record_buffer';
import { clock } from '$lib/utils/clock';
import type { CustomLLMModel } from '$lib/types/models/llm';
import { generateId } from '$lib/utils/id';
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
    presetId?: string;
    rooms: EntityListConfig;
    multiRooms: EntityListConfig;
    characters: EntityListConfig;
    personas: EntityListConfig;
    presets: EntityListConfig;
    modules: EntityListConfig<ResourceRef>;
    plugins: EntityListConfig;
}

export interface AppSettings extends AppSettingsContent, AppSettingsRefs {}

export const defaultSettings: AppSettings = {
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
            models: {}
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
    rerankerProvider: 'cohere',
    rooms: { refs: {}, folders: {} },
    multiRooms: { refs: {}, folders: {} },
    characters: { refs: {}, folders: {} },
    personas: { refs: {}, folders: {} },
    presets: { refs: {}, folders: {} },
    modules: { refs: {}, folders: {} },
    plugins: { refs: {}, folders: {} }
};

// ─── Service ──────────────────────────────────────────────────────────

function parseFields(data: Record<string, unknown>): AppSettings {
    return deepMerge(defaultSettings, data as DeepPartial<AppSettings>);
}

export class SettingsService {
    static async get(): Promise<AppSettings> {
        const { userId } = getActiveSession();
        const record = await buffer.get<SettingsRecord>('settings', userId);

        if (!record || record.isDeleted) {
            return { ...defaultSettings };
        }

        return parseFields(record.data);
    }

    /** Partial update – read-modify-write with merge */
    static async update(changes: DeepPartial<AppSettings>): Promise<AppSettings> {
        const { userId } = getActiveSession();
        const scope = getSessionScope('user');

        try {
            const record = await buffer.get<SettingsRecord>('settings', userId);

            const current: AppSettings =
                !record || record.isDeleted ? { ...defaultSettings } : parseFields(record.data);

            const updated: AppSettings = deepMerge(current, changes);

            buffer.update<SettingsRecord>({
                tableName: 'settings',
                record: {
                    id: userId,
                    scopeType: scope.scopeType,
                    scopeId: scope.scopeId,
                    createdAt: record?.createdAt ?? clock.now(),
                    updatedAt: clock.now(),
                    isDeleted: false,
                    data: updated as unknown as Record<string, unknown>
                },
                patch: changes as unknown as Record<string, unknown>
            });

            return updated;
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('DB_WRITE_FAILED', 'Failed to update settings', error);
        }
    }

    static async createCustomLLMModel(
        fields: DeepPartial<CustomLLMModel> & { sortOrder: string }
    ): Promise<{ modelId: string; settings: AppSettings }> {
        const modelId = `custom::${generateId()}`;
        const settings = await this.update({
            custom: {
                llm: {
                    models: {
                        [modelId]: {
                            ...fields,
                            id: modelId,
                            provider: 'custom'
                        }
                    }
                }
            }
        });

        return { modelId, settings };
    }

    static async updateCustomLLMModel(
        modelId: string,
        changes: DeepPartial<CustomLLMModel & { sortOrder: string }>
    ): Promise<AppSettings> {
        return this.update({
            custom: {
                llm: {
                    models: {
                        [modelId]: {
                            ...changes,
                            id: modelId,
                            provider: 'custom'
                        }
                    }
                }
            }
        });
    }

    static async deleteCustomLLMModel(modelId: string): Promise<AppSettings> {
        return this.update({
            custom: {
                llm: {
                    models: {
                        [modelId]: undefined
                    }
                }
            }
        });
    }
}
