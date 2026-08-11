<script lang="ts">
    import { Eye, EyeOff } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import { ScrollArea } from '$lib/components/ui/scroll-area';
    import { Textarea } from '$lib/components/ui/textarea';
    import OptionSelect from '$lib/components/OptionSelect.svelte';
    import SuggestedInput from '$lib/components/SuggestedInput.svelte';
    import { appSettings, updateSettings } from '$lib/stores';
    import type { AppSettings } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';
    import {
        EMBEDDING_MODEL_IDS,
        getEmbeddingProviderName,
        type EmbeddingProvider,
        type PluginEmbeddingModel
    } from '$lib/types/models/embedding';
    import {
        IMAGEGEN_MODEL_IDS,
        getImageGenProviderName,
        type ImageGenProvider,
        type PluginImageGenModel
    } from '$lib/types/models/imagegen';
    import {
        RERANKER_MODEL_IDS,
        getRerankerProviderName,
        type PluginRerankerModel,
        type RerankerProvider
    } from '$lib/types/models/reranker';
    import {
        STT_MODEL_IDS,
        getSTTProviderName,
        type PluginSTTModel,
        type STTProvider
    } from '$lib/types/models/stt';
    import {
        TTS_MODEL_IDS,
        getTTSProviderName,
        KOKORO_VOICE_IDS,
        type PluginTTSModel,
        type TTSProvider
    } from '$lib/types/models/tts';
    import { getErrorMessage } from '$lib/types/errors';
    import { toast } from '$lib/ui';
    import type { WorkflowPatch } from '$lib/workflow';
    import WorkflowEditorModal from '$lib/views/workflow/WorkflowEditorModal.svelte';
    import WorkflowSummaryCard from '$lib/views/workflow/WorkflowSummaryCard.svelte';
    import { pluginManager } from '$lib/plugins';
    import {
        listOpenRouterModels,
        type OpenRouterModelCapability,
        type OpenRouterModelOption
    } from '$lib/openrouter/models';

    type Feature = 'imagegen' | 'tts' | 'stt' | 'embedding' | 'reranker';
    type ServiceGroup = 'image' | 'audio' | 'retrieval';
    type WorkflowFeature = Extract<Feature, 'imagegen' | 'tts'>;
    type PluginModel =
        | PluginImageGenModel
        | PluginTTSModel
        | PluginSTTModel
        | PluginEmbeddingModel
        | PluginRerankerModel;
    type ServiceProvider =
        | ImageGenProvider
        | TTSProvider
        | STTProvider
        | EmbeddingProvider
        | RerankerProvider;
    type ProviderSettingsKey =
        | 'openai'
        | 'google'
        | 'stability'
        | 'elevenlabs'
        | 'novelai'
        | 'comfyui'
        | 'kokoro'
        | 'transformers'
        | 'groq'
        | 'voyageai'
        | 'openrouter'
        | 'minilm'
        | 'custom'
        | 'cohere'
        | 'jina'
        | 'mock';

    interface SettingsField {
        id: string;
        label: string;
        value: string;
        placeholder: string;
        secret?: boolean;
        multiline?: boolean;
        help?: string;
        options?: readonly string[];
        suggestions?: readonly string[];
        number?: {
            min?: number;
            max?: number;
            step?: number;
        };
        path: [ProviderSettingsKey, string] | [ProviderSettingsKey, string, string];
    }

    const FEATURES: Array<{ id: Feature; label: string; description: string }> = [
        {
            id: 'imagegen',
            label: 'Image Generation',
            description: 'Generate and edit images in workflows.'
        },
        { id: 'tts', label: 'TTS', description: 'Turn text into spoken audio.' },
        { id: 'stt', label: 'STT', description: 'Transcribe spoken audio into text.' },
        {
            id: 'embedding',
            label: 'Embedding',
            description: 'Create vector representations for semantic retrieval.'
        },
        {
            id: 'reranker',
            label: 'Reranker',
            description: 'Reorder retrieved results by relevance.'
        }
    ];

    const SERVICE_GROUPS: Array<{
        id: ServiceGroup;
        label: string;
        features: readonly Feature[];
        workflow?: WorkflowFeature;
    }> = [
        { id: 'image', label: 'Image', features: ['imagegen'], workflow: 'imagegen' },
        { id: 'audio', label: 'Audio', features: ['tts', 'stt'], workflow: 'tts' },
        { id: 'retrieval', label: 'Retrieval', features: ['embedding', 'reranker'] }
    ];

    const IMAGEGEN_PROVIDERS: ImageGenProvider[] = [
        'openai',
        'google',
        'novelai',
        'stability',
        'openrouter',
        'comfyui',
        'mock',
        'plugin'
    ];
    const TTS_PROVIDERS: TTSProvider[] = [
        'openai',
        'google',
        'elevenlabs',
        'novelai',
        'openrouter',
        'kokoro',
        'transformers',
        'mock',
        'plugin'
    ];
    const STT_PROVIDERS: STTProvider[] = [
        'openai',
        'google',
        'groq',
        'openrouter',
        'transformers',
        'mock',
        'plugin'
    ];
    const EMBEDDING_PROVIDERS: EmbeddingProvider[] = [
        'openai',
        'google',
        'voyageai',
        'openrouter',
        'minilm',
        'transformers',
        'custom',
        'plugin'
    ];
    const RERANKER_PROVIDERS: RerankerProvider[] = [
        'cohere',
        'jina',
        'voyageai',
        'openrouter',
        'transformers',
        'plugin'
    ];
    let activeGroup = $state<ServiceGroup>('image');
    let showSecrets = $state(false);
    let saving = $state(false);
    let workflowEditorOpen = $state(false);
    let workflowEditorFeature = $state<WorkflowFeature>('imagegen');
    let openRouterModels = $state<Partial<Record<Feature, OpenRouterModelOption[]>>>({});
    let loadedOpenRouterApiKeys = $state<Partial<Record<Feature, string>>>({});

    const OPENROUTER_CAPABILITIES: Record<Feature, OpenRouterModelCapability> = {
        imagegen: 'image',
        tts: 'tts',
        stt: 'stt',
        embedding: 'embedding',
        reranker: 'reranker'
    };

    const serviceGroup = $derived(
        SERVICE_GROUPS.find((item) => item.id === activeGroup) ?? SERVICE_GROUPS[0]
    );
    const editedWorkflow = $derived(
        workflowEditorFeature === 'imagegen'
            ? $appSettings?.imageGeneration.workflow
            : $appSettings?.tts.workflow
    );

    $effect(() => {
        const settings = $appSettings;
        if (!settings) return;

        for (const feature of serviceGroup.features) {
            if (getActiveProvider(settings, feature) !== 'openrouter') continue;

            const apiKey = settings.openrouter.apiKey?.trim() ?? '';
            if (!apiKey || loadedOpenRouterApiKeys[feature] === apiKey) continue;

            loadedOpenRouterApiKeys[feature] = apiKey;
            void listOpenRouterModels(OPENROUTER_CAPABILITIES[feature], { apiKey })
                .then((models) => {
                    openRouterModels[feature] = models;
                })
                .catch((error: unknown) => {
                    toast.error({
                        title: 'OpenRouter model list failed',
                        description: getErrorMessage(error)
                    });
                });
        }
    });

    function getActiveProvider(
        settings: AppSettings | null,
        selectedFeature: Feature
    ): ServiceProvider {
        if (!settings) {
            switch (selectedFeature) {
                case 'imagegen':
                case 'tts':
                case 'stt':
                case 'embedding':
                    return 'openai';
                case 'reranker':
                    return 'cohere';
            }
        }

        switch (selectedFeature) {
            case 'imagegen':
                return settings.imagegenProvider;
            case 'tts':
                return settings.ttsProvider;
            case 'stt':
                return settings.sttProvider;
            case 'embedding':
                return settings.embeddingProvider;
            case 'reranker':
                return settings.rerankerProvider;
        }
    }

    function getProviders(selectedFeature: Feature): ServiceProvider[] {
        switch (selectedFeature) {
            case 'imagegen':
                return IMAGEGEN_PROVIDERS;
            case 'tts':
                return TTS_PROVIDERS;
            case 'stt':
                return STT_PROVIDERS;
            case 'embedding':
                return EMBEDDING_PROVIDERS;
            case 'reranker':
                return RERANKER_PROVIDERS;
        }
    }

    function getProviderName(selectedFeature: Feature, provider: ServiceProvider): string {
        switch (selectedFeature) {
            case 'imagegen':
                return getImageGenProviderName(provider as ImageGenProvider);
            case 'tts':
                return getTTSProviderName(provider as TTSProvider);
            case 'stt':
                return getSTTProviderName(provider as STTProvider);
            case 'embedding':
                return getEmbeddingProviderName(provider as EmbeddingProvider);
            case 'reranker':
                return getRerankerProviderName(provider as RerankerProvider);
        }
    }

    function getPluginModels(selectedFeature: Feature): PluginModel[] {
        return pluginManager.getInstances().flatMap((instance) => {
            switch (selectedFeature) {
                case 'imagegen':
                    return [...instance.imageGenProviders.values()].map(
                        (provider) => provider.model
                    );
                case 'tts':
                    return [...instance.ttsProviders.values()].map((provider) => provider.model);
                case 'stt':
                    return [...instance.sttProviders.values()].map((provider) => provider.model);
                case 'embedding':
                    return [...instance.embeddingProviders.values()].map(
                        (provider) => provider.model
                    );
                case 'reranker':
                    return [...instance.rerankerProviders.values()].map(
                        (provider) => provider.model
                    );
            }
        });
    }

    function apiKeyField(settings: AppSettings, provider: ProviderSettingsKey): SettingsField {
        const config = settings[provider];
        const value =
            typeof config === 'object' && config && 'apiKey' in config
                ? String(config.apiKey ?? '')
                : '';
        return {
            id: `${provider}-api-key`,
            label: 'API Key',
            value,
            placeholder: `Enter ${provider} API key`,
            secret: true,
            path: [provider, 'apiKey']
        };
    }

    function getRecommendedModelIds(
        provider: ProviderSettingsKey,
        feature: Feature
    ): readonly string[] | undefined {
        if (provider === 'openrouter') {
            return openRouterModels[feature]?.map((model) => model.id) ?? [];
        }

        switch (feature) {
            case 'imagegen':
                return IMAGEGEN_MODEL_IDS[provider as keyof typeof IMAGEGEN_MODEL_IDS];
            case 'tts':
                return TTS_MODEL_IDS[provider as keyof typeof TTS_MODEL_IDS];
            case 'stt':
                return STT_MODEL_IDS[provider as keyof typeof STT_MODEL_IDS];
            case 'embedding':
                return EMBEDDING_MODEL_IDS[provider as keyof typeof EMBEDDING_MODEL_IDS];
            case 'reranker':
                return RERANKER_MODEL_IDS[provider as keyof typeof RERANKER_MODEL_IDS];
        }
    }

    function configField(
        provider: ProviderSettingsKey,
        section: string,
        key: string,
        label: string,
        value: string,
        placeholder: string
    ): SettingsField {
        const suggestions =
            key === 'modelId' ? getRecommendedModelIds(provider, section as Feature) : undefined;
        return {
            id: `${provider}-${section}-${key}`,
            label,
            value,
            placeholder,
            suggestions,
            path: [provider, section, key]
        };
    }

    function numberConfigField(
        provider: ProviderSettingsKey,
        section: string,
        key: string,
        label: string,
        value: number,
        number: SettingsField['number']
    ): SettingsField {
        return {
            ...configField(provider, section, key, label, String(value), ''),
            number
        };
    }

    function getSettingsFields(
        settings: AppSettings | null,
        selectedFeature: Feature
    ): SettingsField[] {
        if (!settings) return [];

        switch (selectedFeature) {
            case 'imagegen': {
                switch (settings.imagegenProvider) {
                    case 'openai':
                        return [
                            apiKeyField(settings, 'openai'),
                            configField(
                                'openai',
                                'imagegen',
                                'modelId',
                                'Model',
                                settings.openai.imagegen.modelId,
                                'gpt-image-2'
                            )
                        ];
                    case 'openrouter':
                        return [
                            apiKeyField(settings, 'openrouter'),
                            configField(
                                'openrouter',
                                'imagegen',
                                'modelId',
                                'Model',
                                settings.openrouter.imagegen.modelId,
                                'openai/gpt-image-2'
                            )
                        ];
                    case 'google':
                        return [
                            apiKeyField(settings, 'google'),
                            configField(
                                'google',
                                'imagegen',
                                'modelId',
                                'Model',
                                settings.google.imagegen.modelId,
                                'gemini-3-pro-image'
                            )
                        ];
                    case 'stability':
                        return [
                            apiKeyField(settings, 'stability'),
                            configField(
                                'stability',
                                'imagegen',
                                'modelId',
                                'Model',
                                settings.stability.imagegen.modelId,
                                'ultra'
                            )
                        ];
                    case 'novelai':
                        return [
                            apiKeyField(settings, 'novelai'),
                            configField(
                                'novelai',
                                'imagegen',
                                'modelId',
                                'Model',
                                settings.novelai.imagegen.modelId,
                                'nai-diffusion-4-5-full'
                            ),
                            numberConfigField(
                                'novelai',
                                'imagegen',
                                'width',
                                'Width',
                                settings.novelai.imagegen.width,
                                { min: 64, max: 4096, step: 64 }
                            ),
                            numberConfigField(
                                'novelai',
                                'imagegen',
                                'height',
                                'Height',
                                settings.novelai.imagegen.height,
                                { min: 64, max: 4096, step: 64 }
                            ),
                            configField(
                                'novelai',
                                'imagegen',
                                'sampler',
                                'Sampler',
                                settings.novelai.imagegen.sampler,
                                'k_euler_ancestral'
                            ),
                            configField(
                                'novelai',
                                'imagegen',
                                'noiseSchedule',
                                'Noise Schedule',
                                settings.novelai.imagegen.noiseSchedule,
                                'karras'
                            ),
                            numberConfigField(
                                'novelai',
                                'imagegen',
                                'steps',
                                'Steps',
                                settings.novelai.imagegen.steps,
                                { min: 1, max: 50, step: 1 }
                            ),
                            numberConfigField(
                                'novelai',
                                'imagegen',
                                'scale',
                                'Prompt Guidance',
                                settings.novelai.imagegen.scale,
                                { min: 0, max: 10, step: 0.1 }
                            ),
                            numberConfigField(
                                'novelai',
                                'imagegen',
                                'cfgRescale',
                                'CFG Rescale',
                                settings.novelai.imagegen.cfgRescale,
                                { min: 0, max: 1, step: 0.05 }
                            ),
                            numberConfigField(
                                'novelai',
                                'imagegen',
                                'vibeInformationExtracted',
                                'Vibe Information Extracted',
                                settings.novelai.imagegen.vibeInformationExtracted,
                                { min: 0, max: 1, step: 0.05 }
                            ),
                            numberConfigField(
                                'novelai',
                                'imagegen',
                                'vibeStrength',
                                'Vibe Strength',
                                settings.novelai.imagegen.vibeStrength,
                                { min: 0, max: 1, step: 0.05 }
                            ),
                            numberConfigField(
                                'novelai',
                                'imagegen',
                                'referenceStrength',
                                'Reference Strength',
                                settings.novelai.imagegen.referenceStrength,
                                { min: 0, max: 1, step: 0.05 }
                            ),
                            numberConfigField(
                                'novelai',
                                'imagegen',
                                'referenceFidelity',
                                'Reference Fidelity',
                                settings.novelai.imagegen.referenceFidelity,
                                { min: 0, max: 1, step: 0.05 }
                            )
                        ];
                    case 'comfyui':
                        return [
                            {
                                ...configField(
                                    'comfyui',
                                    'imagegen',
                                    'baseUrl',
                                    'Server URL',
                                    settings.comfyui.imagegen.baseUrl,
                                    'http://127.0.0.1:8188'
                                ),
                                help: 'The browser build requires ComfyUI to allow CORS. The desktop build connects directly.'
                            },
                            {
                                ...configField(
                                    'comfyui',
                                    'imagegen',
                                    'workflow',
                                    'API Workflow',
                                    settings.comfyui.imagegen.workflow,
                                    'Paste a ComfyUI workflow exported with Save (API Format)'
                                ),
                                multiline: true,
                                help: 'Use {{prompt}}, {{negative_prompt}}, {{reference_image}}, {{reference_image_2}}, {{style_image}}, and {{style_image_2}} in string inputs.'
                            },
                            numberConfigField(
                                'comfyui',
                                'imagegen',
                                'timeoutSeconds',
                                'Timeout (seconds)',
                                settings.comfyui.imagegen.timeoutSeconds,
                                { min: 1, max: 3600, step: 1 }
                            )
                        ];
                    case 'mock':
                        return [
                            {
                                ...configField(
                                    'mock',
                                    'imagegen',
                                    'modelId',
                                    'Model',
                                    settings.mock.imagegen.modelId,
                                    'sample'
                                ),
                                options: IMAGEGEN_MODEL_IDS.mock
                            }
                        ];
                    case 'plugin':
                        return [];
                }
                return [];
            }
            case 'tts': {
                switch (settings.ttsProvider) {
                    case 'openai':
                        return [
                            apiKeyField(settings, 'openai'),
                            configField(
                                'openai',
                                'tts',
                                'modelId',
                                'Model',
                                settings.openai.tts.modelId,
                                'gpt-4o-mini-tts'
                            ),
                            configField(
                                'openai',
                                'tts',
                                'voiceId',
                                'Voice',
                                settings.openai.tts.voiceId,
                                'alloy'
                            )
                        ];
                    case 'openrouter':
                        return [
                            apiKeyField(settings, 'openrouter'),
                            configField(
                                'openrouter',
                                'tts',
                                'modelId',
                                'Model',
                                settings.openrouter.tts.modelId,
                                'google/gemini-3.1-flash-tts-preview'
                            ),
                            configField(
                                'openrouter',
                                'tts',
                                'voiceId',
                                'Voice',
                                settings.openrouter.tts.voiceId,
                                'alloy'
                            )
                        ];
                    case 'google':
                        return [
                            apiKeyField(settings, 'google'),
                            configField(
                                'google',
                                'tts',
                                'modelId',
                                'Model',
                                settings.google.tts.modelId,
                                'gemini-3.1-flash-tts-preview'
                            ),
                            configField(
                                'google',
                                'tts',
                                'voiceId',
                                'Voice',
                                settings.google.tts.voiceId,
                                'Zephyr'
                            )
                        ];
                    case 'elevenlabs':
                        return [
                            apiKeyField(settings, 'elevenlabs'),
                            configField(
                                'elevenlabs',
                                'tts',
                                'modelId',
                                'Model',
                                settings.elevenlabs.tts.modelId,
                                'eleven_v3'
                            ),
                            configField(
                                'elevenlabs',
                                'tts',
                                'voiceId',
                                'Voice ID',
                                settings.elevenlabs.tts.voiceId,
                                'Voice ID'
                            )
                        ];
                    case 'novelai':
                        return [
                            apiKeyField(settings, 'novelai'),
                            configField(
                                'novelai',
                                'tts',
                                'voiceId',
                                'Voice',
                                settings.novelai.tts.voiceId,
                                'aini'
                            ),
                            configField(
                                'novelai',
                                'tts',
                                'version',
                                'Version',
                                settings.novelai.tts.version,
                                'v2'
                            )
                        ];
                    case 'kokoro':
                        return [
                            {
                                ...configField(
                                    'kokoro',
                                    'tts',
                                    'voiceId',
                                    'Voice',
                                    settings.kokoro.tts.voiceId,
                                    'af_heart'
                                ),
                                options: KOKORO_VOICE_IDS
                            }
                        ];
                    case 'transformers':
                        return [
                            configField(
                                'transformers',
                                'tts',
                                'modelId',
                                'Model',
                                settings.transformers.tts.modelId,
                                'Xenova/mms-tts-eng'
                            )
                        ];
                    case 'mock':
                        return [
                            {
                                ...configField(
                                    'mock',
                                    'tts',
                                    'modelId',
                                    'Model',
                                    settings.mock.tts.modelId,
                                    'sample'
                                ),
                                options: TTS_MODEL_IDS.mock
                            }
                        ];
                    case 'plugin':
                        return [];
                }
                return [];
            }
            case 'stt': {
                switch (settings.sttProvider) {
                    case 'openai':
                        return [
                            apiKeyField(settings, 'openai'),
                            configField(
                                'openai',
                                'stt',
                                'modelId',
                                'Model',
                                settings.openai.stt.modelId,
                                'gpt-transcribe'
                            )
                        ];
                    case 'openrouter':
                        return [
                            apiKeyField(settings, 'openrouter'),
                            configField(
                                'openrouter',
                                'stt',
                                'modelId',
                                'Model',
                                settings.openrouter.stt.modelId,
                                'openai/gpt-4o-transcribe'
                            )
                        ];
                    case 'google':
                        return [
                            apiKeyField(settings, 'google'),
                            configField(
                                'google',
                                'stt',
                                'modelId',
                                'Model',
                                settings.google.stt.modelId,
                                'latest_long'
                            ),
                            configField(
                                'google',
                                'stt',
                                'languageCode',
                                'Language Code',
                                settings.google.stt.languageCode,
                                'en-US'
                            )
                        ];
                    case 'groq':
                        return [
                            apiKeyField(settings, 'groq'),
                            configField(
                                'groq',
                                'stt',
                                'modelId',
                                'Model',
                                settings.groq.stt.modelId,
                                'whisper-large-v3'
                            )
                        ];
                    case 'transformers':
                        return [
                            configField(
                                'transformers',
                                'stt',
                                'modelId',
                                'Model',
                                settings.transformers.stt.modelId,
                                'Model ID'
                            )
                        ];
                    case 'mock':
                        return [
                            {
                                ...configField(
                                    'mock',
                                    'stt',
                                    'modelId',
                                    'Model',
                                    settings.mock.stt.modelId,
                                    'sample'
                                ),
                                options: STT_MODEL_IDS.mock
                            }
                        ];
                    case 'plugin':
                        return [];
                }
                return [];
            }
            case 'embedding': {
                switch (settings.embeddingProvider) {
                    case 'openai':
                        return [
                            apiKeyField(settings, 'openai'),
                            configField(
                                'openai',
                                'embedding',
                                'modelId',
                                'Model',
                                settings.openai.embedding.modelId,
                                'text-embedding-3-large'
                            )
                        ];
                    case 'google':
                        return [
                            apiKeyField(settings, 'google'),
                            configField(
                                'google',
                                'embedding',
                                'modelId',
                                'Model',
                                settings.google.embedding.modelId,
                                'gemini-embedding-2'
                            )
                        ];
                    case 'voyageai':
                        return [
                            apiKeyField(settings, 'voyageai'),
                            configField(
                                'voyageai',
                                'embedding',
                                'modelId',
                                'Model',
                                settings.voyageai.embedding.modelId,
                                'voyage-4-large'
                            )
                        ];
                    case 'openrouter':
                        return [
                            apiKeyField(settings, 'openrouter'),
                            configField(
                                'openrouter',
                                'embedding',
                                'modelId',
                                'Model',
                                settings.openrouter.embedding.modelId,
                                'qwen/qwen3-embedding-8b'
                            )
                        ];
                    case 'minilm':
                        return [
                            configField(
                                'minilm',
                                'embedding',
                                'modelId',
                                'Model',
                                settings.minilm.embedding.modelId,
                                'Model ID'
                            )
                        ];
                    case 'transformers':
                        return [
                            configField(
                                'transformers',
                                'embedding',
                                'modelId',
                                'Model',
                                settings.transformers.embedding.modelId,
                                'Model ID'
                            )
                        ];
                    case 'custom':
                        return [
                            {
                                id: 'custom-embedding-api-key',
                                label: 'API Key',
                                value: settings.custom.embedding.apiKey ?? '',
                                placeholder: 'Optional API key',
                                secret: true,
                                path: ['custom', 'embedding', 'apiKey']
                            },
                            configField(
                                'custom',
                                'embedding',
                                'baseUrl',
                                'Base URL',
                                settings.custom.embedding.baseUrl,
                                'https://api.example.com/v1'
                            ),
                            configField(
                                'custom',
                                'embedding',
                                'modelId',
                                'Model',
                                settings.custom.embedding.modelId,
                                'Model ID'
                            )
                        ];
                    case 'plugin':
                        return [];
                }
                return [];
            }
            case 'reranker': {
                switch (settings.rerankerProvider) {
                    case 'cohere':
                        return [
                            apiKeyField(settings, 'cohere'),
                            configField(
                                'cohere',
                                'reranker',
                                'modelId',
                                'Model',
                                settings.cohere.reranker.modelId,
                                'rerank-v4.0-pro'
                            )
                        ];
                    case 'jina':
                        return [
                            apiKeyField(settings, 'jina'),
                            configField(
                                'jina',
                                'reranker',
                                'modelId',
                                'Model',
                                settings.jina.reranker.modelId,
                                'jina-reranker-v3'
                            )
                        ];
                    case 'voyageai':
                        return [
                            apiKeyField(settings, 'voyageai'),
                            configField(
                                'voyageai',
                                'reranker',
                                'modelId',
                                'Model',
                                settings.voyageai.reranker.modelId,
                                'rerank-2.5'
                            )
                        ];
                    case 'openrouter':
                        return [
                            apiKeyField(settings, 'openrouter'),
                            configField(
                                'openrouter',
                                'reranker',
                                'modelId',
                                'Model',
                                settings.openrouter.reranker.modelId,
                                'cohere/rerank-4-pro'
                            )
                        ];
                    case 'transformers':
                        return [
                            configField(
                                'transformers',
                                'reranker',
                                'modelId',
                                'Model',
                                settings.transformers.reranker.modelId,
                                'Model ID'
                            )
                        ];
                    case 'plugin':
                        return [];
                }
                return [];
            }
        }
    }

    async function save(changes: DeepPartial<AppSettings>): Promise<void> {
        if (saving) return;
        saving = true;
        try {
            await updateSettings(changes);
        } catch (error) {
            toast.error({
                title: 'Setting update failed',
                description: getErrorMessage(error)
            });
        } finally {
            saving = false;
        }
    }

    function updateActiveProvider(feature: Feature, provider: ServiceProvider): void {
        const key = `${feature}Provider` as
            | 'imagegenProvider'
            | 'ttsProvider'
            | 'sttProvider'
            | 'embeddingProvider'
            | 'rerankerProvider';
        if (provider !== 'plugin') {
            void save({ [key]: provider } as DeepPartial<AppSettings>);
            return;
        }

        const models = getPluginModels(feature);
        const currentModelId = $appSettings?.plugin[feature].modelId ?? '';
        const modelId = models.some((model) => model.id === currentModelId)
            ? currentModelId
            : (models[0]?.id ?? '');
        void save({
            [key]: provider,
            plugin: { [feature]: { modelId } }
        } as DeepPartial<AppSettings>);
    }

    function updatePluginModel(feature: Feature, modelId: string): void {
        void save({ plugin: { [feature]: { modelId } } } as DeepPartial<AppSettings>);
    }

    function updateField(field: SettingsField, value: string): void {
        const [provider, section, key] = field.path;
        const fieldValue = field.number ? Number(value) : value.trim();
        if (field.number && !Number.isFinite(fieldValue)) return;
        const providerPatch =
            key === undefined ? { [section]: fieldValue } : { [section]: { [key]: fieldValue } };
        void save({ [provider]: providerPatch } as DeepPartial<AppSettings>);
    }

    function updateWorkflow(feature: WorkflowFeature, patch: WorkflowPatch): Promise<void> {
        return feature === 'imagegen'
            ? save({ imageGeneration: { workflow: patch } })
            : save({ tts: { workflow: patch } });
    }

    function editWorkflow(feature: WorkflowFeature): void {
        workflowEditorFeature = feature;
        workflowEditorOpen = true;
    }
