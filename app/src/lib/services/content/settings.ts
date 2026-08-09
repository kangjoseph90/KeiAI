import { getActiveSession, getSessionScope } from '../session';
import type { SettingsRecord } from '$lib/adapters/db';
import type { ResourceRef, EntityListConfig } from '$lib/types/refs';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { buffer } from './record_buffer';
import { clock } from '$lib/utils/clock';
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
    JinaProviderConfig,
    ComfyUIProviderConfig,
    MockProviderConfig,
    PluginProviderConfig
} from '$lib/types/models/provider';
import type { EmbeddingProvider } from '$lib/types/models/embedding';
import type { TTSProvider } from '$lib/types/models/tts';
import type { ImageGenProvider } from '$lib/types/models/imagegen';
import type { STTProvider } from '$lib/types/models/stt';
import type { RerankerProvider } from '$lib/types/models/reranker';
import type { WorkflowDefinition } from '$lib/workflow/types';
import { normalizeWorkflow } from '$lib/workflow/normalization';
import type { LanguageCode } from '$lib/language';
import { defaultFileFields, hydrateOwnedItems, type FileItem } from './resource';

// ─── Domain Types ──────────────────────────────────────────────────────

export interface AppSettingsContent {
    theme: 'light' | 'dark' | 'system';
    chat: {
        saveMessagesOnSwipe: boolean;
        expandStepsOnGeneration: boolean;
        autoGenerateResponse: boolean;
    };
    translation: {
        targetLanguage: LanguageCode;
        bidirectional: boolean;
        secondaryLanguage: LanguageCode;
        workflow: WorkflowDefinition;
        autoShowTranslation: boolean;
    };
    imageGeneration: {
        workflow: WorkflowDefinition;
    };
    tts: {
        workflow: WorkflowDefinition;
    };
    suggestion: {
        workflow: WorkflowDefinition;
    };
    titleGeneration: {
        workflow: WorkflowDefinition;
    };
    openai: OpenAIProviderConfig;
    anthropic: AnthropicProviderConfig;
    google: GoogleProviderConfig;
    mistral: MistralProviderConfig;
    deepseek: DeepSeekProviderConfig;
    novelai: NovelAIProviderConfig;
    comfyui: ComfyUIProviderConfig;
    voyageai: VoyageAIProviderConfig;
    openrouter: OpenRouterProviderConfig;
    transformers: TransformersProviderConfig;
    elevenlabs: ElevenLabsProviderConfig;
    kokoro: KokoroProviderConfig;
    mock: MockProviderConfig;
    minilm: MiniLMProviderConfig;
    stability: StabilityProviderConfig;
    groq: GroqProviderConfig;
    cohere: CohereProviderConfig;
    jina: JinaProviderConfig;
    custom: CustomProviderConfig;
    plugin: PluginProviderConfig;
    embeddingProvider: EmbeddingProvider;
    ttsProvider: TTSProvider;
    imagegenProvider: ImageGenProvider;
    sttProvider: STTProvider;
    rerankerProvider: RerankerProvider;
    files: EntityListConfig<FileItem>;
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
        saveMessagesOnSwipe: true,
        expandStepsOnGeneration: false,
        autoGenerateResponse: true
    },
    translation: {
        targetLanguage: 'ko',
        bidirectional: false,
        secondaryLanguage: 'en',
        workflow: { nodes: {} },
        autoShowTranslation: false
    },
    imageGeneration: {
        workflow: { nodes: {} }
    },
    tts: {
        workflow: { nodes: {} }
    },
    suggestion: {
        workflow: { nodes: {} }
    },
    titleGeneration: {
        workflow: { nodes: {} }
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
            modelId: 'gpt-image-2'
        },
        stt: {
            modelId: 'whisper-1'
        }
    },
    anthropic: {},
    google: {
        apiKey: '',
        tts: {
            modelId: 'gemini-3.1-flash-tts-preview',
            voiceId: 'Zephyr'
        },
        embedding: {
            modelId: 'gemini-embedding-2-preview'
        },
        imagegen: {
            modelId: 'gemini-3.1-flash-image'
        },
        stt: {
            modelId: 'latest_long',
            languageCode: 'en-US'
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
        },
        imagegen: {
            modelId: 'nai-diffusion-4-5-full',
            width: 832,
            height: 1216,
            sampler: 'k_euler_ancestral',
            noiseSchedule: 'karras',
            steps: 28,
            scale: 6,
            cfgRescale: 0,
            vibeInformationExtracted: 1,
            vibeStrength: 0.7,
            referenceStrength: 1,
            referenceFidelity: 1
        }
    },
    comfyui: {
        imagegen: {
            baseUrl: 'http://127.0.0.1:8188',
            workflow: '',
            timeoutSeconds: 120
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
            modelId: 'Xenova/mms-tts-eng'
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
            modelId: 'eleven_multilingual_v2',
            voiceId: ''
        }
    },
    kokoro: {
        tts: {
            voiceId: 'af_heart'
        }
    },
    mock: {
        imagegen: {
            modelId: 'sample'
        },
        tts: {
            modelId: 'sample'
        },
        stt: {
            modelId: 'sample'
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
    plugin: {
        imagegen: {
            modelId: ''
        },
        tts: {
            modelId: ''
        },
        stt: {
            modelId: ''
        },
        embedding: {
            modelId: ''
        },
        reranker: {
            modelId: ''
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
    plugins: { refs: {}, folders: {} },
    files: { refs: {}, folders: {} }
};

// ─── Service ──────────────────────────────────────────────────────────

function parseFields(data: Record<string, unknown>): AppSettings {
    const fields = deepMerge(defaultSettings, data as DeepPartial<AppSettings>);
    fields.translation.workflow = normalizeWorkflow(fields.translation.workflow);
    fields.imageGeneration.workflow = normalizeWorkflow(fields.imageGeneration.workflow);
    fields.tts.workflow = normalizeWorkflow(fields.tts.workflow);
    fields.suggestion.workflow = normalizeWorkflow(fields.suggestion.workflow);
    fields.titleGeneration.workflow = normalizeWorkflow(fields.titleGeneration.workflow);
    fields.files.refs = hydrateOwnedItems(fields.files.refs, defaultFileFields);
    return fields;
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
}
