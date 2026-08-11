<script lang="ts">
    import { Eye, EyeOff } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import OptionSelect from '$lib/components/OptionSelect.svelte';
    import SuggestedInput from '$lib/components/SuggestedInput.svelte';
    import { Separator } from '$lib/components/ui/separator';
    import { appSettings, updateSettings, t } from '$lib/stores';
    import {
        getBuiltInLLMModels,
        getLLMProviderName,
        TRANSFORMERS_LLM_MODELS,
        type LLMProvider,
        type LLMModelConfig
    } from '$lib/types/models/llm';
    import { pluginManager } from '$lib/plugins';
    import type { AppSettings } from '$lib/services/content/settings';
    import type { DeepPartial } from '$lib/utils/defaults';
    import { compareSortOrder } from '$lib/utils/ordering';
    import { listOpenRouterModels, type OpenRouterModelOption } from '$lib/openrouter/models';

    interface Props {
        config: LLMModelConfig;
        onModelChange: (provider: LLMProvider, modelId: string) => void;
    }

    let { config, onModelChange }: Props = $props();

    let showKey = $state(false);
    let openRouterModels = $state<OpenRouterModelOption[]>([]);
    let openRouterLoading = $state(false);
    let openRouterError = $state<string | null>(null);
    let loadedOpenRouterApiKey = $state('');

    const providers: LLMProvider[] = [
        'openai',
        'anthropic',
        'google',
        'deepseek',
        'mistral',
        'openrouter',
        'transformers',
        'mock',
        'custom',
        'plugin'
    ];

    function getModelsForProvider(provider: LLMProvider) {
        if (provider === 'custom') {
            return Object.values($appSettings?.custom?.llm?.models ?? {}).sort((a, b) =>
                compareSortOrder(a.sortOrder, b.sortOrder)
            );
        }
        if (provider === 'plugin') {
            const allModels = pluginManager
                .getInstances()
                .flatMap((instance) => [...instance.llmProviders.values()].map((p) => p.model));
            const seen: Record<string, boolean> = {};
            return allModels.filter((model) => {
                if (seen[model.id]) return false;
                seen[model.id] = true;
                return true;
            });
        }
        if (provider === 'transformers') return TRANSFORMERS_LLM_MODELS;
        if (provider === 'openrouter') {
            return openRouterModels.map((model) => ({ id: model.id, name: model.name }));
        }
        return getBuiltInLLMModels(provider);
    }

    $effect(() => {
        if (config.provider !== 'openrouter') return;
        const apiKey = $appSettings?.openrouter?.apiKey?.trim() ?? '';
        if (!apiKey || apiKey === loadedOpenRouterApiKey) return;

        loadedOpenRouterApiKey = apiKey;
        openRouterLoading = true;
        openRouterError = null;
        void listOpenRouterModels('llm', { apiKey })
            .then((models) => {
                openRouterModels = models;
            })
            .catch((error: unknown) => {
                openRouterError = error instanceof Error ? error.message : 'Failed to load models';
            })
            .finally(() => {
                openRouterLoading = false;
            });
    });

    function getProviderApiKey(provider: LLMProvider): string {
        if (!$appSettings) return '';
        if (provider === 'mock' || provider === 'transformers' || provider === 'custom') return '';

        const key = provider as keyof AppSettings;
        const provConfig = $appSettings[key];
        if (provConfig && typeof provConfig === 'object' && 'apiKey' in provConfig) {
            return (provConfig as { apiKey?: string }).apiKey ?? '';
        }
        return '';
    }

    function handleApiKeyChange(provider: string, key: string) {
        updateSettings({
            [provider]: { apiKey: key.trim() }
        } as DeepPartial<AppSettings>);
    }

    function handleProviderChange(value: string): void {
        const provider = value as LLMProvider;
        onModelChange(provider, getModelsForProvider(provider)[0]?.id ?? '');
    }
</script>

{#snippet fields()}
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="flex flex-col gap-1.5">
            <Label>{$t('settings.modelConfig.provider')}</Label>
            <OptionSelect
                value={config.provider}
                options={providers.map((provider) => ({
                    value: provider,
                    label: getLLMProviderName(provider)
                }))}
                onChange={handleProviderChange}
            />
        </div>
        <div class="flex flex-col gap-1.5">
            <Label>{$t('settings.modelConfig.model')}</Label>
            {#if config.provider === 'openrouter'}
                <SuggestedInput
                    id="openrouter-model"
                    value={config.id}
                    suggestions={openRouterModels.map((model) => model.id)}
                    placeholder={openRouterLoading
                        ? 'Loading OpenRouter models...'
                        : 'author/model'}
                    onCommit={(value) => onModelChange(config.provider, value)}
                />
                {#if openRouterError}
                    <p class="text-xs text-destructive">{openRouterError}</p>
                {/if}
            {:else}
                <OptionSelect
                    value={config.id}
                    options={getModelsForProvider(config.provider).map((model) => ({
                        value: model.id,
                        label: model.name
                    }))}
                    onChange={(value) => onModelChange(config.provider, value)}
                />
            {/if}
        </div>

        {#if config.provider && !['mock', 'transformers', 'custom', 'plugin'].includes(config.provider)}
            <div class="flex flex-col gap-1.5 sm:col-span-2">
                <Label>
                    {$t('settings.modelConfig.apiKeySuffix', {
                        provider: getLLMProviderName(config.provider)
                    })}
                </Label>
                <form onsubmit={(e) => e.preventDefault()} class="flex gap-2">
                    <Input
                        type={showKey ? 'text' : 'password'}
                        placeholder={$t('settings.modelConfig.enterApiKey')}
                        value={getProviderApiKey(config.provider)}
                        oninput={(e) => handleApiKeyChange(config.provider, e.currentTarget.value)}
                        class="font-mono text-sm"
                        autocomplete="off"
                    />
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onclick={() => (showKey = !showKey)}
                        aria-label={showKey
                            ? $t('settings.modelConfig.hideKey')
                            : $t('settings.modelConfig.showKey')}
                    >
                        {#if showKey}<EyeOff class="size-4" />{:else}<Eye class="size-4" />{/if}
                    </Button>
                </form>
            </div>
        {/if}
    </div>
{/snippet}

<div class="flex flex-col gap-3">
    {@render fields()}
</div>