</script>

{#snippet featureSettings(selectedFeature: Feature)}
    {@const featureConfig = FEATURES.find((item) => item.id === selectedFeature) ?? FEATURES[0]}
    {@const selectedProvider = getActiveProvider($appSettings, selectedFeature)}
    {@const selectedFields = getSettingsFields($appSettings, selectedFeature)}
    {@const selectedModelField = selectedFields.find((field) => field.path[2] === 'modelId')}
    {@const selectedOtherFields = selectedFields.filter((field) => field.path[2] !== 'modelId')}
    {@const hasSelectedModel = selectedProvider === 'plugin' || selectedModelField !== undefined}

    <section class="space-y-4">
        <div>
            <h3 class="text-lg font-semibold tracking-tight text-foreground">
                {featureConfig.label}
            </h3>
            <p class="text-sm text-muted-foreground">{featureConfig.description}</p>
        </div>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-busy={saving}>
            <div class="flex flex-col gap-1.5 {hasSelectedModel ? '' : 'sm:col-span-2'}">
                <Label for={`${selectedFeature}-service-provider`}>Provider</Label>
                <OptionSelect
                    id={`${selectedFeature}-service-provider`}
                    value={selectedProvider}
                    disabled={saving}
                    options={getProviders(selectedFeature).map((provider) => ({
                        value: provider,
                        label: getProviderName(selectedFeature, provider)
                    }))}
                    onChange={(value) =>
                        updateActiveProvider(selectedFeature, value as ServiceProvider)}
                />
            </div>

            {#if selectedProvider === 'plugin'}
                <div class="flex flex-col gap-1.5">
                    <Label for={`${selectedFeature}-plugin-model`}>Model</Label>
                    <OptionSelect
                        id={`${selectedFeature}-plugin-model`}
                        value={$appSettings?.plugin[selectedFeature].modelId ?? ''}
                        disabled={saving}
                        options={getPluginModels(selectedFeature).map((model) => ({
                            value: model.id,
                            label: model.name
                        }))}
                        onChange={(value) => updatePluginModel(selectedFeature, value)}
                    />
                </div>
            {:else if selectedModelField}
                {@const modelFieldId = `${selectedFeature}-${selectedModelField.id}`}
                <div class="flex flex-col gap-1.5">
                    <Label for={modelFieldId}>{selectedModelField.label}</Label>
                    {#if selectedModelField.options}
                        <OptionSelect
                            id={modelFieldId}
                            value={selectedModelField.value}
                            disabled={saving}
                            options={selectedModelField.options.map((option) => ({
                                value: option,
                                label: option
                            }))}
                            onChange={(value) => updateField(selectedModelField, value)}
                        />
                    {:else if selectedModelField.suggestions}
                        <SuggestedInput
                            id={modelFieldId}
                            value={selectedModelField.value}
                            suggestions={selectedModelField.suggestions}
                            placeholder={selectedModelField.placeholder}
                            disabled={saving}
                            onCommit={(value) => updateField(selectedModelField, value)}
                        />
                    {:else}
                        <Input
                            id={modelFieldId}
                            type="text"
                            value={selectedModelField.value}
                            placeholder={selectedModelField.placeholder}
                            disabled={saving}
                            onchange={(event) =>
                                updateField(selectedModelField, event.currentTarget.value)}
                        />
                    {/if}
                </div>
            {/if}

            {#each selectedOtherFields as field (field.id)}
                {@const fieldId = `${selectedFeature}-${field.id}`}
                <div
                    class="flex flex-col gap-1.5 {field.id.endsWith('api-key') ||
                    field.path[2] === 'baseUrl' ||
                    field.multiline
                        ? 'sm:col-span-2'
                        : ''}"
                >
                    <Label for={fieldId}>
                        {field.secret
                            ? `${getProviderName(selectedFeature, selectedProvider)} API Key`
                            : field.label}
                    </Label>
                    {#if field.secret}
                        <form onsubmit={(event) => event.preventDefault()} class="flex gap-2">
                            <Input
                                id={fieldId}
                                type={showSecrets ? 'text' : 'password'}
                                value={field.value}
                                placeholder="Enter API Key"
                                disabled={saving}
                                class="font-mono text-sm"
                                autocomplete="off"
                                onchange={(event) => updateField(field, event.currentTarget.value)}
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onclick={() => (showSecrets = !showSecrets)}
                                aria-label={showSecrets ? 'Hide API key' : 'Show API key'}
                            >
                                {#if showSecrets}
                                    <EyeOff class="size-4" />
                                {:else}
                                    <Eye class="size-4" />
                                {/if}
                            </Button>
                        </form>
                    {:else if field.options}
                        <OptionSelect
                            id={fieldId}
                            value={field.value}
                            disabled={saving}
                            options={field.options.map((option) => ({
                                value: option,
                                label: option
                            }))}
                            onChange={(value) => updateField(field, value)}
                        />
                    {:else if field.multiline}
                        <Textarea
                            id={fieldId}
                            value={field.value}
                            placeholder={field.placeholder}
                            disabled={saving}
                            class="min-h-48 font-mono text-xs"
                            onchange={(event) => updateField(field, event.currentTarget.value)}
                        />
                    {:else}
                        <Input
                            id={fieldId}
                            type={field.number ? 'number' : 'text'}
                            value={field.value}
                            placeholder={field.placeholder}
                            min={field.number?.min}
                            max={field.number?.max}
                            step={field.number?.step}
                            disabled={saving}
                            onchange={(event) => updateField(field, event.currentTarget.value)}
                        />
                    {/if}
                    {#if field.help}
                        <p class="text-xs text-muted-foreground">{field.help}</p>
                    {/if}
                </div>
            {/each}
        </div>
    </section>
{/snippet}

<div class="flex h-full min-h-0 flex-col overflow-hidden">
    <div class="mb-4 flex min-w-0 shrink-0 overflow-x-auto rounded-lg bg-muted/50 p-1">
        {#each SERVICE_GROUPS as item (item.id)}
            <button
                type="button"
                class="min-w-max basis-24 grow shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors {activeGroup ===
                item.id
                    ? 'bg-background text-foreground shadow-sm dark:bg-accent'
                    : 'text-muted-foreground hover:text-foreground'}"
                onclick={() => (activeGroup = item.id)}
            >
                {item.label}
            </button>
        {/each}
    </div>

    <ScrollArea class="-mr-4 min-h-0 flex-1 pr-4">
        <div class="space-y-8 pb-8">
            {#each serviceGroup.features as selectedFeature, index (selectedFeature)}
                {#if index > 0}
                    <div class="border-t border-border"></div>
                {/if}
                {@render featureSettings(selectedFeature)}
            {/each}

            {#if serviceGroup.workflow}
                {@const workflowFeature = serviceGroup.workflow}
                {@const workflow =
                    workflowFeature === 'imagegen'
                        ? $appSettings?.imageGeneration.workflow
                        : $appSettings?.tts.workflow}
                {#if workflow}
                    <div class="border-t border-border"></div>
                    <section class="space-y-4">
                        <div>
                            <h3 class="text-lg font-semibold tracking-tight text-foreground">
                                {workflowFeature === 'imagegen'
                                    ? 'Image Generation Workflow'
                                    : 'TTS Workflow'}
                            </h3>
                            <p class="text-sm text-muted-foreground">
                                {workflowFeature === 'imagegen'
                                    ? 'Customize the node pipeline used for generating images.'
                                    : 'Customize the node pipeline used for speech synthesis.'}
                            </p>
                        </div>

                        <WorkflowSummaryCard
                            wide
                            {workflow}
                            onEditWorkflow={() => editWorkflow(workflowFeature)}
                            workflowLabel={workflowFeature === 'imagegen'
                                ? 'Image generation workflow'
                                : 'TTS workflow'}
                        />
                    </section>
                {/if}
            {/if}
        </div>
    </ScrollArea>
</div>

{#if editedWorkflow}
    <WorkflowEditorModal
        bind:open={workflowEditorOpen}
        workflow={editedWorkflow}
        title={workflowEditorFeature === 'imagegen' ? 'Image Generation Workflow' : 'TTS Workflow'}
        onPatch={(patch) => updateWorkflow(workflowEditorFeature, patch)}
    />
{/if}
