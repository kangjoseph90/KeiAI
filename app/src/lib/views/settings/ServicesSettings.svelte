<script lang="ts">
    import { Eye, EyeOff } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import {
        Card,
        CardContent,
        CardDescription,
        CardHeader,
        CardTitle
    } from '$lib/components/ui/card';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import { ScrollArea } from '$lib/components/ui/scroll-area';
    import { Textarea } from '$lib/components/ui/textarea';
    import { appSettings, updateSettings } from '$lib/stores';
    import type { AppSettings } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';
    import { getEmbeddingProviderName, type EmbeddingProvider } from '$lib/types/models/embedding';
    import { getImageGenProviderName, type ImageGenProvider } from '$lib/types/models/imagegen';
    import { getRerankerProviderName, type RerankerProvider } from '$lib/types/models/reranker';
    import { getSTTProviderName, type STTProvider } from '$lib/types/models/stt';
    import { getTTSProviderName, type TTSProvider } from '$lib/types/models/tts';
    import { getErrorMessage } from '$lib/types/errors';
    import { toast } from '$lib/ui';

    type Feature = 'imagegen' | 'tts' | 'stt' | 'embedding' | 'reranker';
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
        | 'jina';

    interface SettingsField {
        id: string;
        label: string;
        value: string;
        placeholder: string;
        secret?: boolean;
        multiline?: boolean;
        help?: string;
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
        'stability'
    ];
    const TTS_PROVIDERS: TTSProvider[] = [
        'openai',
        'google',
        'elevenlabs',
        'novelai',
        'kokoro',
        'transformers'
    ];
    const STT_PROVIDERS: STTProvider[] = ['openai', 'google', 'groq', 'transformers'];
    const EMBEDDING_PROVIDERS: EmbeddingProvider[] = [
        'openai',
        'google',
        'voyageai',
        'openrouter',
        'minilm',
        'transformers',
        'custom'
    ];
    const RERANKER_PROVIDERS: RerankerProvider[] = ['cohere', 'jina', 'voyageai', 'transformers'];

    let activeFeature = $state<Feature>('imagegen');
    let showSecrets = $state(false);
    let saving = $state(false);

    const feature = $derived(FEATURES.find((item) => item.id === activeFeature) ?? FEATURES[0]);
    const activeProvider = $derived(getActiveProvider($appSettings, activeFeature));
    const fields = $derived(getSettingsFields($appSettings, activeFeature));

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
                                'gemini-2.5-flash-preview-tts'
                            ),
                            configField(
                                'google',
                                'tts',
                                'voiceId',
                                'Voice',
                                settings.google.tts.voiceId,
                                'zephyr'
                            )
                        ];
                    case 'elevenlabs':
                        return [
                            apiKeyField(settings, 'elevenlabs'),
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
                            configField(
                                'kokoro',
                                'tts',
                                'voiceId',
                                'Voice',
                                settings.kokoro.tts.voiceId,
                                'af_heart'
                            )
                        ];
                    case 'transformers':
                        return [
                            configField(
                                'transformers',
                                'tts',
                                'modelId',
                                'Model',
                                settings.transformers.tts.modelId,
                                'Model ID'
                            ),
                            configField(
                                'transformers',
                                'tts',
                                'voiceId',
                                'Voice',
                                settings.transformers.tts.voiceId,
                                'af_heart'
                            )
                        ];
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

    function updateField(field: SettingsField, value: string): void {
        const [provider, section, key] = field.path;
        const fieldValue = field.number ? Number(value) : value.trim();
        if (field.number && !Number.isFinite(fieldValue)) return;
        const providerPatch =
            key === undefined ? { [section]: fieldValue } : { [section]: { [key]: fieldValue } };
        void save({ [provider]: providerPatch } as DeepPartial<AppSettings>);
    }
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden">
    <div class="mb-6 flex min-w-0 shrink-0 overflow-x-auto rounded-lg bg-muted/50 p-1">
        {#each FEATURES as item (item.id)}
            <button
                type="button"
                class="min-w-fit flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors {activeFeature ===
                item.id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'}"
                onclick={() => (activeFeature = item.id)}
            >
                {item.label}
            </button>
        {/each}
    </div>

    <ScrollArea class="-mr-4 min-h-0 flex-1 pr-4">
        <Card>
            <CardHeader>
                <CardTitle>{feature.label}</CardTitle>
                <CardDescription>{feature.description}</CardDescription>
            </CardHeader>
            <CardContent class="space-y-6" aria-busy={saving}>
                <div class="space-y-2">
                    <Label for="service-provider">Provider</Label>
                    <select
                        id="service-provider"
                        class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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

                <div class="border-t pt-6">
                    <div class="grid gap-4 sm:grid-cols-2">
                        {#each fields as field (field.id)}
                            <div
                                class="space-y-2 {field.id.endsWith('api-key') ||
                                field.path[2] === 'baseUrl' ||
                                field.multiline
                                    ? 'sm:col-span-2'
                                    : ''}"
                            >
                                <Label for={field.id} class="flex items-center justify-between">
                                    {field.secret
                                        ? `${getProviderName(activeFeature, activeProvider)} API Key`
                                        : field.label}
                                    {#if field.secret}
                                        <span
                                            class="text-[10px] font-normal uppercase text-muted-foreground"
                                            >Settings</span
                                        >
                                    {/if}
                                </Label>
                                {#if field.secret}
                                    <div class="flex items-center gap-2">
                                        <Input
                                            id={field.id}
                                            type={showSecrets ? 'text' : 'password'}
                                            value={field.value}
                                            placeholder="Enter API Key"
                                            disabled={saving}
                                            class="font-mono"
                                            onchange={(event) =>
                                                updateField(field, event.currentTarget.value)}
                                        />
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            class="shrink-0"
                                            onclick={() => (showSecrets = !showSecrets)}
                                            aria-label={showSecrets
                                                ? 'Hide API key'
                                                : 'Show API key'}
                                        >
                                            {#if showSecrets}
                                                <EyeOff class="size-4" />
                                            {:else}
                                                <Eye class="size-4" />
                                            {/if}
                                        </Button>
                                    </div>
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
                                    <p class="text-xs text-muted-foreground">{field.help}</p>
                                {/if}
                            </div>
                        {/each}
                    </div>
                </div>
            </CardContent>
        </Card>
    </ScrollArea>
</div>
