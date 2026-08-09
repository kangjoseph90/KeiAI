<script lang="ts">
    import { Eye, EyeOff } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import { ScrollArea } from '$lib/components/ui/scroll-area';
    import { Textarea } from '$lib/components/ui/textarea';
    import { appSettings, updateSettings } from '$lib/stores';
    import type { AppSettings } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';
    import {
        getEmbeddingProviderName,
        type EmbeddingProvider,
        type PluginEmbeddingModel
    } from '$lib/types/models/embedding';
    import {
        getImageGenProviderName,
        type ImageGenProvider,
        type PluginImageGenModel
    } from '$lib/types/models/imagegen';
    import {
        getRerankerProviderName,
        type PluginRerankerModel,
        type RerankerProvider
    } from '$lib/types/models/reranker';
    import {
        getSTTProviderName,
        type PluginSTTModel,
        type STTProvider
    } from '$lib/types/models/stt';
    import {
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

    type Feature = 'imagegen' | 'tts' | 'stt' | 'embedding' | 'reranker';
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

    const IMAGEGEN_PROVIDERS: ImageGenProvider[] = [
        'openai',
        'google',
        'novelai',
        'comfyui',
        'stability',
        'mock',
        'plugin'
    ];
    const TTS_PROVIDERS: TTSProvider[] = [
        'openai',
        'google',
        'elevenlabs',
        'novelai',
        'kokoro',
        'transformers',
        'mock',
        'plugin'
    ];
    const STT_PROVIDERS: STTProvider[] = [
        'openai',
        'google',
        'groq',
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
        'transformers',
        'plugin'
    ];
    const MOCK_IMAGEGEN_MODELS = ['sample', 'diagnostic'] as const;
    const MOCK_TTS_MODELS = ['sample', 'morse'] as const;
    const MOCK_STT_MODELS = ['sample', 'diagnostic'] as const;

    let activeFeature = $state<Feature>('imagegen');
    let showSecrets = $state(false);
    let saving = $state(false);
    let workflowEditorOpen = $state(false);

    const feature = $derived(FEATURES.find((item) => item.id === activeFeature) ?? FEATURES[0]);
    const activeProvider = $derived(getActiveProvider($appSettings, activeFeature));
    const fields = $derived(getSettingsFields($appSettings, activeFeature));
    const modelField = $derived(fields.find((f) => f.path[2] === 'modelId'));
    const otherFields = $derived(fields.filter((f) => f.path[2] !== 'modelId'));
    const hasModel = $derived(activeProvider === 'plugin' || modelField !== undefined);
    const activeWorkflow = $derived(
        activeFeature === 'imagegen'
            ? $appSettings?.imageGeneration.workflow
            : activeFeature === 'tts'
              ? $appSettings?.tts.workflow
              : undefined
    );

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

    function configField(
        provider: ProviderSettingsKey,
        section: string,
        key: string,
        label: string,
        value: string,
        placeholder: string
    ): SettingsField {
        return {
            id: `${provider}-${section}-${key}`,
            label,
            value,
            placeholder,
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
                    case 'google':
                        return [
                            apiKeyField(settings, 'google'),
                            configField(
                                'google',
                                'imagegen',
                                'modelId',
                                'Model',
                                settings.google.imagegen.modelId,
                                'gemini-3.1-flash-image'
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
                                'stable-diffusion-3.5-large'
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
                                options: MOCK_IMAGEGEN_MODELS
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
                                'tts-1'
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
                                'eleven_multilingual_v2'
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
                                options: MOCK_TTS_MODELS
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
                                'whisper-1'
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
                                options: MOCK_STT_MODELS
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
                                'text-embedding-3-small'
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
                                'gemini-embedding-2-preview'
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
                                'openai/text-embedding-3-small'
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
                                'rerank-v3.5'
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
                                'jina-reranker-v2-base-multilingual'
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
                                'rerank-2'
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

    function updateActiveProvider(provider: ServiceProvider): void {
        const key = `${activeFeature}Provider` as
            | 'imagegenProvider'
            | 'ttsProvider'
            | 'sttProvider'
            | 'embeddingProvider'
            | 'rerankerProvider';
        void save({ [key]: provider } as DeepPartial<AppSettings>);
    }

    function updatePluginModel(modelId: string): void {
        void save({ plugin: { [activeFeature]: { modelId } } } as DeepPartial<AppSettings>);
    }

    function updateField(field: SettingsField, value: string): void {
        const [provider, section, key] = field.path;
        const fieldValue = field.number ? Number(value) : value.trim();
        if (field.number && !Number.isFinite(fieldValue)) return;
        const providerPatch =
            key === undefined ? { [section]: fieldValue } : { [section]: { [key]: fieldValue } };
        void save({ [provider]: providerPatch } as DeepPartial<AppSettings>);
    }

    function updateWorkflow(patch: WorkflowPatch): Promise<void> {
        return activeFeature === 'imagegen'
            ? save({ imageGeneration: { workflow: patch } })
            : save({ tts: { workflow: patch } });
    }
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden">
    <div class="mb-4 flex min-w-0 shrink-0 overflow-x-auto rounded-lg bg-muted/50 p-1">
        {#each FEATURES as item (item.id)}
            <button
                type="button"
                class="min-w-max basis-24 grow shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors {activeFeature ===
                item.id
                    ? 'bg-background text-foreground shadow-sm dark:bg-accent'
                    : 'text-muted-foreground hover:text-foreground'}"
                onclick={() => (activeFeature = item.id)}
            >
                {item.label}
            </button>
        {/each}
    </div>

    <ScrollArea class="-mr-4 min-h-0 flex-1 pr-4">
        <div class="space-y-8 pb-8">
            <section class="space-y-4">
                <div>
                    <h3 class="text-lg font-semibold tracking-tight text-foreground">
                        {feature.label}
                    </h3>
                    <p class="text-sm text-muted-foreground">{feature.description}</p>
                </div>

                <div class="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-busy={saving}>
                    <div class="flex flex-col gap-1.5 {hasModel ? '' : 'col-span-1 sm:col-span-2'}">
                        <Label for="service-provider">Provider</Label>
                        <select
                            id="service-provider"
                            class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            value={activeProvider}
                            disabled={saving}
                            onchange={(event) =>
                                updateActiveProvider(event.currentTarget.value as ServiceProvider)}
                        >
                            {#each getProviders(activeFeature) as provider (provider)}
                                <option value={provider}
                                    >{getProviderName(activeFeature, provider)}</option
                                >
                            {/each}
                        </select>
                    </div>

                    {#if activeProvider === 'plugin'}
                        <div class="flex flex-col gap-1.5">
                            <Label for="plugin-model">Model</Label>
                            <select
                                id="plugin-model"
                                class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                value={$appSettings?.plugin[activeFeature].modelId ?? ''}
                                disabled={saving}
                                onchange={(event) => updatePluginModel(event.currentTarget.value)}
                            >
                                <option value="">Select a model...</option>
                                {#each getPluginModels(activeFeature) as model (model.id)}
                                    <option value={model.id}>{model.name}</option>
                                {/each}
                            </select>
                        </div>
                    {:else if modelField}
                        <div class="flex flex-col gap-1.5">
                            <Label for={modelField.id}>{modelField.label}</Label>
                            {#if modelField.options}
                                <select
                                    id={modelField.id}
                                    class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    value={modelField.value}
                                    disabled={saving}
                                    onchange={(event) =>
                                        updateField(modelField, event.currentTarget.value)}
                                >
                                    {#each modelField.options as option (option)}
                                        <option value={option}>{option}</option>
                                    {/each}
                                </select>
                            {:else}
                                <Input
                                    id={modelField.id}
                                    type="text"
                                    value={modelField.value}
                                    placeholder={modelField.placeholder}
                                    disabled={saving}
                                    onchange={(event) =>
                                        updateField(modelField, event.currentTarget.value)}
                                />
                            {/if}
                        </div>
                    {/if}

                    {#each otherFields as field (field.id)}
                        <div
                            class="flex flex-col gap-1.5 {field.id.endsWith('api-key') ||
                            field.path[2] === 'baseUrl' ||
                            field.multiline
                                ? 'sm:col-span-2'
                                : ''}"
                        >
                            <Label for={field.id}>
                                {field.secret
                                    ? `${getProviderName(activeFeature, activeProvider)} API Key`
                                    : field.label}
                            </Label>
                            {#if field.secret}
                                <form onsubmit={(e) => e.preventDefault()} class="flex gap-2">
                                    <Input
                                        id={field.id}
                                        type={showSecrets ? 'text' : 'password'}
                                        value={field.value}
                                        placeholder="Enter API Key"
                                        disabled={saving}
                                        class="font-mono text-sm"
                                        autocomplete="off"
                                        onchange={(event) =>
                                            updateField(field, event.currentTarget.value)}
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
                                <select
                                    id={field.id}
                                    class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    value={field.value}
                                    disabled={saving}
                                    onchange={(event) =>
                                        updateField(field, event.currentTarget.value)}
                                >
                                    {#each field.options as option (option)}
                                        <option value={option}>{option}</option>
                                    {/each}
                                </select>
                            {:else if field.multiline}
                                <Textarea
                                    id={field.id}
                                    value={field.value}
                                    placeholder={field.placeholder}
                                    disabled={saving}
                                    class="min-h-48 font-mono text-xs"
                                    onchange={(event) =>
                                        updateField(field, event.currentTarget.value)}
                                />
                            {:else}
                                <Input
                                    id={field.id}
                                    type={field.number ? 'number' : 'text'}
                                    value={field.value}
                                    placeholder={field.placeholder}
                                    min={field.number?.min}
                                    max={field.number?.max}
                                    step={field.number?.step}
                                    disabled={saving}
                                    onchange={(event) =>
                                        updateField(field, event.currentTarget.value)}
                                />
                            {/if}
                            {#if field.help}
                                <p class="text-xs text-muted-foreground">
                                    {field.help}
                                </p>
                            {/if}
                        </div>
                    {/each}
                </div>
            </section>

            {#if activeWorkflow}
                <div class="border-t border-border"></div>

                <!-- Workflow Section -->
                <section class="space-y-4">
                    <div>
                        <h3 class="text-lg font-semibold tracking-tight text-foreground">
                            {activeFeature === 'imagegen'
                                ? 'Image Generation Workflow'
                                : 'TTS Workflow'}
                        </h3>
                        <p class="text-sm text-muted-foreground">
                            {activeFeature === 'imagegen'
                                ? 'Customize the node pipeline used for generating images.'
                                : 'Customize the node pipeline used for speech synthesis.'}
                        </p>
                    </div>

                    <WorkflowSummaryCard
                        workflow={activeWorkflow}
                        onEditWorkflow={() => (workflowEditorOpen = true)}
                        workflowLabel={activeFeature === 'imagegen'
                            ? 'Image generation workflow'
                            : 'TTS workflow'}
                        editWorkflowLabel={activeFeature === 'imagegen'
                            ? 'Edit image generation workflow'
                            : 'Edit TTS workflow'}
                    />
                </section>
            {/if}
        </div>
    </ScrollArea>
</div>

{#if activeWorkflow}
    <WorkflowEditorModal
        bind:open={workflowEditorOpen}
        workflow={activeWorkflow}
        title={activeFeature === 'imagegen' ? 'Image Generation Workflow' : 'TTS Workflow'}
        onPatch={updateWorkflow}
    />
{/if}
